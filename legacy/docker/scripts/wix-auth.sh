#!/bin/bash
set -e

# Wix OAuth Authentication Helper for MCP Hub
# This script handles the OAuth flow for Wix MCP server integration

MCP_HUB_HOST="${WIX_MCP_HUB_HOST:-localhost}"
MCP_HUB_PORT="${PORT:-37373}"
AUTH_TIMEOUT="${WIX_AUTH_TIMEOUT:-300}" # 5 minutes
WIX_CLIENT_ID="${WIX_OAUTH_CLIENT_ID:-e2c8a702-1e3f-473e-90d7-320c3bbf108b}"
WIX_SERVER_NAME="wix-mcp-remote"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] [WIX-AUTH]${NC} $1"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] [WIX-AUTH ERROR]${NC} $1" >&2
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] [WIX-AUTH WARN]${NC} $1"
}

success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] [WIX-AUTH SUCCESS]${NC} $1"
}

# Check prerequisites for Wix OAuth
check_prerequisites() {
    log "Checking Wix OAuth prerequisites..."
    
    # Check if WIX_OAUTH_CLIENT_ID is set
    if [ -z "$WIX_CLIENT_ID" ]; then
        error "WIX_OAUTH_CLIENT_ID environment variable is not set"
        return 1
    fi
    
    # Check if MCP Hub is running
    local max_attempts=30
    local attempt=1
    
    log "Waiting for MCP Hub to be available at http://$MCP_HUB_HOST:$MCP_HUB_PORT..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s -f "http://$MCP_HUB_HOST:$MCP_HUB_PORT/api/health" > /dev/null 2>&1; then
            success "MCP Hub is running and accessible"
            return 0
        fi
        
        log "Waiting for MCP Hub to start... (attempt $attempt/$max_attempts)"
        sleep 2
        attempt=$((attempt + 1))
    done
    
    error "MCP Hub is not accessible at http://$MCP_HUB_HOST:$MCP_HUB_PORT"
    return 1
}

# Get server status from MCP Hub
get_server_status() {
    local response
    if response=$(curl -s -f "http://$MCP_HUB_HOST:$MCP_HUB_PORT/api/servers" 2>&1); then
        echo "$response" | grep -o "\"$WIX_SERVER_NAME\"[^}]*\"status\":\"[^\"]*" | grep -o '"status":"[^"]*' | cut -d'"' -f4
    else
        echo "unknown"
    fi
}

# Check if Wix server needs authentication
needs_authentication() {
    local status
    status=$(get_server_status)
    
    log "Wix server status: $status"
    
    case "$status" in
        "unauthorized"|"UNAUTHORIZED")
            return 0  # Needs auth
            ;;
        "connected"|"CONNECTED")
            log "Wix server is already connected"
            return 1  # Already authenticated
            ;;
        "connecting"|"CONNECTING")
            log "Wix server is currently connecting, waiting..."
            sleep 5
            needs_authentication  # Recursive check
            ;;
        *)
            warn "Wix server status is '$status', attempting authentication anyway"
            return 0  # Try auth
            ;;
    esac
}

# Trigger OAuth authorization for Wix server with fallback methods
trigger_oauth_authorization() {
    log "Triggering OAuth authorization for Wix server..."
    
    # Method 1: Try new MCP Hub API endpoint
    if trigger_oauth_method_1; then
        return 0
    fi
    
    # Method 2: Try legacy endpoint format (fallback)
    warn "Primary auth method failed, trying fallback method..."
    if trigger_oauth_method_2; then
        return 0
    fi
    
    # Method 3: Direct server query and manual URL extraction (last resort)
    warn "Fallback auth method failed, trying direct server query..."
    if trigger_oauth_method_3; then
        return 0
    fi
    
    error "All authentication methods failed"
    return 1
}

# Method 1: New MCP Hub API endpoint
trigger_oauth_method_1() {
    log "Trying Method 1: MCP Hub /api/servers/authorize endpoint"
    
    local auth_url="http://$MCP_HUB_HOST:$MCP_HUB_PORT/api/servers/authorize"
    local response
    
    # Send authorization request to MCP Hub
    if response=$(curl -s -f -X POST "$auth_url" \
        -H "Content-Type: application/json" \
        -d "{\"server_name\": \"$WIX_SERVER_NAME\"}" 2>&1); then
        return $(handle_oauth_response "$response")
    else
        log "Method 1 failed: $response"
        return 1
    fi
}

# Method 2: Legacy endpoint format (fallback)
trigger_oauth_method_2() {
    log "Trying Method 2: Legacy endpoint format"
    
    local auth_url="http://$MCP_HUB_HOST:$MCP_HUB_PORT/api/servers/$WIX_SERVER_NAME/authorize"
    local response
    
    if response=$(curl -s -f -X POST "$auth_url" 2>&1); then
        return $(handle_oauth_response "$response")
    else
        log "Method 2 failed: $response"
        return 1
    fi
}

# Method 3: Direct server query and manual URL extraction
trigger_oauth_method_3() {
    log "Trying Method 3: Direct server query for auth URL"
    
    local servers_url="http://$MCP_HUB_HOST:$MCP_HUB_PORT/api/servers"
    local response
    
    if response=$(curl -s -f "$servers_url" 2>&1); then
        local oauth_url
        oauth_url=$(echo "$response" | grep -A 20 "\"name\":\"$WIX_SERVER_NAME\"" | grep -o '"authorizationUrl":"[^"]*' | cut -d'"' -f4)
        
        if [ -n "$oauth_url" ]; then
            log "Found authorization URL in server status: $oauth_url"
            return $(handle_oauth_url "$oauth_url")
        else
            log "Method 3 failed: No authorization URL found in server status"
            return 1
        fi
    else
        log "Method 3 failed: Could not query server status: $response"
        return 1
    fi
}

# Common function to handle OAuth response and extract URL
handle_oauth_response() {
    local response="$1"
    local oauth_url
    oauth_url=$(echo "$response" | grep -o '"authorizationUrl":"[^"]*' | cut -d'"' -f4)
    
    if [ -n "$oauth_url" ]; then
        log "OAuth URL extracted: $oauth_url"
        return $(handle_oauth_url "$oauth_url")
    else
        error "Could not extract OAuth URL from response: $response"
        return 1
    fi
}

# Common function to handle OAuth URL opening and waiting
handle_oauth_url() {
    local oauth_url="$1"
    
    # Try to open browser on host system
    if [ -n "$DISPLAY" ]; then
        log "Opening browser for OAuth authentication..."
        # Try different browser commands
        if command -v xdg-open >/dev/null 2>&1; then
            xdg-open "$oauth_url" &
        elif command -v gnome-open >/dev/null 2>&1; then
            gnome-open "$oauth_url" &
        elif command -v firefox >/dev/null 2>&1; then
            firefox "$oauth_url" &
        elif command -v google-chrome >/dev/null 2>&1; then
            google-chrome "$oauth_url" &
        else
            warn "No browser found. Please manually open this URL in your browser:"
            echo "$oauth_url"
        fi
    else
        warn "No DISPLAY environment variable found. Please manually open this URL in your browser:"
        echo "$oauth_url"
    fi
    
    # Wait for authentication completion
    wait_for_authentication
    return $?
}

# Wait for OAuth authentication to complete
wait_for_authentication() {
    log "Waiting for OAuth authentication to complete..."
    log "Please complete the Wix authorization in your browser"
    
    local max_attempts=$((AUTH_TIMEOUT / 5))
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        local status
        status=$(get_server_status)
        
        case "$status" in
            "connected"|"CONNECTED")
                success "Wix OAuth authentication completed successfully!"
                return 0
                ;;
            "error"|"ERROR")
                error "Wix server encountered an error during authentication"
                return 1
                ;;
        esac
        
        log "Waiting for authentication... (attempt $attempt/$max_attempts, timeout in $((AUTH_TIMEOUT - attempt * 5))s)"
        sleep 5
        attempt=$((attempt + 1))
    done
    
    error "Authentication timeout reached. Please try again."
    return 1
}

# Check if authentication is already complete
check_authentication_status() {
    local status
    status=$(get_server_status)
    
    case "$status" in
        "connected"|"CONNECTED")
            return 0  # Already authenticated
            ;;
        *)
            return 1  # Not authenticated
            ;;
    esac
}

# Monitor Wix server connection
monitor_connection() {
    log "Monitoring Wix server connection..."
    
    while true; do
        if check_authentication_status; then
            local timestamp=$(date +'%Y-%m-%d %H:%M:%S')
            log "Wix server connection verified at $timestamp"
        else
            warn "Wix server connection lost, attempting to reconnect..."
            if trigger_oauth_authorization; then
                success "Wix server reconnected successfully"
            else
                error "Failed to reconnect Wix server"
                return 1
            fi
        fi
        
        sleep 30  # Check every 30 seconds
    done
}

# Cleanup function
cleanup() {
    log "Cleaning up..."
    exit
}

# Set up signal handlers
trap cleanup EXIT INT TERM

# Main execution
main() {
    log "Starting Wix OAuth authentication process"
    
    # Check prerequisites
    if ! check_prerequisites; then
        error "Prerequisites check failed"
        exit 1
    fi
    
    # Check if authentication is already complete
    if check_authentication_status; then
        success "Wix server is already authenticated"
        
        # If running in daemon mode, monitor the connection
        if [ "$1" = "--daemon" ]; then
            log "Running in daemon mode, monitoring Wix server connection"
            monitor_connection
        fi
        
        exit 0
    fi
    
    # Check if server needs authentication
    if ! needs_authentication; then
        log "Wix server does not require authentication at this time"
        exit 0
    fi
    
    # Trigger OAuth authentication
    if ! trigger_oauth_authorization; then
        error "OAuth authentication failed"
        exit 1
    fi
    
    success "Wix OAuth authentication setup completed"
    
    # If running in daemon mode, monitor the connection
    if [ "$1" = "--daemon" ]; then
        log "Running in daemon mode, monitoring Wix server connection"
        monitor_connection
    fi
}

# Parse command line arguments
case "${1:-}" in
    --daemon)
        main --daemon
        ;;
    --status)
        if check_authentication_status; then
            success "Wix server is authenticated"
            exit 0
        else
            error "Wix server is not authenticated"
            exit 1
        fi
        ;;
    --help|-h)
        echo "Usage: $0 [--daemon|--status|--help]"
        echo ""
        echo "Options:"
        echo "  --daemon    Run in daemon mode, monitoring the server connection"
        echo "  --status    Check authentication status"
        echo "  --help      Show this help message"
        echo ""
        echo "Environment Variables:"
        echo "  WIX_MCP_HUB_HOST              MCP Hub host (default: localhost)"
        echo "  WIX_AUTH_TIMEOUT              Auth timeout in seconds (default: 300)"
        echo "  WIX_OAUTH_CLIENT_ID           Wix OAuth client ID"
        exit 0
        ;;
    *)
        main "$@"
        ;;
esac

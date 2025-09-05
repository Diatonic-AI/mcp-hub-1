#!/bin/bash
set -e

# Google Workspace OAuth Authentication Helper for MCP Hub
# This script handles the OAuth flow for Google Workspace integration

MCP_HUB_HOST="${GOOGLE_WORKSPACE_HOST:-localhost}"
MCP_HUB_PORT="${PORT:-37373}"
AUTH_TIMEOUT="${GOOGLE_WORKSPACE_AUTH_TIMEOUT:-300}" # 5 minutes
GOOGLE_WORKSPACE_SERVER_NAME="google-workspace"
CREDENTIALS_FILE="/app/config/google-drive-credentials.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] [WORKSPACE-AUTH]${NC} $1"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] [WORKSPACE-AUTH ERROR]${NC} $1" >&2
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] [WORKSPACE-AUTH WARN]${NC} $1"
}

success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] [WORKSPACE-AUTH SUCCESS]${NC} $1"
}

# Check prerequisites for Google Workspace OAuth
check_prerequisites() {
    log "Checking Google Workspace OAuth prerequisites..."
    
    # Check if credentials file exists
    if [ ! -f "$CREDENTIALS_FILE" ]; then
        error "Google credentials file not found at $CREDENTIALS_FILE"
        error "Please ensure google-drive-credentials.json is mounted in the container"
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
        echo "$response" | grep -o "\"$GOOGLE_WORKSPACE_SERVER_NAME\"[^}]*\"status\":\"[^\"]*" | grep -o '"status":"[^"]*' | cut -d'"' -f4
    else
        echo "unknown"
    fi
}

# Check if Google Workspace server needs authentication
needs_authentication() {
    local status
    status=$(get_server_status)
    
    log "Google Workspace server status: $status"
    
    case "$status" in
        "unauthorized"|"UNAUTHORIZED")
            return 0  # Needs auth
            ;;
        "connected"|"CONNECTED")
            log "Google Workspace server is already connected"
            return 1  # Already authenticated
            ;;
        "connecting"|"CONNECTING")
            log "Google Workspace server is currently connecting, waiting..."
            sleep 5
            needs_authentication  # Recursive check
            ;;
        *)
            warn "Google Workspace server status is '$status', attempting authentication anyway"
            return 0  # Try auth
            ;;
    esac
}

# Trigger OAuth authorization for Google Workspace server with fallback methods
trigger_oauth_authorization() {
    log "Triggering OAuth authorization for Google Workspace server..."
    
    # Method 1: Try MCP Hub API endpoint
    if trigger_oauth_method_1; then
        return 0
    fi
    
    # Method 2: Try direct server status query (fallback)
    warn "Primary auth method failed, trying fallback method..."
    if trigger_oauth_method_2; then
        return 0
    fi
    
    # Method 3: Try alternative endpoint formats (last resort)
    warn "Fallback auth method failed, trying alternative endpoints..."
    if trigger_oauth_method_3; then
        return 0
    fi
    
    error "All authentication methods failed for Google Workspace"
    return 1
}

# Method 1: MCP Hub API endpoint
trigger_oauth_method_1() {
    log "Trying Method 1: MCP Hub /api/servers/authorize endpoint"
    
    local auth_url="http://$MCP_HUB_HOST:$MCP_HUB_PORT/api/servers/authorize"
    local response
    
    # Send authorization request to MCP Hub
    if response=$(curl -s -f -X POST "$auth_url" \
        -H "Content-Type: application/json" \
        -d "{\"server_name\": \"$GOOGLE_WORKSPACE_SERVER_NAME\"}" 2>&1); then
        return $(handle_oauth_response "$response")
    else
        log "Method 1 failed: $response"
        return 1
    fi
}

# Method 2: Direct server status query
trigger_oauth_method_2() {
    log "Trying Method 2: Direct server query for auth URL"
    
    local servers_url="http://$MCP_HUB_HOST:$MCP_HUB_PORT/api/servers"
    local response
    
    if response=$(curl -s -f "$servers_url" 2>&1); then
        local oauth_url
        oauth_url=$(echo "$response" | grep -A 20 "\"name\":\"$GOOGLE_WORKSPACE_SERVER_NAME\"" | grep -o '"authorizationUrl":"[^"]*' | cut -d'"' -f4)
        
        if [ -n "$oauth_url" ]; then
            log "Found authorization URL in server status: $oauth_url"
            return $(handle_oauth_url "$oauth_url")
        else
            log "Method 2 failed: No authorization URL found in server status"
            return 1
        fi
    else
        log "Method 2 failed: Could not query server status: $response"
        return 1
    fi
}

# Method 3: Alternative endpoint formats
trigger_oauth_method_3() {
    log "Trying Method 3: Legacy endpoint formats"
    
    # Try different possible endpoint patterns
    local endpoints=(
        "http://$MCP_HUB_HOST:$MCP_HUB_PORT/api/servers/$GOOGLE_WORKSPACE_SERVER_NAME/authorize"
        "http://$MCP_HUB_HOST:$MCP_HUB_PORT/oauth/authorize?server=$GOOGLE_WORKSPACE_SERVER_NAME"
        "http://$MCP_HUB_HOST:$MCP_HUB_PORT/api/oauth/authorize?server_name=$GOOGLE_WORKSPACE_SERVER_NAME"
    )
    
    for endpoint in "${endpoints[@]}"; do
        log "Trying endpoint: $endpoint"
        local response
        if response=$(curl -s -f -X POST "$endpoint" 2>&1); then
            if handle_oauth_response "$response"; then
                return 0
            fi
        else
            log "Endpoint failed: $response"
        fi
    done
    
    log "Method 3 failed: All alternative endpoints failed"
    return 1
}

# Common function to handle OAuth response and extract URL
handle_oauth_response() {
    local response="$1"
    local oauth_url
    
    # Try different patterns to extract OAuth URL
    oauth_url=$(echo "$response" | grep -o '"authorizationUrl":"[^"]*' | cut -d'"' -f4)
    
    if [ -z "$oauth_url" ]; then
        # Try alternative pattern for Google OAuth
        oauth_url=$(echo "$response" | grep -o 'https://accounts\.google\.com[^"\s]*')
    fi
    
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
    log "Please complete the Google Workspace authorization in your browser"
    
    local max_attempts=$((AUTH_TIMEOUT / 5))
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        local status
        status=$(get_server_status)
        
        case "$status" in
            "connected"|"CONNECTED")
                success "Google Workspace OAuth authentication completed successfully!"
                return 0
                ;;
            "error"|"ERROR")
                error "Google Workspace server encountered an error during authentication"
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

# Monitor Google Workspace server connection
monitor_connection() {
    log "Monitoring Google Workspace server connection..."
    
    while true; do
        if check_authentication_status; then
            local timestamp=$(date +'%Y-%m-%d %H:%M:%S')
            log "Google Workspace server connection verified at $timestamp"
        else
            warn "Google Workspace server connection lost, attempting to reconnect..."
            if trigger_oauth_authorization; then
                success "Google Workspace server reconnected successfully"
            else
                error "Failed to reconnect Google Workspace server"
                return 1
            fi
        fi
        
        # Wait before next check (default: 5 minutes)
        sleep 300
    done
}

# Main execution logic
main() {
    log "Starting Google Workspace OAuth authentication process"
    
    # Check prerequisites
    if ! check_prerequisites; then
        error "Prerequisites check failed"
        exit 1
    fi
    
    # Check if already authenticated
    if check_authentication_status; then
        success "Google Workspace server is already authenticated"
        
        # If in daemon mode, monitor the connection
        if [ "${1:-}" = "--daemon" ]; then
            monitor_connection
        fi
        
        exit 0
    fi
    
    # Check if authentication is needed
    if needs_authentication; then
        log "Google Workspace server requires authentication"
        
        if trigger_oauth_authorization; then
            success "Google Workspace OAuth authentication completed"
            
            # If in daemon mode, monitor the connection
            if [ "${1:-}" = "--daemon" ]; then
                monitor_connection
            fi
            
            exit 0
        else
            error "OAuth authentication failed"
            exit 1
        fi
    else
        log "Google Workspace server does not require authentication or is already connected"
        exit 0
    fi
}

# Cleanup function
cleanup() {
    log "Cleaning up..."
    # Stop any background processes if needed
    jobs -p | xargs -r kill 2>/dev/null || true
}

# Set up signal handlers
trap cleanup EXIT INT TERM

# Execute main function with all arguments
main "$@"

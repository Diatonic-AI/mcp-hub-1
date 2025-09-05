#!/bin/bash
set -e

# MCP Hub Enhanced Startup Script with Google Workspace Integration
# This script handles the startup process including Google Workspace OAuth

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] [STARTUP]${NC} $1"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] [STARTUP ERROR]${NC} $1" >&2
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] [STARTUP WARN]${NC} $1"
}

success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] [STARTUP SUCCESS]${NC} $1"
}

# Initialize directories and permissions
initialize_environment() {
    log "Initializing container environment..."
    
    # Create necessary directories (these should already exist from Dockerfile)
    # Only create them if they don't exist and we have permission
    [ ! -d "/app/data/google-workspace" ] && mkdir -p /app/data/google-workspace 2>/dev/null || true
    [ ! -d "/app/logs" ] && mkdir -p /app/logs 2>/dev/null || true
    [ ! -d "/home/mcp-hub/.local/bin" ] && mkdir -p /home/mcp-hub/.local/bin 2>/dev/null || true
    
    # Check if we can write to required directories
    if [ ! -w "/app/data" ]; then
        warn "Cannot write to /app/data - some features may not work"
    fi
    if [ ! -w "/app/logs" ]; then
        warn "Cannot write to /app/logs - logging may not work properly"
    fi
    
    # Ensure script permissions
    chmod +x /app/scripts/*.sh 2>/dev/null || true
    
    success "Environment initialized"
}

# Check if Wix should be enabled
should_enable_wix() {
    # Check if Wix is disabled
    if [ "$DISABLE_WIX" = "true" ]; then
        warn "Wix disabled by environment variable"
        return 1
    fi
    
    # Check if WIX_OAUTH_CLIENT_ID is set
    if [ -z "$WIX_OAUTH_CLIENT_ID" ]; then
        warn "WIX_OAUTH_CLIENT_ID not set, skipping Wix integration"
        return 1
    fi
    
    return 0
}

# Check if Google Workspace should be enabled
should_enable_google_workspace() {
    # Check if credentials file exists
    if [ ! -f "/app/config/google-drive-credentials.json" ]; then
        warn "Google Workspace credentials not found, skipping Google Workspace integration"
        return 1
    fi
    
    # Check if Google Workspace is disabled
    if [ "$DISABLE_GOOGLE_WORKSPACE" = "true" ]; then
        warn "Google Workspace disabled by environment variable"
        return 1
    fi
    
    # Check if workspace-mcp is available
    if ! command -v uvx workspace-mcp >/dev/null 2>&1 && ! python -c "import workspace_mcp" >/dev/null 2>&1; then
        warn "workspace-mcp not available, skipping Google Workspace integration"
        return 1
    fi
    
    return 0
}

# Start Wix authentication in background
start_wix_auth() {
    if should_enable_wix; then
        log "Starting Wix authentication process..."
        
        # Export required environment variables
        export WIX_MCP_HUB_HOST="${WIX_MCP_HUB_HOST:-localhost}"
        export WIX_AUTH_TIMEOUT="${WIX_AUTH_TIMEOUT:-300}"
        export WIX_OAUTH_CLIENT_ID="${WIX_OAUTH_CLIENT_ID}"
        export DISPLAY="${DISPLAY:-}"
        
        # Start the authentication script in background
        if [ "$WIX_AUTO_AUTH" = "true" ]; then
            log "Auto-authentication enabled, starting Wix auth in daemon mode"
            /app/scripts/wix-auth.sh --daemon > /app/logs/wix-auth.log 2>&1 &
            WIX_AUTH_PID=$!
            echo "$WIX_AUTH_PID" > /tmp/wix-auth.pid
            
            # Give it a moment to start
            sleep 3
            
            # Check if it's still running
            if kill -0 "$WIX_AUTH_PID" 2>/dev/null; then
                success "Wix authentication started in background (PID: $WIX_AUTH_PID)"
            else
                warn "Wix authentication process failed to start"
            fi
        else
            log "Wix manual authentication mode"
            log "Run '/app/scripts/wix-auth.sh' manually to authenticate"
        fi
    fi
}

# Start Google Workspace authentication in background
start_google_workspace_auth() {
    if should_enable_google_workspace; then
        log "Starting Google Workspace authentication process..."
        
        # Export required environment variables
        export GOOGLE_WORKSPACE_HOST="${GOOGLE_WORKSPACE_HOST:-localhost}"
        export GOOGLE_WORKSPACE_PORT="${GOOGLE_WORKSPACE_PORT:-8001}"
        export GOOGLE_WORKSPACE_AUTH_TIMEOUT="${GOOGLE_WORKSPACE_AUTH_TIMEOUT:-300}"
        export DISPLAY="${DISPLAY:-}"
        
        # Start the authentication script in background
        if [ "$GOOGLE_WORKSPACE_AUTO_AUTH" = "true" ]; then
            log "Auto-authentication enabled, starting Google Workspace auth in daemon mode"
            /app/scripts/google-workspace-auth.sh --daemon > /app/logs/google-workspace-auth.log 2>&1 &
            WORKSPACE_AUTH_PID=$!
            echo "$WORKSPACE_AUTH_PID" > /tmp/workspace-auth.pid
            
            # Give it a moment to start
            sleep 3
            
            # Check if it's still running
            if kill -0 "$WORKSPACE_AUTH_PID" 2>/dev/null; then
                success "Google Workspace authentication started in background (PID: $WORKSPACE_AUTH_PID)"
            else
                warn "Google Workspace authentication process failed to start"
            fi
        else
            log "Google Workspace manual authentication mode"
            log "Run '/app/scripts/google-workspace-auth.sh' manually to authenticate"
        fi
    fi
}

# Wait for MCP Hub to be fully ready before starting authentication
wait_for_mcp_hub_ready() {
    log "Waiting for MCP Hub to be fully ready..."
    
    local max_wait=120  # 2 minutes max wait
    local waited=0
    local check_interval=5
    
    while [ $waited -lt $max_wait ]; do
        # Check if MCP Hub health endpoint is responding
        if curl -s -f "http://localhost:37373/api/health" > /dev/null 2>&1; then
            log "MCP Hub health endpoint is responding, checking server status..."
            
            # Check if servers have finished initializing (not all "connecting")
            local servers_response
            if servers_response=$(curl -s -f "http://localhost:37373/api/servers" 2>/dev/null); then
                # Count servers that are still "connecting"
                local connecting_count
                connecting_count=$(echo "$servers_response" | grep -o '"status":"connecting"' | wc -l || echo "0")
                
                log "Found $connecting_count servers still connecting"
                
                # If health endpoint is responding, consider it ready regardless of connecting servers
                if [ "$connecting_count" -ge 0 ]; then
                    success "MCP Hub is ready with most servers initialized"
                    return 0
                fi
            else
                log "MCP Hub API not fully ready yet..."
            fi
        else
            log "MCP Hub not responding yet..."
        fi
        
        log "Waiting for MCP Hub to be ready... ($waited/${max_wait}s)"
        sleep $check_interval
        waited=$((waited + check_interval))
    done
    
    warn "MCP Hub readiness timeout reached, proceeding with authentication anyway"
    return 1
}

# Handle graceful shutdown
cleanup() {
    log "Received shutdown signal, cleaning up..."
    
    # Stop REST API server first
    if [ -f "/tmp/rest-api.pid" ]; then
        local pid
        pid=$(cat /tmp/rest-api.pid 2>/dev/null || echo "")
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            log "Stopping REST API server process (PID: $pid)"
            kill "$pid" 2>/dev/null || true
            rm -f /tmp/rest-api.pid
        fi
    fi
    
    # Stop MCP Hub process
    if [ -f "/tmp/mcp-hub.pid" ]; then
        local pid
        pid=$(cat /tmp/mcp-hub.pid 2>/dev/null || echo "")
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            log "Stopping MCP Hub process (PID: $pid)"
            kill "$pid" 2>/dev/null || true
            rm -f /tmp/mcp-hub.pid
        fi
    fi
    
    # Stop Wix auth process
    if [ -f "/tmp/wix-auth.pid" ]; then
        local pid
        pid=$(cat /tmp/wix-auth.pid 2>/dev/null || echo "")
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            log "Stopping Wix authentication process (PID: $pid)"
            kill "$pid" 2>/dev/null || true
            rm -f /tmp/wix-auth.pid
        fi
    fi
    
    # Stop Google Workspace auth process
    if [ -f "/tmp/workspace-auth.pid" ]; then
        local pid
        pid=$(cat /tmp/workspace-auth.pid 2>/dev/null || echo "")
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            log "Stopping Google Workspace authentication process (PID: $pid)"
            kill "$pid" 2>/dev/null || true
            rm -f /tmp/workspace-auth.pid
        fi
    fi
    
    # Stop any remaining background processes
    jobs -p | xargs -r kill 2>/dev/null || true
    
    success "Cleanup completed"
}


# Set up signal handlers
trap cleanup EXIT INT TERM

# Start authentication scripts after MCP Hub is ready
start_authentication_scripts() {
    log "Starting authentication scripts now that MCP Hub is ready..."
    
    # Start Wix authentication if enabled
    start_wix_auth
    
    # Start Google Workspace authentication if enabled
    start_google_workspace_auth
    
    success "Authentication scripts started"
}

# Main execution with proper startup order
main() {
    log "MCP Hub container startup initiated"
    log "Node.js version: $(node --version)"
    log "Python version: $(python --version 2>&1 || echo 'Python not available')"
    
    # Initialize environment
    initialize_environment
    
    # Display startup information
    success "Container initialization completed"
    log "Starting MCP Hub on port ${PORT:-37373}..."
    
    if should_enable_wix; then
        log "Wix integration: ENABLED"
        if [ "$WIX_AUTO_AUTH" = "true" ]; then
            log "Wix auth mode: AUTOMATIC (will start after MCP Hub is ready)"
        else
            log "Wix auth mode: MANUAL"
            log "To authenticate: docker exec -it mcp-hub /app/scripts/wix-auth.sh"
        fi
    else
        log "Wix integration: DISABLED"
    fi
    
    if should_enable_google_workspace; then
        log "Google Workspace integration: ENABLED"
        if [ "$GOOGLE_WORKSPACE_AUTO_AUTH" = "true" ]; then
            log "Google Workspace auth mode: AUTOMATIC (will start after MCP Hub is ready)"
        else
            log "Google Workspace auth mode: MANUAL"
            log "To authenticate: docker exec -it mcp-hub /app/scripts/google-workspace-auth.sh"
        fi
    else
        log "Google Workspace integration: DISABLED"
    fi
    
    # Start MCP Hub REST API server on port 8001 in background
    log "Starting MCP Hub REST API server on port 8001..."
    node /app/src/utils/cli.js --port "8001" --config "/app/config/mcp-servers.json" "$@" &
    REST_API_PID=$!
    echo "$REST_API_PID" > /tmp/rest-api.pid
    
    # Give REST API a moment to start
    sleep 2
    
    # Start MCP Hub CLI server on port 37373 in background
    log "Starting MCP Hub MCP protocol server on port ${PORT:-37373}..."
    node cli.js --port "${PORT:-37373}" --config "/app/config/mcp-servers.json" "$@" &
    MCP_HUB_PID=$!
    echo "$MCP_HUB_PID" > /tmp/mcp-hub.pid
    
    # Wait for MCP Hub to be ready
    wait_for_mcp_hub_ready
    
    # Now start authentication scripts
    start_authentication_scripts
    
    success "MCP Hub startup completed with authentication"
    log "REST API Server PID: $REST_API_PID (port 8001)"
    log "MCP Hub PID: $MCP_HUB_PID (port ${PORT:-37373})"
    log "Monitor Wix auth: tail -f /app/logs/wix-auth.log"
    log "Monitor Google Workspace auth: tail -f /app/logs/google-workspace-auth.log"
    
    # Wait for both processes (wait for the first one to exit)
    wait
}

# Run main function with all arguments
main "$@"

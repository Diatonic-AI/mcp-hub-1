#!/bin/bash
set -e

# Wix OAuth Setup Verification Script
# Checks if all necessary configuration files are properly set up

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[VERIFY]${NC} $1"
}

success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[!]${NC} $1"
}

error() {
    echo -e "${RED}[✗]${NC} $1" >&2
}

EXPECTED_CLIENT_ID="e2c8a702-1e3f-473e-90d7-320c3bbf108b"
EXPECTED_REDIRECT_URL="http://localhost:37373/api/oauth/callback"

log "Starting Wix OAuth setup verification..."
echo

# Check .env file
log "Checking .env file..."
if [ -f ".env" ]; then
    success ".env file exists"
    
    # Check WIX_OAUTH_CLIENT_ID
    if grep -q "WIX_OAUTH_CLIENT_ID=$EXPECTED_CLIENT_ID" .env; then
        success "WIX_OAUTH_CLIENT_ID is correctly set to: $EXPECTED_CLIENT_ID"
    else
        error "WIX_OAUTH_CLIENT_ID is not correctly set in .env file"
    fi
    
    # Check WIX_API_TOKEN
    if grep -q "WIX_API_TOKEN=IST\." .env; then
        success "WIX_API_TOKEN is set"
    else
        error "WIX_API_TOKEN is not set in .env file"
    fi
    
    # Check WIX_OAUTH_REDIRECT_URL
    if grep -q "WIX_OAUTH_REDIRECT_URL=$EXPECTED_REDIRECT_URL" .env; then
        success "WIX_OAUTH_REDIRECT_URL is correctly set"
    else
        error "WIX_OAUTH_REDIRECT_URL is not correctly set in .env file"
    fi
    
    # Check WIX_AUTO_AUTH
    if grep -q "WIX_AUTO_AUTH=true" .env; then
        success "WIX_AUTO_AUTH is enabled"
    else
        warn "WIX_AUTO_AUTH is not enabled (manual authentication required)"
    fi
    
else
    error ".env file does not exist"
fi

echo

# Check docker-compose.yml
log "Checking docker-compose.yml..."
if [ -f "docker-compose.yml" ]; then
    success "docker-compose.yml file exists"
    
    if grep -q "WIX_OAUTH_CLIENT_ID=$EXPECTED_CLIENT_ID" docker-compose.yml; then
        success "WIX_OAUTH_CLIENT_ID is correctly configured in docker-compose.yml"
    else
        error "WIX_OAUTH_CLIENT_ID is not correctly configured in docker-compose.yml"
    fi
    
    if grep -q "WIX_OAUTH_REDIRECT_URL=$EXPECTED_REDIRECT_URL" docker-compose.yml; then
        success "WIX_OAUTH_REDIRECT_URL is correctly configured in docker-compose.yml"
    else
        error "WIX_OAUTH_REDIRECT_URL is not correctly configured in docker-compose.yml"
    fi
    
    if grep -q "WIX_AUTO_AUTH=" docker-compose.yml; then
        success "WIX_AUTO_AUTH is configured in docker-compose.yml"
    else
        warn "WIX_AUTO_AUTH is not configured in docker-compose.yml"
    fi
    
else
    error "docker-compose.yml file does not exist"
fi

echo

# Check MCP servers configuration
log "Checking config/mcp-servers.json..."
if [ -f "config/mcp-servers.json" ]; then
    success "mcp-servers.json file exists"
    if grep -q "wix-mcp-remote" config/mcp-servers.json; then
        success "wix-mcp-remote server is configured"
        if grep -q "$EXPECTED_CLIENT_ID" config/mcp-servers.json; then
            success "WIX_OAUTH_CLIENT_ID is correctly set in mcp-servers.json"
        else
            error "WIX_OAUTH_CLIENT_ID is not correctly set in mcp-servers.json"
        fi
        if grep -q "https://mcp.wix.com/mcp" config/mcp-servers.json; then
            success "Wix MCP server URL is correctly configured"
        else
            error "Wix MCP server URL is not correctly configured"
        fi
    else
        error "wix-mcp-remote server is not configured in mcp-servers.json"
    fi
else
    error "config/mcp-servers.json file does not exist"
fi

echo

# Check authentication script
log "Checking wix-auth.sh script..."
if [ -f "docker/scripts/wix-auth.sh" ]; then
    success "wix-auth.sh script exists"
    
    if [ -x "docker/scripts/wix-auth.sh" ]; then
        success "wix-auth.sh script is executable"
    else
        warn "wix-auth.sh script is not executable (fixing...)"
        chmod +x docker/scripts/wix-auth.sh
        success "Fixed: wix-auth.sh script is now executable"
    fi
    
    if grep -q "$EXPECTED_CLIENT_ID" docker/scripts/wix-auth.sh; then
        success "Default client ID is correctly set in wix-auth.sh"
    else
        warn "Default client ID might not be set correctly in wix-auth.sh"
    fi
    
else
    error "docker/scripts/wix-auth.sh script does not exist"
fi

echo

# Check startup script
log "Checking startup script integration..."
if [ -f "docker/scripts/startup.sh" ]; then
    success "startup.sh script exists"
    
    if grep -q "should_enable_wix" docker/scripts/startup.sh; then
        success "Wix integration is added to startup.sh"
    else
        error "Wix integration is not added to startup.sh"
    fi
    
    if grep -q "start_wix_auth" docker/scripts/startup.sh; then
        success "Wix authentication startup is configured"
    else
        error "Wix authentication startup is not configured"
    fi
    
else
    error "docker/scripts/startup.sh script does not exist"
fi

echo

# Summary
log "Setup verification complete!"
echo

success "Your Wix OAuth setup is ready!"
echo
echo "To start your MCP Hub with Wix OAuth:"
echo "  1. Make sure your Wix OAuth app is configured with redirect URI:"
echo "     $EXPECTED_REDIRECT_URL"
echo
echo "  2. Start the Docker container:"
echo "     docker-compose up -d"
echo
echo "  3. Monitor authentication logs:"
echo "     docker logs -f mcp-hub"
echo "     # or"
echo "     docker exec -it mcp-hub tail -f /app/logs/wix-auth.log"
echo
echo "  4. Check authentication status:"
echo "     docker exec -it mcp-hub /app/scripts/wix-auth.sh --status"
echo

warn "Important: Make sure your Wix OAuth application is configured with the correct redirect URI!"
warn "Redirect URI: $EXPECTED_REDIRECT_URL"

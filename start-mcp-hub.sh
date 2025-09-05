#!/bin/bash
set -euo pipefail

echo "Starting MCP Hub with Wix Remote Integration..."

# Ensure we have the latest Node.js in PATH
export PATH="/snap/bin:$PATH"

# Set default environment variables if not already set
export WIX_OAUTH_CLIENT_ID="${WIX_OAUTH_CLIENT_ID:-G9lPrt5bqvEnSctc}"
export WIX_OAUTH_REDIRECT_URL="${WIX_OAUTH_REDIRECT_URL:-http://localhost:3000/callback}"

# Check if WIX_API_TOKEN is set
if [ -z "${WIX_API_TOKEN:-}" ]; then
    echo "WARNING: WIX_API_TOKEN is not set. You may need to set this for authentication."
    echo "Example: export WIX_API_TOKEN='your-token-here'"
fi

# Start MCP Hub
echo "Starting MCP Hub on port 37373..."
echo "Configuration: $(pwd)/config/wix-mcp-config.json"
echo "Wix Remote Server: https://mcp.wix.com/mcp"
echo ""
echo "Access URLs:"
echo "  - MCP Endpoint: http://localhost:37373/mcp"
echo "  - Health Check: http://localhost:37373/api/health"
echo "  - REST API: http://localhost:37373/api/*"
echo ""

./dist/cli.js --port 37373 --config config/wix-mcp-config.json --watch

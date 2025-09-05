#!/usr/bin/env bash

# Script to add official MCP servers to mcp-hub configuration
# Created: 2025-09-03

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CONFIG_FILE="./docker/config/mcp-servers.json"
BACKUP_FILE="${CONFIG_FILE}.backup.$(date +%Y%m%d_%H%M%S)"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          MCP Hub - Official MCP Servers Registration Script          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════════╝${NC}"
echo

# Check if config file exists
if [[ ! -f "$CONFIG_FILE" ]]; then
    echo -e "${RED}Error: Config file not found at $CONFIG_FILE${NC}"
    exit 1
fi

# Create backup
echo -e "${YELLOW}Creating backup of current configuration...${NC}"
cp "$CONFIG_FILE" "$BACKUP_FILE"
echo -e "${GREEN}✓ Backup created: $BACKUP_FILE${NC}"
echo

# Function to add a server to the config
add_server() {
    local name="$1"
    local command="$2"
    local env_vars="${3:-}"
    local description="${4:-}"
    
    echo -e "${BLUE}Adding server: $name${NC}"
    
    # Check if server already exists
    if jq -e ".\"$name\"" "$CONFIG_FILE" > /dev/null 2>&1; then
        echo -e "${YELLOW}  ⚠ Server '$name' already exists, skipping...${NC}"
        return
    fi
    
    # Create the server JSON object
    local server_json="{\"command\": \"$command\""
    
    if [[ -n "$env_vars" ]]; then
        server_json="$server_json, \"env\": {$env_vars}"
    fi
    
    server_json="$server_json}"
    
    # Add to config file
    jq ". + {\"$name\": $server_json}" "$CONFIG_FILE" > "${CONFIG_FILE}.tmp" && mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
    
    echo -e "${GREEN}  ✓ Added '$name'${NC}"
}

echo -e "${BLUE}════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Adding Active Official MCP Servers${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════════${NC}"
echo

# Active servers from modelcontextprotocol/servers
add_server "mcp-everything" \
    "npx -y @modelcontextprotocol/server-everything" \
    "" \
    "Everything server - comprehensive testing server"

add_server "mcp-fetch" \
    "npx -y @modelcontextprotocol/server-fetch" \
    "" \
    "Fetch server - HTTP/HTTPS fetching capabilities"

# Filesystem is already added, skip
# add_server "mcp-filesystem" \
#     "npx -y @modelcontextprotocol/server-filesystem" \
#     "" \
#     "Filesystem server - file system operations"

add_server "mcp-git" \
    "npx -y @modelcontextprotocol/server-git" \
    "" \
    "Git server - Git repository operations"

add_server "mcp-memory" \
    "npx -y @modelcontextprotocol/server-memory" \
    "" \
    "Memory server - knowledge graph memory system"

add_server "mcp-sequential-thinking" \
    "npx -y @modelcontextprotocol/server-sequentialthinking" \
    "" \
    "Sequential thinking server - step-by-step reasoning"

add_server "mcp-time" \
    "npx -y @modelcontextprotocol/server-time" \
    "" \
    "Time server - time and date operations"

echo
echo -e "${BLUE}════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Adding Archived Official MCP Servers${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════════${NC}"
echo

# Archived servers (some may require API keys)
add_server "mcp-aws-kb-retrieval" \
    "npx -y @modelcontextprotocol/server-aws-kb-retrieval" \
    "\"AWS_REGION\": \"\", \"AWS_ACCESS_KEY_ID\": \"\", \"AWS_SECRET_ACCESS_KEY\": \"\"" \
    "AWS Knowledge Base Retrieval server"

add_server "mcp-brave-search" \
    "npx -y @modelcontextprotocol/server-brave-search" \
    "\"BRAVE_API_KEY\": \"\"" \
    "Brave Search server"

add_server "mcp-everart" \
    "npx -y @modelcontextprotocol/server-everart" \
    "\"EVERART_API_KEY\": \"\"" \
    "Everart server - AI art generation"

add_server "mcp-gdrive" \
    "npx -y @modelcontextprotocol/server-gdrive" \
    "\"GOOGLE_DRIVE_CLIENT_ID\": \"\", \"GOOGLE_DRIVE_CLIENT_SECRET\": \"\"" \
    "Google Drive server"

# GitHub is already added, skip
# add_server "mcp-github" \
#     "npx -y @modelcontextprotocol/server-github" \
#     "\"GITHUB_PERSONAL_ACCESS_TOKEN\": \"\"" \
#     "GitHub server"

add_server "mcp-gitlab" \
    "npx -y @modelcontextprotocol/server-gitlab" \
    "\"GITLAB_API_TOKEN\": \"\", \"GITLAB_URL\": \"https://gitlab.com\"" \
    "GitLab server"

add_server "mcp-google-maps" \
    "npx -y @modelcontextprotocol/server-google-maps" \
    "\"GOOGLE_MAPS_API_KEY\": \"\"" \
    "Google Maps server"

add_server "mcp-postgres" \
    "npx -y @modelcontextprotocol/server-postgres" \
    "\"POSTGRES_CONNECTION_STRING\": \"\"" \
    "PostgreSQL server"

add_server "mcp-puppeteer" \
    "npx -y @modelcontextprotocol/server-puppeteer" \
    "" \
    "Puppeteer server - browser automation"

add_server "mcp-redis" \
    "npx -y @modelcontextprotocol/server-redis" \
    "\"REDIS_URL\": \"redis://localhost:6379\"" \
    "Redis server"

add_server "mcp-sentry" \
    "npx -y @modelcontextprotocol/server-sentry" \
    "\"SENTRY_AUTH_TOKEN\": \"\", \"SENTRY_ORG\": \"\"" \
    "Sentry server - error tracking"

add_server "mcp-slack" \
    "npx -y @modelcontextprotocol/server-slack" \
    "\"SLACK_TOKEN\": \"\"" \
    "Slack server"

add_server "mcp-sqlite" \
    "npx -y @modelcontextprotocol/server-sqlite" \
    "" \
    "SQLite server"

echo
echo -e "${BLUE}════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Popular Community MCP Servers (Optional)${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════════${NC}"
echo

# Add some popular community servers
add_server "docker-mcp" \
    "npx -y docker-mcp" \
    "" \
    "Docker MCP Server - Docker container management"

add_server "kubernetes-mcp" \
    "npx -y @containers/kubernetes-mcp-server" \
    "" \
    "Kubernetes MCP Server - K8s cluster management"

add_server "firebase-mcp" \
    "npx -y firebase-mcp" \
    "\"FIREBASE_API_KEY\": \"\", \"FIREBASE_PROJECT_ID\": \"\"" \
    "Firebase MCP Server"

echo
echo -e "${GREEN}════════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Configuration Complete!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════════════${NC}"
echo

# Show summary
TOTAL_SERVERS=$(jq 'keys | length' "$CONFIG_FILE")
echo -e "${BLUE}Summary:${NC}"
echo -e "  • Total servers configured: ${GREEN}$TOTAL_SERVERS${NC}"
echo -e "  • Configuration file: ${YELLOW}$CONFIG_FILE${NC}"
echo -e "  • Backup saved to: ${YELLOW}$BACKUP_FILE${NC}"
echo

echo -e "${YELLOW}Next Steps:${NC}"
echo -e "  1. Review and add API keys for servers that require them"
echo -e "  2. Restart the MCP Hub container to apply changes:"
echo -e "     ${BLUE}docker-compose restart${NC}"
echo -e "  3. Check server status at: ${BLUE}http://localhost:3001/api/servers${NC}"
echo

echo -e "${YELLOW}To add API keys, edit the configuration file:${NC}"
echo -e "  ${BLUE}nano $CONFIG_FILE${NC}"
echo
echo -e "${YELLOW}Example API key configuration:${NC}"
cat << 'EOF'
  "mcp-brave-search": {
    "command": "npx -y @modelcontextprotocol/server-brave-search",
    "env": {
      "BRAVE_API_KEY": "your-actual-api-key-here"
    }
  }
EOF
echo
echo -e "${GREEN}Script complete!${NC}"

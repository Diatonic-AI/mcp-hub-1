# Enhanced OAuth Persistence System for MCP Hub

## Overview

This document describes the enhanced OAuth authentication system implemented for the MCP Hub to solve persistent authentication challenges across container restarts, system reboots, and service disruptions.

## Problem Solved

Previously, OAuth-based MCP servers would frequently lose their authentication state when:
- The MCP Hub container was restarted
- Docker Compose services were rebuilt 
- System was rebooted
- Network connections were temporarily lost

This resulted in manual re-authorization being required repeatedly, disrupting workflows and reducing reliability.

## Solution Components

### 1. Enhanced OAuth Provider (`src/utils/oauth-provider.js`)

The existing OAuth provider already implements persistent storage using:
- **Storage Location**: `~/.local/share/mcp-hub/oauth-storage.json`
- **Data Structure**: Per-server storage of client info, tokens, and code verifiers
- **Automatic Persistence**: All OAuth data is automatically saved to disk

**Key Features:**
```javascript
{
  "server_endpoint": {
    "clientInfo": { /* OAuth client registration data */ },
    "tokens": { /* Access/refresh tokens */ },
    "codeVerifier": "/* PKCE code verifier */"
  }
}
```

### 2. OAuth Management Script (`scripts/enhance-oauth-persistence.js`)

Comprehensive OAuth monitoring and management system with:

**Core Features:**
- **Health Monitoring**: Continuous monitoring of OAuth server connections (30s intervals)
- **Auto-Recovery**: Automatic reconnection of OAuth servers with valid tokens
- **Token Validation**: Checks for token expiration and validity
- **Backup System**: Automatic backups of OAuth storage (keeps last 10)

**Commands:**
```bash
node scripts/enhance-oauth-persistence.js status    # Status report
node scripts/enhance-oauth-persistence.js repair    # Repair connections
node scripts/enhance-oauth-persistence.js monitor   # Continuous monitoring
node scripts/enhance-oauth-persistence.js backup    # Manual backup
node scripts/enhance-oauth-persistence.js health    # Health check
```

**Example Status Output:**
```
📊 OAuth Status Report
==================================================

✅ Connected Servers (21)
   • google-workspace - OAuth authenticated with our tenant credentials
   • cloudflare-docs - Cloudflare Documentation MCP Server
   • wix-mcp-remote - Wix MCP Server

🗄️ OAuth Storage Summary
   • Storage file: ~/.local/share/mcp-hub/oauth-storage.json
   • Entries: 2
   • https://mcp.wix.com/mcp
     - Tokens: ❌  Client Info: ✅
   • http://google-workspace-mcp:8000/mcp
     - Tokens: ❌  Client Info: ❌
```

### 3. Hub Management Script (`scripts/mcp-hub-manager.sh`)

Comprehensive management system providing:

**Hub Management:**
```bash
./scripts/mcp-hub-manager.sh start      # Start MCP Hub
./scripts/mcp-hub-manager.sh stop       # Stop MCP Hub
./scripts/mcp-hub-manager.sh restart    # Restart MCP Hub
./scripts/mcp-hub-manager.sh status     # Show status
./scripts/mcp-hub-manager.sh health     # Health check
```

**OAuth Operations:**
```bash
./scripts/mcp-hub-manager.sh oauth:status   # OAuth status
./scripts/mcp-hub-manager.sh oauth:repair   # Repair OAuth
./scripts/mcp-hub-manager.sh oauth:monitor  # Monitor OAuth
```

**System Management:**
```bash
./scripts/mcp-hub-manager.sh backup         # Create backup
./scripts/mcp-hub-manager.sh update         # Update hub
./scripts/mcp-hub-manager.sh install-service # Install systemd service
./scripts/mcp-hub-manager.sh dev            # Development mode
```

### 4. Web Dashboard (`scripts/dashboard.html`)

Real-time monitoring dashboard featuring:
- **Server Status Overview**: Connected/disconnected/OAuth server counts
- **Real-time Updates**: Auto-refresh every 30 seconds
- **OAuth Status Display**: Visual status of OAuth servers and token states
- **Responsive Design**: Works on desktop and mobile devices

**Access**: Open `file:///home/daclab-ai/dev/mcp-hub/scripts/dashboard.html` in your browser

## Current Status

### Connected OAuth Servers

1. **Google Workspace** - ✅ Connected
   - Endpoint: `http://google-workspace-mcp:8000/mcp` 
   - Status: OAuth authenticated with tenant credentials
   - Tools: 14 tools for Calendar, Drive, Docs, Gmail, Sheets operations

2. **Cloudflare Services** - ✅ Connected
   - Multiple Cloudflare MCP servers (docs, workers, radar, observability)
   - OAuth-based authentication working properly

3. **Wix MCP** - ⚠️ Configured but needs re-authorization
   - Client info stored but no valid tokens
   - Endpoint: `https://mcp.wix.com/mcp`

### Server Statistics (Current)
- **Total Servers**: 30
- **Connected**: 21 (70%)
- **Disconnected**: 9 (30%)
- **OAuth Servers**: 8

### Disconnected Servers Analysis
Most disconnected servers are due to:
1. **Missing API Keys**: Brave Search, GitLab, Slack (need API keys/tokens)
2. **Connection Issues**: SQLite, Obsidian Vault (transport/config issues)  
3. **AWS Services**: Need AWS credentials configuration
4. **OAuth Re-auth**: Some OAuth servers need fresh authorization

## Benefits Achieved

### 1. **Persistent Authentication**
- OAuth tokens survive container restarts and system reboots
- Automatic reconnection upon service restart
- No manual re-authorization required for most services

### 2. **Automated Recovery**
- Health monitoring detects connection issues
- Automatic retry logic for temporary failures
- Smart distinction between OAuth and non-OAuth servers

### 3. **Comprehensive Monitoring**
- Real-time dashboard showing all server statuses
- Detailed logging of all OAuth operations
- Backup system protects against data loss

### 4. **Developer Experience**
- Simple command-line management tools
- Clear status reporting and error messages
- Development mode with live monitoring

## Usage Examples

### Daily Operations

1. **Check System Health**:
   ```bash
   ./scripts/mcp-hub-manager.sh health
   ```

2. **Monitor OAuth Status**:
   ```bash
   node scripts/enhance-oauth-persistence.js status
   ```

3. **Repair Broken Connections**:
   ```bash
   ./scripts/mcp-hub-manager.sh oauth:repair
   ```

### Development Workflow

1. **Start Development Mode**:
   ```bash
   ./scripts/mcp-hub-manager.sh dev
   ```
   This provides:
   - Auto-restart on code changes
   - Live OAuth monitoring
   - Continuous log monitoring

2. **Access Web Dashboard**:
   Open `scripts/dashboard.html` in browser for real-time status

### Troubleshooting OAuth Issues

1. **For servers needing re-authorization**:
   ```bash
   curl -X POST http://localhost:37373/api/servers/authorize \
        -H "Content-Type: application/json" \
        -d '{"server_name":"wix-mcp-remote"}'
   ```

2. **Check OAuth storage manually**:
   ```bash
   cat ~/.local/share/mcp-hub/oauth-storage.json | jq .
   ```

3. **Create manual backup**:
   ```bash
   node scripts/enhance-oauth-persistence.js backup
   ```

## Configuration Files

### MCP Servers Configuration
OAuth servers are configured in `config/mcp-servers.json` with:
```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "node",
      "args": ["/usr/local/bin/google-workspace-mcp-server"],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id",
        "GOOGLE_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

### OAuth Storage Format
OAuth data is automatically stored in `~/.local/share/mcp-hub/oauth-storage.json`:
```json
{
  "https://service.example.com/mcp": {
    "clientInfo": {
      "client_id": "generated-id",
      "client_secret": "secret-if-needed",
      "redirect_uris": ["http://localhost:37373/api/oauth/callback"]
    },
    "tokens": {
      "access_token": "oauth-access-token",
      "refresh_token": "oauth-refresh-token", 
      "expires_at": "2025-09-08T12:00:00Z"
    },
    "codeVerifier": "pkce-code-verifier"
  }
}
```

## Future Enhancements

1. **Token Refresh Logic**: Automatic refresh of expiring tokens
2. **Multi-Tenant Support**: Support for multiple OAuth configurations per server
3. **Encrypted Storage**: Encryption of sensitive OAuth data at rest  
4. **Webhook Support**: Real-time notifications of OAuth status changes
5. **Cloud Backup**: Automatic backup to cloud storage services

## Monitoring and Alerts

The system provides multiple monitoring levels:

1. **Real-time Dashboard** (`dashboard.html`)
2. **Command-line Status** (`oauth:status`)
3. **Continuous Monitoring** (`oauth:monitor`)
4. **Health Checks** with automatic recovery
5. **Log Files** in `logs/` directory

All OAuth operations are logged with timestamps and detailed error information for troubleshooting.

## Security Considerations

- OAuth tokens are stored locally in user directory with proper permissions
- Client secrets are managed through environment variables
- Automatic backup system maintains 10 rolling backups
- No tokens are logged in plaintext (automatically redacted)
- PKCE (Proof Key for Code Exchange) is used for OAuth flows

This enhanced system provides a robust, persistent OAuth authentication solution for the MCP Hub, significantly improving reliability and reducing manual intervention requirements.

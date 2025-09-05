# MCP Servers API Keys & Configuration Guide

This document lists all MCP servers configured in your MCP Hub and their API key/configuration requirements.

## 🔓 Servers That Work Out of the Box (No API Key Required)

These servers can be used immediately without any additional configuration:

### TypeScript/Node.js Servers
- **mcp-everything** - Comprehensive testing server with all capabilities
- **mcp-memory** - Knowledge graph memory system  
- **mcp-sequential-thinking** - Step-by-step reasoning
- **mcp-puppeteer** - Browser automation
- **filesystem** - File system operations

### Python Servers
- **mcp-fetch** - HTTP/HTTPS fetching capabilities
- **mcp-git** - Git repository operations
- **mcp-time** - Time and date operations
- **mcp-sqlite** - SQLite database operations

## 🔑 Servers That Require API Keys or Configuration

### ✅ Already Configured
- **github** - GitHub operations
  - **Status**: ✅ CONFIGURED
  - **API Key**: `GITHUB_PERSONAL_ACCESS_TOKEN` is already set
  - **Current Token**: `gho_67M1...` (active)

### ⚠️ Need Configuration

#### 1. **mcp-brave-search** - Brave Search API
- **Required**: `BRAVE_API_KEY`
- **How to get**: 
  1. Go to https://brave.com/search/api/
  2. Sign up for a free account
  3. Get your API key from the dashboard
- **Add to config**: 
  ```json
  "env": {
    "BRAVE_API_KEY": "YOUR_BRAVE_API_KEY_HERE"
  }
  ```

#### 2. **mcp-gdrive** - Google Drive
- **Required**: `GOOGLE_DRIVE_CLIENT_ID` and `GOOGLE_DRIVE_CLIENT_SECRET`
- **How to get**:
  1. Go to https://console.cloud.google.com/
  2. Create a new project or select existing
  3. Enable Google Drive API
  4. Create OAuth 2.0 credentials
  5. Download client configuration
- **Add to config**:
  ```json
  "env": {
    "GOOGLE_DRIVE_CLIENT_ID": "YOUR_CLIENT_ID.apps.googleusercontent.com",
    "GOOGLE_DRIVE_CLIENT_SECRET": "YOUR_CLIENT_SECRET"
  }
  ```

#### 3. **mcp-gitlab** - GitLab
- **Required**: `GITLAB_API_TOKEN`
- **Optional**: `GITLAB_URL` (defaults to https://gitlab.com)
- **How to get**:
  1. Log in to GitLab
  2. Go to User Settings → Access Tokens
  3. Create a Personal Access Token with appropriate scopes
- **Add to config**:
  ```json
  "env": {
    "GITLAB_API_TOKEN": "YOUR_GITLAB_TOKEN",
    "GITLAB_URL": "https://gitlab.com"  // or your GitLab instance URL
  }
  ```

#### 4. **mcp-google-maps** - Google Maps
- **Required**: `GOOGLE_MAPS_API_KEY`
- **How to get**:
  1. Go to https://console.cloud.google.com/
  2. Enable Google Maps APIs (Places, Geocoding, etc.)
  3. Create an API key
  4. Restrict key to specific APIs for security
- **Add to config**:
  ```json
  "env": {
    "GOOGLE_MAPS_API_KEY": "YOUR_GOOGLE_MAPS_API_KEY"
  }
  ```

#### 5. **mcp-postgres** - PostgreSQL Database
- **Required**: `POSTGRES_CONNECTION_STRING`
- **Format**: `postgresql://username:password@host:port/database`
- **Examples**:
  - Local: `postgresql://user:pass@localhost:5432/mydb`
  - Remote: `postgresql://user:pass@db.example.com:5432/mydb`
- **Add to config**:
  ```json
  "env": {
    "POSTGRES_CONNECTION_STRING": "postgresql://username:password@host:port/database"
  }
  ```

#### 6. **mcp-slack** - Slack
- **Required**: `SLACK_TOKEN`
- **How to get**:
  1. Go to https://api.slack.com/apps
  2. Create a new Slack app
  3. Install app to workspace
  4. Get the Bot User OAuth Token (starts with `xoxb-`)
- **Add to config**:
  ```json
  "env": {
    "SLACK_TOKEN": "xoxb-your-slack-bot-token"
  }
  ```

## 📝 How to Add API Keys

1. **Edit the configuration file**:
   ```bash
   nano /home/daclab-ai/dev/mcp-hub/docker/config/mcp-servers.json
   ```

2. **Find the server you want to configure** and add/update the `env` section with your API key.

3. **Save the file** (Ctrl+O, Enter, Ctrl+X in nano)

4. **The MCP Hub will automatically reload** the configuration (hot reload is enabled)

## 🔒 Security Notes

- **Never commit API keys to Git** - The config file should be in `.gitignore`
- **Use environment variables** for production deployments
- **Rotate keys regularly** for security
- **Use restricted scopes** where possible (e.g., read-only access)

## 📊 Current Configuration Status

| Server | Type | API Key Required | Status |
|--------|------|-----------------|---------|
| filesystem | Node.js | No | ✅ Ready |
| github | Node.js | Yes | ✅ Configured |
| mcp-everything | Node.js | No | ✅ Ready |
| mcp-fetch | Python | No | ✅ Ready |
| mcp-git | Python | No | ✅ Ready |
| mcp-memory | Node.js | No | ✅ Ready |
| mcp-sequential-thinking | Node.js | No | ✅ Ready |
| mcp-time | Python | No | ✅ Ready |
| mcp-puppeteer | Node.js | No | ✅ Ready |
| mcp-sqlite | Python | No | ✅ Ready |
| mcp-brave-search | Node.js | Yes | ⚠️ Needs API Key |
| mcp-gdrive | Node.js | Yes | ⚠️ Needs OAuth Credentials |
| mcp-gitlab | Node.js | Yes | ⚠️ Needs API Token |
| mcp-google-maps | Node.js | Yes | ⚠️ Needs API Key |
| mcp-postgres | Node.js | Yes | ⚠️ Needs Connection String |
| mcp-slack | Node.js | Yes | ⚠️ Needs Bot Token |
| wix-mcp-remote | Remote | No | ✅ Ready |

## 🚀 Quick Start

Servers that work immediately without configuration:
```bash
# Test the everything server
curl http://localhost:3001/api/servers/mcp-everything

# Test the time server
curl http://localhost:3001/api/servers/mcp-time

# Test the memory server
curl http://localhost:3001/api/servers/mcp-memory
```

---

*Last updated: 2025-09-03*
*Total servers configured: 17*
*Ready to use: 11*
*Needs configuration: 6*

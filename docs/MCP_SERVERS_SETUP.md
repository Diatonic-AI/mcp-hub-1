# MCP Servers Setup Guide

## Added Servers

### 1. Google Workspace MCP Server (taylorwilsdon/google_workspace_mcp)
- **Stars**: 605+ ⭐
- **Features**: Complete Google Workspace integration
  - Gmail, Calendar, Drive, Docs, Sheets, Slides
  - Forms, Tasks, Chat, Custom Search
- **Repository**: https://github.com/taylorwilsdon/google_workspace_mcp

### 2. Microsoft Learn MCP Server (softchris/learn-mcp)  
- **Stars**: 5 ⭐
- **Features**: Microsoft Learn documentation search
  - Free text search
  - Topic-based search
  - Filter support
- **Repository**: https://github.com/softchris/learn-mcp

## 🐳 Docker-Based Setup (Recommended)

Both MCP servers are now containerized and managed via Docker for easier deployment and management.

### Quick Start

```bash
# 1. Setup environment variables
./scripts/manage-mcp-servers.sh setup-env
# Edit .env file with your credentials

# 2. Build Docker images
./scripts/manage-mcp-servers.sh build

# 3. Start all servers
./scripts/manage-mcp-servers.sh start

# 4. Check status
./scripts/manage-mcp-servers.sh status
```

### Management Commands

```bash
# Interactive menu
./scripts/manage-mcp-servers.sh

# Start/stop specific server
./scripts/manage-mcp-servers.sh start google-workspace
./scripts/manage-mcp-servers.sh stop microsoft-learn

# View logs
./scripts/manage-mcp-servers.sh logs google-workspace
./scripts/manage-mcp-servers.sh logs microsoft-learn true  # Follow logs

# Restart a server
./scripts/manage-mcp-servers.sh restart google-workspace
```

## Setup Instructions

### Google Workspace MCP Server

#### Method 1: Using uvx (Recommended - Python package from PyPI)
The server is configured to run directly via `uvx` which will automatically install from PyPI:

```bash
# The server is already configured in mcp-servers.json
# It will run: uvx workspace-mcp --tool-tier core
```

#### Prerequisites
1. **Install uv/uvx**: 
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

2. **Google Cloud Setup**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing
   - Enable APIs: Calendar, Drive, Gmail, Docs, Sheets, Slides, Forms, Tasks, Chat
   - Create OAuth 2.0 credentials:
     - APIs & Services → Credentials → Create Credentials → OAuth Client ID
     - Application type: **Desktop Application**
     - Download the credentials

3. **Set Environment Variables**:
   ```bash
   # Add to your ~/.bashrc or ~/.zshrc
   export GOOGLE_OAUTH_CLIENT_ID="your-client-id.apps.googleusercontent.com"
   export GOOGLE_OAUTH_CLIENT_SECRET="your-client-secret"
   export USER_GOOGLE_EMAIL="your-email@gmail.com"  # Optional
   export OAUTHLIB_INSECURE_TRANSPORT=1  # For development only
   
   # Optional: For Custom Search
   export GOOGLE_PSE_API_KEY="your-api-key"
   export GOOGLE_PSE_ENGINE_ID="your-engine-id"
   ```

#### Tool Tiers
- `core` - Essential tools only (Gmail, Drive, Calendar, Docs)
- `extended` - Core + additional tools
- `complete` - All available tools

#### Authentication Flow
On first run, the server will:
1. Open a browser for Google OAuth authentication
2. Ask you to authorize the requested scopes
3. Store tokens locally for future use

### Microsoft Learn MCP Server

This is a Python-based SSE server that needs to be run separately.

#### Setup Steps

1. **Clone and Install**:
   ```bash
   # Clone the repository
   cd ~/dev
   git clone https://github.com/softchris/learn-mcp.git
   cd learn-mcp
   
   # Create virtual environment
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   
   # Install dependencies
   pip install requests "mcp[cli]"
   ```

2. **Start the Server**:
   ```bash
   cd src
   python server.py  # Starts on http://localhost:8000
   ```

3. **The server is already configured in mcp-servers.json** to connect via SSE at `http://localhost:8000/sse`

#### Available Tools
- `learn_filter()` - Returns available filters for Microsoft Learn
- `free_text(query)` - Free text search across Microsoft Learn
- `topic_search(category, topic)` - Search by topic and category

## Using with MCP Hub

Both servers have been added to `mcp-servers.json`:

1. **Google Workspace** (`google-workspace`):
   - Type: stdio
   - Command: uvx workspace-mcp
   - Auto-starts with MCP Hub
   - Requires environment variables

2. **Microsoft Learn** (`microsoft-learn`):
   - Type: SSE
   - URL: http://localhost:8000/sse
   - Requires manual server start

## Testing the Servers

### Google Workspace
```bash
# Test with MCP Hub
npm start
# The google-workspace server should auto-start
# Check logs for authentication flow
```

### Microsoft Learn
```bash
# Terminal 1: Start the Learn server
cd ~/dev/learn-mcp/src
python server.py

# Terminal 2: Start MCP Hub
cd ~/dev/mcp-hub
npm start
# The microsoft-learn server should connect to the SSE endpoint
```

## Troubleshooting

### Google Workspace Issues
1. **Authentication fails**: 
   - Check GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are set
   - Ensure you're using Desktop Application OAuth credentials
   - Delete ~/.mcp-auth if you need to reset auth

2. **APIs not enabled**:
   - Go to Google Cloud Console → APIs & Services → Library
   - Search and enable each required API

3. **uvx not found**:
   - Install uv: `curl -LsSf https://astral.sh/uv/install.sh | sh`
   - Add to PATH if needed

### Microsoft Learn Issues
1. **Server won't start**:
   - Check Python version (3.10+ required)
   - Ensure virtual environment is activated
   - Verify all dependencies installed

2. **Connection refused**:
   - Make sure server is running on port 8000
   - Check firewall settings
   - Verify no other service using port 8000

## Security Notes

⚠️ **Important Security Considerations**:
- Never commit OAuth credentials to version control
- Use environment variables or secure credential storage
- `OAUTHLIB_INSECURE_TRANSPORT=1` should only be used in development
- For production, use proper HTTPS endpoints

## Additional Resources

- [Google Workspace MCP Documentation](https://github.com/taylorwilsdon/google_workspace_mcp)
- [Google Workspace MCP Website](https://workspacemcp.com)
- [Microsoft Learn MCP Repository](https://github.com/softchris/learn-mcp)
- [MCP Protocol Documentation](https://modelcontextprotocol.io)
- [Google Cloud Console](https://console.cloud.google.com/)
- [Google API Python Client](https://github.com/googleapis/google-api-python-client)

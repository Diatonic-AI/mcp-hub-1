# MCP Hub + Wix Remote Integration Guide

## Overview
This guide shows how to integrate the Wix remote MCP server with Warp Terminal using MCP Hub as a central coordinator.

## Architecture
```
Warp Terminal <---> MCP Hub <---> Wix Remote MCP Server
    (Client)       (Coordinator)        (Remote Server)
```

## Files Created
- `wix-mcp-config.json` - Configuration for MCP Hub to connect to Wix remote
- `warp-terminal-mcp-config.json` - Configuration for Warp Terminal to connect to MCP Hub
- `start-mcp-hub.sh` - Script to start MCP Hub with proper configuration

## Step 1: Set Environment Variables
```bash
export WIX_API_TOKEN="your-wix-api-token-here"
export WIX_OAUTH_CLIENT_ID="G9lPrt5bqvEnSctc"
export WIX_OAUTH_REDIRECT_URL="http://localhost:3000/callback"
```

## Step 2: Start MCP Hub
```bash
./start-mcp-hub.sh
```
This starts MCP Hub on port 37373, connecting to the Wix remote server.

## Step 3: Configure Warp Terminal
Add the contents of `warp-terminal-mcp-config.json` to your Warp Terminal MCP configuration.
This configures Warp Terminal to connect to the unified MCP Hub endpoint at `http://localhost:37373/mcp`.

## Step 4: Benefits
- **Single Configuration**: Warp Terminal only needs one MCP server configured
- **Unified Interface**: Access all Wix MCP tools through one endpoint  
- **Namespacing**: Tools are automatically namespaced (e.g., `wix_mcp_remote__toolname`)
- **Real-time Updates**: Automatic capability updates when servers change
- **Health Monitoring**: Built-in health checks and reconnection

## API Endpoints
- MCP Endpoint: `http://localhost:37373/mcp`
- REST API: `http://localhost:37373/api/*`
- Health Check: `http://localhost:37373/api/health`
- Web UI: `http://localhost:37373` (if available)

## Troubleshooting
1. Check MCP Hub logs in the terminal
2. Verify Wix API token is valid
3. Test health endpoint: `curl http://localhost:37373/api/health`
4. Check network connectivity to mcp.wix.com

# Wix OAuth Setup for MCP Hub Docker

This guide explains how to set up Wix OAuth authentication for the MCP Hub in a Docker environment.

## Overview

The MCP Hub supports automated OAuth authentication for the Wix MCP server. This integration allows you to:

- Connect to Wix APIs through the MCP protocol
- Handle OAuth authentication automatically within Docker
- Monitor and maintain the OAuth connection
- Restart authentication if the token expires

## Prerequisites

1. **Wix Developer Account**: You need a Wix developer account and an OAuth app configured
2. **OAuth Application**: Your Wix OAuth app must be configured with the correct redirect URI
3. **Docker Environment**: MCP Hub running in Docker with proper port mapping

## Wix OAuth App Configuration

### 1. Redirect URI Configuration

Your Wix OAuth application must be configured with this redirect URI:

```
http://localhost:37373/api/oauth/callback
```

**Important Notes:**
- If you're running MCP Hub on a different port, adjust the port number accordingly
- If accessing from a different host, replace `localhost` with your host's IP or domain
- The path `/api/oauth/callback` is fixed by the MCP Hub OAuth implementation

### 2. OAuth Client ID

The current configuration uses the client ID: `e2c8a702-1e3f-473e-90d7-320c3bbf108b`

This is your specific Wix OAuth client ID and is already configured in all relevant files.

## Docker Configuration

### Environment Variables

Add these environment variables to your `.env` file:

```bash
# Required Wix OAuth credentials
WIX_API_TOKEN=IST.eyJraWQiOiJQb3pIX2FDMiIsImFsZyI6IlJTMjU2In0.eyJkYXRhIjoie1wiaWRcIjpcIjczZjgyZGZkLTNhYjgtNDExMC1hODZkLTM0MjI0YmQ3MWI5OVwiLFwiaWRlbnRpdHlcIjp7XCJ0eXBlXCI6XCJhcHBsaWNhdGlvblwiLFwiaWRcIjpcIjExMzMzMmM5LWU0OGYtNDgzYi1hNzVlLTI4OTYwZGM2YWJiMlwifSxcInRlbmFudFwiOntcInR5cGVcIjpcImFjY291bnRcIixcImlkXCI6XCJlMmM4YTcwMi0xZTNmLTQ3M2UtOTBkNy0zMjBjM2JiZjEwOGJcIn19IiwiaWF0IjoxNzU2OTk4MDQxfQ.ZpQqZy8PAVay7AxoxjufYT_qpNYd3XvcU3ZM12bV_yzrFMD74Jk3hVInq4VTqgKr2_Pa2zVeDKc2j9ABQihAFknz-4OPGdwyGebu7TdEoDGObvZLpYxkGOKC44hl3x40LVRt8oIJkTkUK5uK1_dUbmHc3OcdEOnhgJ7YlpYh1HOFjvFvTCqpEl7-t8IgFpqqymVthMW2rEnCvHKfh4d2s97kE01rXqRzHEmKEVm4NoaDuUgUaZP4gNJWkS0JTa5Ig6WVfG6wZOHXm0xFGlTPBSL8OrXHNz_0YRMGoQ9iMl0QEtuKZpDncVRuruVLjgn-QGnCW7QiDO4ULjAhPjL6Jg
WIX_OAUTH_CLIENT_ID=e2c8a702-1e3f-473e-90d7-320c3bbf108b
WIX_OAUTH_REDIRECT_URL=http://localhost:37373/api/oauth/callback

# Optional OAuth automation settings
WIX_AUTO_AUTH=true                  # Enable automatic OAuth authentication
WIX_AUTH_TIMEOUT=300               # Authentication timeout in seconds (5 minutes)
DISABLE_WIX=false                  # Disable Wix integration entirely
```

### Docker Compose Configuration

The `docker-compose.yml` is already configured with the necessary environment variables and port mappings:

```yaml
ports:
  - "37373:37373"  # MCP Hub main port for OAuth callback

environment:
  - WIX_OAUTH_CLIENT_ID=e2c8a702-1e3f-473e-90d7-320c3bbf108b
  - WIX_OAUTH_REDIRECT_URL=http://localhost:37373/api/oauth/callback
  - WIX_AUTO_AUTH=${WIX_AUTO_AUTH:-false}
  - WIX_AUTH_TIMEOUT=${WIX_AUTH_TIMEOUT:-300}
  - DISABLE_WIX=${DISABLE_WIX:-false}
```

## Authentication Process

### Automatic Authentication (Recommended)

1. Set `WIX_AUTO_AUTH=true` in your `.env` file
2. Start the MCP Hub container:
   ```bash
   docker-compose up -d
   ```
3. The authentication script will automatically:
   - Wait for MCP Hub to start
   - Check if Wix server needs authentication
   - Trigger the OAuth flow
   - Open your default browser (if DISPLAY is available)
   - Wait for you to complete the authentication
   - Monitor the connection continuously

### Manual Authentication

1. Set `WIX_AUTO_AUTH=false` or leave it unset
2. Start the container and run the authentication script manually:
   ```bash
   docker exec -it mcp-hub /app/scripts/wix-auth.sh
   ```

### Monitor Authentication Status

Check the authentication status:
```bash
docker exec -it mcp-hub /app/scripts/wix-auth.sh --status
```

View authentication logs:
```bash
docker logs mcp-hub
# or
docker exec -it mcp-hub tail -f /app/logs/wix-auth.log
```

## Browser Requirements

### Linux with X11 Forwarding

The container is configured with X11 forwarding to open browsers on the host:

```yaml
volumes:
  - /tmp/.X11-unix:/tmp/.X11-unix:rw
  - ${HOME}/.Xauthority:/home/mcp-hub/.Xauthority:ro
environment:
  - DISPLAY=${DISPLAY:-}
```

### Manual Browser Opening

If automatic browser opening doesn't work, the script will display the OAuth URL in the logs. Copy and paste this URL into your browser manually.

## Network Considerations

### Docker Bridge Network

The default configuration uses `localhost:37373` which works when:
- Accessing from the Docker host
- MCP Hub port 37373 is mapped to host port 37373

### Custom Network Setup

If you're using a different network setup:

1. **Different Host**: Update the redirect URL to use your host's IP or domain:
   ```bash
   WIX_OAUTH_REDIRECT_URL=http://your-host-ip:37373/api/oauth/callback
   ```

2. **Different Port**: If MCP Hub runs on a different port:
   ```bash
   WIX_OAUTH_REDIRECT_URL=http://localhost:your-port/api/oauth/callback
   ```

3. **Reverse Proxy**: If using a reverse proxy, update accordingly:
   ```bash
   WIX_OAUTH_REDIRECT_URL=https://your-domain.com/mcp-hub/api/oauth/callback
   ```

## Troubleshooting

### Authentication Fails

1. **Check OAuth App Configuration**: Ensure the redirect URI in your Wix OAuth app matches exactly
2. **Check Network Access**: Verify that port 37373 is accessible from your host
3. **Check Logs**: Review the authentication logs for specific error messages
4. **Manual Test**: Try manual authentication to isolate issues

### Connection Issues

1. **Server Status**: Check the Wix server status in MCP Hub
2. **Token Expiry**: OAuth tokens may expire; restart authentication
3. **Network Changes**: If your host IP changes, update the redirect URL

### Browser Issues

1. **No Browser Available**: Copy the OAuth URL from logs and open manually
2. **X11 Forwarding**: Ensure X11 forwarding is properly configured on Linux
3. **Browser Permissions**: Check if the browser has permission to access localhost

## Security Considerations

1. **Secure Storage**: OAuth tokens are stored in `/app/data/oauth-storage.json`
2. **Network Security**: Consider using HTTPS for production deployments
3. **Access Control**: Limit access to the OAuth callback endpoint if needed
4. **Token Management**: Tokens are automatically refreshed when possible

## Integration with MCP Hub

Once authenticated, the Wix MCP server will be available through the MCP Hub's unified interface:

- **API Access**: All Wix tools and resources are accessible via MCP Hub APIs
- **Tool Discovery**: Wix tools appear in the centralized tool registry
- **Unified Interface**: Use Wix alongside other MCP servers seamlessly

## Advanced Configuration

### Custom Authentication Script

You can extend the authentication script at `/app/scripts/wix-auth.sh` for custom requirements:

```bash
# Run with custom timeout
WIX_AUTH_TIMEOUT=600 /app/scripts/wix-auth.sh

# Run in daemon mode for monitoring
/app/scripts/wix-auth.sh --daemon
```

### Health Monitoring

The authentication script can run in daemon mode to continuously monitor the Wix connection and re-authenticate if needed:

```bash
WIX_AUTO_AUTH=true docker-compose up -d
```

This ensures your Wix integration remains active even if tokens expire or connections are lost.

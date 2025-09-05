# MCP Hub Docker Deployment Guide

## Overview
This guide provides a complete Docker-based deployment solution for MCP Hub with Wix remote MCP integration.

## Architecture
```
Host System <-> Docker Container (MCP Hub) <-> Wix Remote MCP Server
                     (Port 37373)              (mcp.wix.com)
```

## Files Created
- `Dockerfile` - Multi-stage build for optimized production image
- `docker-compose.yml` - Complete orchestration configuration
- `.dockerignore` - Optimized build context
- `.env.example` - Environment variables template
- `docker/config/mcp-servers.json` - MCP server configuration
- `docker-build.sh` - Build script
- `docker-start.sh` - Start script with auto-setup
- `docker-stop.sh` - Stop script

## Quick Start

### 1. Build the Docker Image
```bash
./docker-build.sh
```

### 2. Configure Environment
```bash
# Copy example environment file
cp .env.example .env

# Edit with your Wix API token
nano .env
```

### 3. Start the Service
```bash
./docker-start.sh
```

## Manual Docker Commands

### Build Image
```bash
docker build -t mcp-hub:latest .
```

### Run Container (Simple)
```bash
docker run -d \
  -p 37373:37373 \
  --name mcp-hub \
  -e WIX_API_TOKEN=your-token-here \
  mcp-hub:latest
```

### Run with Docker Compose
```bash
docker-compose up -d
```

## Configuration

### Environment Variables
- `WIX_API_TOKEN` - Your Wix API token (required)
- `WIX_OAUTH_CLIENT_ID` - Wix OAuth client ID (default: G9lPrt5bqvEnSctc)
- `WIX_OAUTH_REDIRECT_URL` - OAuth redirect URL (default: http://localhost:3000/callback)
- `NODE_ENV` - Node environment (default: production)
- `PORT` - Internal port (default: 37373)

### Volume Mounts
- `./docker/config:/app/config:ro` - Configuration files (read-only)
- `./docker/data:/app/data` - Persistent data
- `./docker/logs:/app/logs` - Application logs

### MCP Server Configuration
Edit `docker/config/mcp-servers.json` to modify MCP server connections:
```json
{
  "mcpServers": {
    "wix-mcp-remote": {
      "url": "https://mcp.wix.com/mcp",
      "headers": {
        "Authorization": "Bearer ${WIX_API_TOKEN}",
        "X-Client-ID": "${WIX_OAUTH_CLIENT_ID}"
      }
    }
  }
}
```

## Access Points
- **MCP Endpoint**: http://localhost:37373/mcp
- **Health Check**: http://localhost:37373/api/health
- **REST API**: http://localhost:37373/api/*

## Management Commands

### View Logs
```bash
docker-compose logs -f mcp-hub
```

### Restart Service
```bash
docker-compose restart mcp-hub
```

### Stop Service
```bash
./docker-stop.sh
# or
docker-compose down
```

### Update Configuration
```bash
# Edit configuration
nano docker/config/mcp-servers.json

# Restart to apply changes
docker-compose restart mcp-hub
```

## Warp Terminal Integration

Configure Warp Terminal to connect to the Dockerized MCP Hub:
```json
{
  "mcpServers": {
    "Hub": {
      "url": "http://localhost:37373/mcp"
    }
  }
}
```

## Docker Features

### Security
- Runs as non-root user (mcp-hub:1001)
- Multi-stage build for minimal attack surface
- Alpine Linux base for security

### Performance
- Single bundled JavaScript file (~1.8MB)
- Resource limits configurable
- Health checks for reliability

### Monitoring
- Built-in health checks every 30s
- Structured logging with rotation
- Container restart policies

### Development
- Hot configuration reload with `--watch` flag
- Volume-mounted configs for easy updates
- Debug mode support

## Troubleshooting

### Check Container Status
```bash
docker-compose ps
```

### View Health Status
```bash
curl http://localhost:37373/api/health | jq
```

### Debug Container
```bash
docker-compose exec mcp-hub sh
```

### Common Issues

1. **Port Already in Use**
   ```bash
   # Change port in docker-compose.yml
   ports:
     - "38373:37373"  # Use different external port
   ```

2. **Configuration Not Loading**
   ```bash
   # Check config file syntax
   cat docker/config/mcp-servers.json | jq
   ```

3. **Wix API Authentication**
   ```bash
   # Verify token in logs
   docker-compose logs mcp-hub | grep -i auth
   ```

## Production Considerations

### Resource Limits
Default limits in `docker-compose.yml`:
- Memory: 512MB limit, 128MB reserved
- CPU: 0.5 cores limit, 0.1 cores reserved

### Logging
- JSON file driver with 10MB rotation
- 3 file retention
- Logs available in `./docker/logs/`

### Backup
Important directories to backup:
- `./docker/config/` - Configuration files
- `./docker/data/` - Persistent application data
- `.env` - Environment variables

### Updates
To update MCP Hub:
```bash
git pull origin main
./docker-build.sh
docker-compose up -d
```

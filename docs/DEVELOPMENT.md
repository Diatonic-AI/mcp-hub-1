# MCP Hub Development Guide

This guide explains how to set up and run MCP Hub in development mode with hot-reloading and debugging capabilities.

## Quick Start

### Using Docker (Recommended)

1. **Start the development server:**
   ```bash
   ./scripts/dev.sh
   ```
   This script will:
   - Check for Docker requirements
   - Create `.env.dev` from `.env.example` if needed
   - Build the development Docker image
   - Start the server with hot-reloading enabled

2. **Access the development server:**
   - Server URL: http://localhost:37373
   - Health Check: http://localhost:37373/api/health
   - Debugger: ws://localhost:9229 (for VS Code or Chrome DevTools)

3. **Stop the development server:**
   ```bash
   docker compose -f docker-compose.dev.yml down
   ```

### Using npm (Local Development)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run in development mode:**
   ```bash
   npm run dev
   ```
   This uses nodemon to watch for file changes and automatically restart the server.

## Development Features

### Hot-Reloading

The development setup includes hot-reloading for:
- Source code changes (`src/**/*.js`)
- Configuration file changes (`config/**/*.json`)
- MCP server configuration changes

### File Watching

The MCP Hub includes built-in file watching capabilities using the `--watch` flag:
- Automatically restarts MCP servers when their source files change
- Monitors configuration files for changes
- Provides real-time feedback on server status

### Debug Mode

Development environment runs with:
- `NODE_ENV=development`
- `DEBUG=mcp-hub:*` (verbose logging)
- Node.js inspector enabled on port 9229

## Configuration

### Development Server Configuration

The development server uses the configuration file at `docker/config/mcp-servers.json`. This includes:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "description": "Filesystem access server for development testing"
    }
  }
}
```

### Environment Variables

Development environment variables are configured in `.env.dev`:
```env
NODE_ENV=development
PORT=37373
DEBUG=mcp-hub:*
LOG_LEVEL=debug
WIX_OAUTH_CLIENT_ID=G9lPrt5bqvEnSctc
WIX_OAUTH_REDIRECT_URL=http://localhost:3000/callback
```

## Testing

### Running Tests in Watch Mode

**With Docker:**
```bash
docker compose -f docker-compose.dev.yml --profile test up mcp-hub-test
```

**Local:**
```bash
npm run test:watch
```

### Manual Testing

1. **Health Check:**
   ```bash
   curl http://localhost:37373/api/health
   ```

2. **List Servers:**
   ```bash
   curl http://localhost:37373/api/servers
   ```

3. **Test Tool Execution:**
   ```bash
   curl -X POST http://localhost:37373/api/servers/filesystem/tools/read_file \
     -H "Content-Type: application/json" \
     -d '{"path": "/tmp/test.txt"}'
   ```

## Development Workflow

### Adding New MCP Servers

1. **Update configuration:**
   Edit `docker/config/mcp-servers.json` to add your server configuration.

2. **Enable file watching (optional):**
   ```json
   {
     "your-server": {
       "command": "node",
       "args": ["your-server.js"],
       "dev": {
         "watch": ["./your-server.js", "./lib/**/*.js"],
         "ignore": ["node_modules", "dist"]
       }
     }
   }
   ```

3. **Test the server:**
   The development server will automatically load the new configuration.

### Debugging

1. **VS Code Debug Configuration:**
   Add to `.vscode/launch.json`:
   ```json
   {
     "name": "Attach to MCP Hub",
     "type": "node",
     "request": "attach",
     "port": 9229,
     "address": "localhost",
     "localRoot": "${workspaceFolder}",
     "remoteRoot": "/app"
   }
   ```

2. **Chrome DevTools:**
   Open `chrome://inspect` and connect to localhost:9229

### Code Changes

The development server automatically restarts when you make changes to:
- Source code in `src/`
- Configuration files
- Package.json

## Troubleshooting

### Common Issues

1. **Port already in use:**
   ```bash
   docker compose -f docker-compose.dev.yml down
   # or kill the process using port 37373
   lsof -ti:37373 | xargs kill -9
   ```

2. **Permission issues:**
   ```bash
   sudo chown -R $USER:$USER docker/data docker/logs
   ```

3. **Node modules issues:**
   ```bash
   docker compose -f docker-compose.dev.yml down -v
   docker compose -f docker-compose.dev.yml build --no-cache
   ```

### Logs

View development logs:
```bash
docker compose -f docker-compose.dev.yml logs -f mcp-hub-dev
```

## File Structure

```
mcp-hub/
├── docker/
│   ├── config/
│   │   ├── mcp-servers.json      # Main server config
│   │   └── dev-mcp-servers.json  # Development-specific config
│   ├── data/                     # Persistent data
│   └── logs/                     # Log files
├── scripts/
│   └── dev.sh                    # Development startup script
├── Dockerfile.dev                # Development Docker image
├── docker-compose.dev.yml        # Development Docker Compose
├── .env.dev                      # Development environment
└── DEVELOPMENT.md               # This file
```

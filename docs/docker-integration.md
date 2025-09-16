# Docker Integration for MCP Hub

The MCP Hub now supports running MCP servers as Docker containers, providing better isolation, scalability, and resource management.

## Features

- **Dynamic Container Management**: Start and stop MCP server containers on-demand
- **Multiple Deployment Strategies**: 
  - `on-demand`: Start containers when needed, stop when idle
  - `pre-warmed`: Keep containers ready for quick startup
  - `always-on`: Keep containers running continuously
  - `scheduled`: Start/stop based on schedules (future)
- **Resource Limits**: Set CPU and memory limits per server
- **Security Isolation**: Run servers in isolated containers with security constraints
- **Network Management**: Automatic Docker network creation and management
- **Image Management**: Pull and update Docker images for MCP servers
- **Health Monitoring**: Track container health and status

## Configuration

Enable Docker integration in your config file:

```json
{
  "docker": {
    "enabled": true,
    "strategy": "on-demand",
    "maxContainers": 20,
    "dockerConfig": {
      "socketPath": "/var/run/docker.sock",
      "imagePrefix": "mcp-servers",
      "networkName": "mcp-hub-network",
      "cleanupOnShutdown": true
    },
    "serverConfigs": {
      "filesystem": {
        "image": "mcp-servers/filesystem",
        "strategy": "on-demand",
        "volumes": {
          "/home/user/workspace": "/data"
        },
        "environment": {
          "MCP_ALLOWED_PATHS": "/data"
        }
      },
      "mcp-memory": {
        "image": "mcp-servers/memory",
        "strategy": "always-on",
        "resourceLimits": {
          "memory": "256m",
          "cpus": "0.25"
        }
      }
    }
  }
}
```

## Deployment Strategies

### On-Demand
Containers are started when a client requests to use the server and stopped after a period of inactivity.

```json
{
  "serverConfigs": {
    "github": {
      "strategy": "on-demand"
    }
  }
}
```

### Pre-Warmed
Containers are started but not connected until needed, reducing startup time.

```json
{
  "serverConfigs": {
    "mcp-time": {
      "strategy": "pre-warmed",
      "lightweight": true
    }
  }
}
```

### Always-On
Containers run continuously and are always available.

```json
{
  "serverConfigs": {
    "mcp-memory": {
      "strategy": "always-on",
      "resourceLimits": {
        "memory": "256m"
      }
    }
  }
}
```

## REST API Endpoints

### Container Management

#### Get Docker Status
```http
GET /api/docker/status
```

#### List All Containers
```http
GET /api/docker/containers
```

#### Get Container Status
```http
GET /api/docker/containers/:serverName
```

#### Start Container
```http
POST /api/docker/containers/:serverName/start
Content-Type: application/json

{
  "connect": true
}
```

#### Stop Container
```http
POST /api/docker/containers/:serverName/stop
Content-Type: application/json

{
  "remove": false
}
```

#### Restart Container
```http
POST /api/docker/containers/:serverName/restart
Content-Type: application/json

{
  "connect": true
}
```

### Image Management

#### Pull Images
```http
POST /api/docker/images/pull
Content-Type: application/json

{
  "servers": ["filesystem", "github"]
}
```

### Cleanup

#### Clean Up Stopped Containers
```http
POST /api/docker/cleanup
```

## Building Docker Images

### Base Image
The base image for MCP servers is provided in `docker/base/Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
RUN npm install -g @modelcontextprotocol/sdk
EXPOSE 3000
```

### Server-Specific Images
Each MCP server should have its own Dockerfile that extends the base:

```dockerfile
FROM mcp-servers/base:latest
RUN npm install @modelcontextprotocol/server-filesystem
COPY config.json .
CMD ["npx", "@modelcontextprotocol/server-filesystem"]
```

### Building Images
```bash
# Build base image
docker build -t mcp-servers/base:latest docker/base/

# Build server image
docker build -t mcp-servers/filesystem:latest docker/filesystem/
```

## Docker Compose

Use Docker Compose to manage the entire MCP Hub system:

```yaml
version: '3.8'

services:
  mcp-hub:
    build: .
    ports:
      - "3456:3456"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./config.docker.json:/app/config.json
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://user:pass@postgres:5432/mcp
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:16
    environment:
      - POSTGRES_DB=mcp
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:

networks:
  default:
    name: mcp-hub-network
```

## Security Considerations

1. **Container Isolation**: Each MCP server runs in its own container with limited capabilities
2. **Resource Limits**: Set CPU and memory limits to prevent resource exhaustion
3. **Network Isolation**: Containers communicate through a dedicated Docker network
4. **Volume Mounts**: Carefully control which host directories are accessible
5. **Environment Variables**: Use Docker secrets for sensitive configuration

## Monitoring

Monitor container health and resource usage:

```bash
# View running containers
docker ps --filter label=mcp-hub

# Check container logs
docker logs mcp-hub-filesystem

# Monitor resource usage
docker stats --filter label=mcp-hub

# Health check
curl http://localhost:3456/api/docker/status
```

## Troubleshooting

### Container Won't Start
- Check Docker daemon is running: `docker version`
- Check image exists: `docker images | grep mcp-servers`
- Check logs: `docker logs mcp-hub-<server-name>`

### Connection Issues
- Verify network exists: `docker network ls | grep mcp-hub`
- Check container is on network: `docker inspect <container> | grep NetworkMode`
- Test connectivity: `docker exec mcp-hub curl http://<container>:3000`

### Resource Issues
- Check container limits: `docker inspect <container> | grep -A5 Resources`
- Monitor usage: `docker stats <container>`
- Increase limits in configuration if needed

## Best Practices

1. **Use Specific Image Tags**: Avoid `:latest` in production
2. **Set Resource Limits**: Prevent runaway containers
3. **Regular Cleanup**: Remove stopped containers periodically
4. **Monitor Logs**: Centralize logging for all containers
5. **Health Checks**: Implement health endpoints in MCP servers
6. **Graceful Shutdown**: Allow containers time to clean up
7. **Version Control**: Track Docker image versions with config

## Migration Guide

### From Standalone to Docker

1. Install Docker on your system
2. Build or pull MCP server images
3. Update configuration to enable Docker integration
4. Set appropriate volume mounts for data access
5. Configure environment variables for authentication
6. Test with one server before migrating all
7. Monitor performance and adjust resource limits

### Rollback Plan

If you need to disable Docker integration:

1. Set `docker.enabled: false` in configuration
2. Update `mcpServers` configuration to use stdio/http transport
3. Restart MCP Hub
4. Containers will continue running but won't be managed
5. Manually stop containers if needed: `docker stop $(docker ps -q --filter label=mcp-hub)`

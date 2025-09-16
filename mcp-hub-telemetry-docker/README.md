# MCP Hub Telemetry - Docker Container

A complete PostgreSQL-backed telemetry and monitoring system for MCP Hub, packaged as a Docker container for easy deployment.

## 🚀 Quick Start

### 1. Clone and Setup

```bash
# Navigate to the project directory
cd mcp-hub-telemetry-docker

# Copy environment template
cp .env.example .env

# Edit .env file with your settings
nano .env
```

### 2. Deploy with Docker Compose

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f mcp-hub-telemetry

# Check health
curl http://localhost:3000/health
```

### 3. Access Services

- **Telemetry API**: http://localhost:3000
- **Dashboard**: http://localhost:3000/api/telemetry/dashboard
- **Admin Interface**: http://localhost:3000/admin/metrics
- **Health Check**: http://localhost:3000/health
- **PostgreSQL**: localhost:5432 (user: mcp_hub_app, password: mcp_hub_secure_password)
- **Grafana** (optional): http://localhost:3001 (admin/admin)

## 📊 API Endpoints

### Telemetry Data
- `GET /api/telemetry/dashboard` - Complete dashboard data
- `GET /api/telemetry/servers` - Server status and health
- `GET /api/telemetry/tools` - Tool performance metrics
- `GET /api/telemetry/executions` - Recent tool executions
- `GET /api/telemetry/errors` - Error statistics
- `GET /api/telemetry/hub` - Hub health metrics

### Data Ingestion
- `POST /api/telemetry/log` - Send log entries
- `POST /api/telemetry/execution` - Log tool executions

### Admin
- `GET /admin/metrics` - System metrics
- `POST /admin/shutdown` - Graceful shutdown

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | postgresql | PostgreSQL host |
| `POSTGRES_PORT` | 5432 | PostgreSQL port |
| `POSTGRES_DB` | mcp_hub | Database name |
| `POSTGRES_USER` | mcp_hub_app | Application user |
| `POSTGRES_PASSWORD` | mcp_hub_secure_password | Application password |
| `TENANT` | daclab-ai | Tenant identifier |
| `HUB_INSTANCE_NAME` | mcp-hub-docker | Hub instance name |
| `PORT` | 3000 | Main API port |
| `ADMIN_PORT` | 3001 | Admin port |
| `MAX_DB_CONNECTIONS` | 20 | Database connection pool size |
| `CORS_ORIGIN` | * | CORS allowed origins |

### Docker Compose Services

1. **mcp-hub-telemetry** - Main telemetry service
2. **postgresql** - PostgreSQL database
3. **redis** - Redis cache (optional)
4. **grafana** - Grafana visualization (optional)

## 📡 Integration with MCP Hub

### Direct Integration

Add to your MCP Hub application:

```javascript
const axios = require('axios');

// Log tool execution
async function logToolExecution(toolName, serverName, args, result, error) {
  try {
    await axios.post('http://localhost:3000/api/telemetry/execution', {
      toolName,
      serverName,
      arguments: args,
      result,
      error: error?.message,
      status: error ? 'failed' : 'completed',
      startedAt: new Date(),
      completedAt: new Date()
    });
  } catch (err) {
    console.warn('Failed to log telemetry:', err.message);
  }
}

// Log application events
async function logEvent(level, message, data) {
  try {
    await axios.post('http://localhost:3000/api/telemetry/log', {
      level,
      message,
      data,
      source: 'mcp-hub'
    });
  } catch (err) {
    console.warn('Failed to log event:', err.message);
  }
}
```

### Using the Telemetry Client

```javascript
const MCPHubTelemetry = require('./src/mcp_hub_telemetry');

const telemetry = new MCPHubTelemetry({
  host: 'localhost',
  port: 5432,
  database: 'mcp_hub',
  user: 'mcp_hub_app',
  password: 'mcp_hub_secure_password',
  tenant: 'daclab-ai'
});

await telemetry.initialize({
  instanceName: 'my-mcp-hub',
  host: 'localhost',
  port: 37373
});

// Log tool execution
await telemetry.logToolExecution({
  toolName: 'filesystem__read_file',
  serverName: 'filesystem',
  arguments: { path: '/tmp/test.txt' },
  result: { content: 'file contents' },
  status: 'completed'
});
```

## 🏗️ Development

### Building the Image

```bash
# Build the telemetry container
docker build -t mcp-hub-telemetry .

# Run standalone
docker run -d \
  --name mcp-hub-telemetry \
  -p 3000:3000 \
  -e POSTGRES_HOST=your-postgres-host \
  -e POSTGRES_PASSWORD=your-password \
  mcp-hub-telemetry
```

### Database Management

```bash
# Access database directly
docker-compose exec postgresql psql -U postgres -d mcp_hub

# Run database setup manually
docker-compose exec mcp-hub-telemetry npm run setup-db

# Force recreate schema
docker-compose exec mcp-hub-telemetry bash -c "FORCE_RECREATE=true npm run setup-db"
```

### Logs and Debugging

```bash
# View application logs
docker-compose logs -f mcp-hub-telemetry

# View database logs
docker-compose logs -f postgresql

# Check container health
docker-compose ps

# Access container shell
docker-compose exec mcp-hub-telemetry sh
```

## 📊 Database Schema

The system creates a comprehensive PostgreSQL schema with:

- **17+ tables** for complete telemetry tracking
- **Multi-tenant architecture** with row-level security
- **Time-series optimized** for performance
- **Comprehensive indexing** for fast queries
- **Automatic cleanup** and retention policies

Key tables:
- `tenants` - Multi-tenant isolation
- `hub_instances` - MCP Hub server tracking
- `mcp_servers` - Connected server monitoring
- `mcp_tools` - Tool registry and performance
- `tool_executions` - Detailed execution logging
- `sse_events` - Real-time event streaming
- `log_entries` - Structured application logs
- `api_requests` - REST API usage tracking
- `oauth_flows` - Authentication flow tracking

## 🔒 Security

- **Non-root user** in container
- **Encrypted passwords** with configurable credentials
- **CORS protection** with configurable origins
- **Input validation** on all API endpoints
- **SQL injection protection** with parameterized queries
- **Rate limiting** ready (can be enabled)

## 📈 Monitoring & Alerting

### Built-in Health Checks
- Database connectivity
- API responsiveness  
- Memory usage
- Connection pool status

### Metrics Available
- Tool execution rates and times
- Server connection stability
- Error rates and patterns
- API request performance
- Database query performance

### Grafana Integration
Pre-configured dashboards for:
- Hub overview and health
- Server status and uptime
- Tool performance metrics
- Error analysis and trends

## 🚧 Troubleshooting

### Common Issues

1. **Database Connection Failed**
   ```bash
   # Check PostgreSQL is running
   docker-compose ps postgresql
   
   # Check logs
   docker-compose logs postgresql
   
   # Verify credentials
   docker-compose exec postgresql psql -U postgres -d mcp_hub
   ```

2. **Schema Creation Failed**
   ```bash
   # Force recreate schema
   docker-compose exec mcp-hub-telemetry bash -c "FORCE_RECREATE=true npm run setup-db"
   ```

3. **Permission Denied**
   ```bash
   # Check file ownership
   ls -la
   
   # Rebuild with correct permissions
   docker-compose build --no-cache
   ```

## 📚 Documentation

- [API Documentation](./docs/API.md)
- [Database Schema](./docs/DATABASE.md)
- [Integration Guide](./docs/INTEGRATION.md)
- [Production Deployment](./docs/PRODUCTION.md)

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

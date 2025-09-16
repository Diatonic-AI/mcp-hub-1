# MCP Hub Telemetry System

A comprehensive PostgreSQL-backed telemetry and monitoring system for MCP Hub, providing real-time insights into server connections, tool executions, performance metrics, and system health.

## Features

- **Multi-tenant architecture** with complete tenant isolation
- **Real-time metrics** using TimescaleDB for time-series data
- **Comprehensive tracking** of MCP servers, tools, executions, and errors
- **Event streaming** support with SSE integration
- **Performance analytics** with continuous aggregates
- **Docker metrics** and system monitoring
- **OAuth flow tracking** and authentication logging
- **REST API** for telemetry dashboard and analytics

## Quick Start

### 1. Prerequisites

- Node.js 16+
- PostgreSQL 12+ (TimescaleDB recommended)
- MCP Hub instance

### 2. Installation

```bash
# Clone or download the telemetry system
# Install dependencies
npm install

# Set up environment variables
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_USER=postgres
export POSTGRES_PASSWORD=your_password
export POSTGRES_DB=mcp_hub
export MCP_HUB_DB_PASSWORD=secure_app_password
```

### 3. Database Setup

```bash
# Run the automated setup
npm run setup-db

# Or manually execute the schema
psql -h localhost -U postgres -d mcp_hub -f schema/mcp_hub_schema.sql
```

### 4. Test Connection

```bash
npm run test-connection
```

### 5. Integration

```javascript
const MCPHubTelemetry = require('./src/mcp_hub_telemetry');

// Initialize telemetry
const telemetry = new MCPHubTelemetry({
  tenant: 'your-tenant',
  host: 'localhost',
  database: 'mcp_hub',
  user: 'mcp_hub_app',
  password: process.env.MCP_HUB_DB_PASSWORD
});

await telemetry.initialize({
  instanceName: 'my-hub',
  host: 'localhost',
  port: 37373
});

// Register servers and tools
await telemetry.registerServer(serverData);
await telemetry.registerTools(serverName, tools);

// Log executions
await telemetry.logToolExecution(executionData);
```

## Database Schema

The schema includes comprehensive tables for:

- **Tenants** - Multi-tenant isolation
- **Hub Instances** - MCP Hub server tracking
- **MCP Servers** - Connected server monitoring
- **Tools & Capabilities** - Tool registry and performance
- **Executions** - Detailed execution logging with TimescaleDB
- **Events & Logs** - Real-time event streaming and structured logging
- **OAuth Flows** - Authentication and authorization tracking
- **API Requests** - REST API usage monitoring
- **Infrastructure** - Docker and system metrics

## API Endpoints

- `GET /api/telemetry/dashboard` - Complete telemetry dashboard
- `GET /api/telemetry/servers` - Server status and health
- `GET /api/telemetry/tools` - Tool performance metrics
- `GET /api/telemetry/executions` - Recent tool executions
- `GET /api/telemetry/errors` - Error statistics and analysis

## Environment Variables

- `POSTGRES_HOST` - PostgreSQL host (default: localhost)
- `POSTGRES_PORT` - PostgreSQL port (default: 5432)
- `POSTGRES_DB` - Database name (default: mcp_hub)
- `POSTGRES_USER` - Database admin user (default: postgres)
- `MCP_HUB_DB_PASSWORD` - Application user password
- `TIMESCALEDB_ENABLED` - Enable TimescaleDB features (default: true)

## Performance Features

- Connection pooling with configurable limits
- Query caching for frequently accessed data
- TimescaleDB continuous aggregates for analytics
- Automatic data retention and cleanup policies
- Real-time metrics with minimal overhead

## Monitoring & Analytics

- Hub health and performance metrics
- Server connection statistics and uptime
- Tool usage patterns and execution times
- Error rates and failure analysis
- Resource utilization tracking
- OAuth flow success rates

## License

MIT License - see LICENSE file for details.

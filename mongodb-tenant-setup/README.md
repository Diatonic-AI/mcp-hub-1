# MCP-Hub MongoDB Tenant Setup

This directory contains scripts and configuration for setting up an isolated MongoDB tenant for the MCP-Hub system.

## Overview

The MCP-Hub system was originally designed to work with PostgreSQL, but this setup creates a MongoDB tenant with equivalent functionality:

- **Tenant Isolation**: Complete database-level isolation for the MCP-Hub tenant
- **Schema Compatibility**: MongoDB collections that mirror the PostgreSQL schema structure
- **Automatic TTL**: Time-to-live indexes for automatic data cleanup
- **Performance Optimization**: Comprehensive indexing for fast queries
- **Authentication**: Built-in user management with admin and service accounts

## Prerequisites

- Node.js 16.0.0 or higher
- MongoDB running on 10.10.10.13:27017 (or configure different host/port)
- Network connectivity to the MongoDB server

## Quick Start

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Run the Setup Script**
   ```bash
   npm run setup
   ```

3. **Test the Connection**
   ```bash
   npm run test-connection
   ```

## Configuration

The setup script uses environment variables for configuration:

- `MONGO_HOST`: MongoDB host (default: 10.10.10.13)
- `MONGO_PORT`: MongoDB port (default: 27017)
- `TENANT_ID`: Tenant identifier (default: mcp_hub)

### Custom Configuration Example
```bash
export MONGO_HOST=10.10.10.13
export MONGO_PORT=27017
export TENANT_ID=production_mcp_hub
npm run setup
```

## Database Structure

The setup creates the following collections:

### Core MCP Collections
- `mcp_servers` - MCP server registry with health tracking
- `mcp_tools` - Individual tools provided by servers
- `tool_executions` - Execution history with performance metrics
- `tool_chain_executions` - Chain execution tracking
- `tool_chain_steps` - Individual steps in tool chains

### API and Monitoring
- `api_requests` - HTTP API request logging
- `server_connections` - Connection event tracking  
- `server_health_checks` - Health monitoring data
- `performance_metrics` - Performance statistics
- `analytics_cache` - Cached analytical data

### Authentication and Security
- `users` - User accounts (admin, service, etc.)
- `jwt_tokens` - JWT token management with blacklisting
- `sessions` - Web session management
- `oauth_connections` - OAuth provider links
- `api_keys` - API key authentication
- `security_audit_log` - Security event auditing

### System Management
- `system_events` - System-wide event logging
- `entity_metadata` - Universal metadata storage
- `tenant_configurations` - Tenant-specific configuration
- `rate_limits` - API rate limiting data

## Features

### Tenant Isolation
- Database-level isolation (`mcp_hub_${TENANT_ID}`)
- All documents include `tenant_id` field
- Unique constraints respect tenant boundaries

### Automatic Data Cleanup
- TTL indexes automatically remove old data
- Tool executions: 90 days retention
- API requests: 30 days retention  
- Audit logs: 365 days retention
- Connection logs: 14 days retention

### Performance Optimization
- Comprehensive indexing on all query patterns
- Compound indexes for complex queries
- Time-series optimized indexes for monitoring data

### Authentication Ready
- Pre-created admin user: `admin@mcphub.local` / `admin123!`
- Service account: `service@mcphub.local`
- JWT token support with automatic expiration
- OAuth provider integration ready

## Integration with MCP-Hub

After setup, update your MCP-Hub configuration to use MongoDB:

### 1. Install MongoDB Driver
```bash
cd /home/daclab-ai/dev/mcp-hub
npm install mongodb
```

### 2. Update Environment Variables
Add to your `.env` file:
```bash
# MongoDB Configuration
MONGODB_URI=mongodb://10.10.10.13:27017/mcp_hub_mcp_hub
MONGODB_HOST=10.10.10.13
MONGODB_PORT=27017
MONGODB_DATABASE=mcp_hub_mcp_hub
TENANT_ID=mcp_hub

# Authentication
MONGODB_AUTH_ENABLED=true
MONGODB_ADMIN_USER=admin@mcphub.local
MONGODB_SERVICE_USER=service@mcphub.local
```

### 3. Connection Configuration
The setup script generates `connection-config-${TENANT_ID}.json` with complete connection details.

## Monitoring and Maintenance

### Health Checks
```bash
# Test basic connectivity
npm run test-connection

# Check collections and indexes
mongo mongodb://10.10.10.13:27017/mcp_hub_mcp_hub --eval "db.stats()"
```

### Data Management
- TTL indexes handle automatic cleanup
- Monitor collection sizes with `db.collection.stats()`
- Backup using `mongodump` with database-specific options

### Performance Monitoring
- Use MongoDB's built-in profiler for slow queries
- Monitor index usage with `db.collection.getIndexes()`
- Track performance metrics in the `performance_metrics` collection

## Migration from PostgreSQL

If you're migrating from an existing PostgreSQL MCP-Hub installation:

1. Export data from PostgreSQL using the provided schema
2. Transform relational data to document format
3. Import using MongoDB bulk operations
4. Verify data integrity and relationships
5. Update application configuration

## Security Considerations

- Change default passwords in production
- Enable MongoDB authentication if not already done
- Consider TLS/SSL for production deployments
- Regularly rotate JWT secrets and API keys
- Monitor the security audit log for suspicious activity

## Troubleshooting

### Common Issues

**Connection Refused**
- Verify MongoDB is running on 10.10.10.13:27017
- Check network connectivity and firewall settings

**Permission Denied**
- Ensure MongoDB allows connections from your host
- Check MongoDB authentication configuration

**Slow Performance**
- Verify indexes are created properly
- Monitor query patterns and add indexes as needed
- Check TTL index effectiveness

### Getting Help

Check the system events collection for detailed error information:
```javascript
db.system_events.find({severity: "error"}).sort({event_time: -1}).limit(10)
```

## Files

- `setup-mongodb-tenant.js` - Main setup script
- `test-connection.js` - Connection verification
- `package.json` - Node.js dependencies
- `README.md` - This documentation
- `connection-config-*.json` - Generated connection configuration

## License

MIT License - See parent project for details.

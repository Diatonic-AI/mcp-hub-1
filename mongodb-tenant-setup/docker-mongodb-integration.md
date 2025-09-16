# MongoDB Container Integration Guide

## ✅ Container Network Connectivity

The MongoDB at **10.10.10.13:27017** will be accessible from the containerized MCP-Hub because:

1. **External Network Access**: Docker containers can access external IPs by default
2. **Bridge Network**: The mcp-network uses bridge driver which allows external connectivity  
3. **IP Routing**: 10.10.10.13 is accessible from the host, so containers can reach it
4. **Existing Pattern**: Current setup already connects to 10.10.10.11 (PostgreSQL)

## 🔧 Updated Docker Configuration

Here's how to integrate MongoDB with the containerized MCP-Hub:

### 1. Update docker-compose.yml Environment Variables

Add MongoDB configuration to the environment section:

```yaml
environment:
  # ... existing environment variables ...
  
  # MongoDB Configuration (replacing PostgreSQL)
  - MONGODB_URI=mongodb://10.10.10.13:27017/mcp_hub_mcp_hub
  - MONGODB_HOST=10.10.10.13
  - MONGODB_PORT=27017
  - MONGODB_DATABASE=mcp_hub_mcp_hub
  - TENANT_ID=mcp_hub
  
  # MongoDB Authentication
  - MONGODB_ADMIN_USER=admin@mcphub.local
  - MONGODB_SERVICE_USER=service@mcphub.local
  
  # Optional: Keep PostgreSQL for migration period
  # - POSTGRES_CONNECTION_STRING=postgresql://postgres:mcphub2024@10.10.10.11:5432/mcp_hub
```

### 2. Update .env File

Create/update the .env file with MongoDB credentials:

```bash
# MongoDB Configuration
MONGODB_URI=mongodb://10.10.10.13:27017/mcp_hub_mcp_hub
MONGODB_HOST=10.10.10.13
MONGODB_PORT=27017
MONGODB_DATABASE=mcp_hub_mcp_hub
TENANT_ID=mcp_hub

# MongoDB Authentication (if needed)
MONGODB_ADMIN_USER=admin@mcphub.local
MONGODB_SERVICE_USER=service@mcphub.local

# Connection Pool Settings
MONGODB_MAX_POOL_SIZE=10
MONGODB_MIN_POOL_SIZE=2
MONGODB_CONNECT_TIMEOUT_MS=10000
MONGODB_SERVER_SELECTION_TIMEOUT_MS=5000
```

### 3. Install MongoDB Driver in Container

Update the package.json or Dockerfile to include the MongoDB driver:

```dockerfile
# In Dockerfile, add:
RUN npm install mongodb
```

Or update package.json dependencies:

```json
{
  "dependencies": {
    "mongodb": "^6.0.0"
  }
}
```

## 🧪 Testing Container Connectivity

### Method 1: Test from Running Container

```bash
# Start the container
docker-compose up -d mcp-hub

# Test MongoDB connectivity from within container
docker exec -it mcp-hub node -e "
const { MongoClient } = require('mongodb');
const client = new MongoClient('mongodb://10.10.10.13:27017');
client.connect()
  .then(() => {
    console.log('✅ MongoDB connection successful from container');
    return client.db('mcp_hub_mcp_hub').listCollections().toArray();
  })
  .then(collections => {
    console.log(\`📚 Found \${collections.length} collections\`);
    client.close();
  })
  .catch(err => {
    console.error('❌ Connection failed:', err.message);
    process.exit(1);
  });
"
```

### Method 2: Create Container Test Script

Create a test script specifically for container testing:

```javascript
// container-mongodb-test.js
const { MongoClient } = require('mongodb');

async function testMongoDBFromContainer() {
  const uri = process.env.MONGODB_URI || 'mongodb://10.10.10.13:27017/mcp_hub_mcp_hub';
  
  console.log('🔍 Testing MongoDB from container...');
  console.log(`📍 URI: ${uri}`);
  console.log(`🏠 Container hostname: ${require('os').hostname()}`);
  
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('✅ Connected successfully from container!');
    
    const db = client.db();
    const collections = await db.listCollections().toArray();
    console.log(`📚 Collections found: ${collections.length}`);
    
    // Test basic operation
    const result = await db.collection('system_events').findOne();
    console.log('📋 Sample document found:', !!result);
    
    console.log('🎉 Container MongoDB integration working!');
    
  } catch (error) {
    console.error('❌ Connection failed from container:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

testMongoDBFromContainer();
```

## 🌐 Network Troubleshooting

If connectivity issues arise, here are troubleshooting steps:

### Check Container Network Access

```bash
# Test network connectivity from container
docker exec -it mcp-hub ping 10.10.10.13

# Test MongoDB port specifically
docker exec -it mcp-hub nc -zv 10.10.10.13 27017

# Check container's network configuration
docker exec -it mcp-hub ip route show
```

### Check Docker Network Settings

```bash
# Inspect the network
docker network inspect mcp-hub_mcp-network

# Check if external connectivity is blocked
docker exec -it mcp-hub curl -I http://10.10.10.13:27017
```

### Alternative Network Configurations

If the bridge network doesn't work, try these alternatives:

#### Option 1: Use Host Network (Less Secure)
```yaml
# In docker-compose.yml
services:
  mcp-hub:
    network_mode: "host"  # Uses host networking directly
```

#### Option 2: Add External Network
```yaml
networks:
  external-network:
    driver: bridge
    ipam:
      config:
        - subnet: 10.10.10.0/24
          gateway: 10.10.10.1
```

## 🔒 Security Considerations

### Container to MongoDB Security

1. **Firewall Rules**: Ensure 10.10.10.13:27017 allows connections from container network
2. **MongoDB Authentication**: Enable authentication on MongoDB if not already done
3. **Network Isolation**: Consider VPN or private networks for production
4. **Connection Encryption**: Use TLS for production deployments

### Environment Variables Security

```yaml
# Use Docker secrets for sensitive data
secrets:
  mongodb_password:
    file: ./secrets/mongodb_password.txt

services:
  mcp-hub:
    secrets:
      - mongodb_password
    environment:
      - MONGODB_PASSWORD_FILE=/run/secrets/mongodb_password
```

## 📊 Production Recommendations

### Connection Pooling in Container

```javascript
// Optimized MongoDB connection for containers
const mongoOptions = {
  maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE) || 10,
  minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE) || 2,
  maxIdleTimeMS: 30000,
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 10000,
  heartbeatFrequencyMS: 10000,
  retryWrites: true,
  retryReads: true
};
```

### Health Check Integration

```yaml
# Updated health check to include MongoDB
healthcheck:
  test: |
    node -e "
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI);
    client.connect()
      .then(() => client.db().admin().ping())
      .then(() => { client.close(); process.exit(0); })
      .catch(() => process.exit(1));
    " && 
    node -e "
    const http = require('http');
    const options = { host: 'localhost', port: process.env.PORT || 37373, path: '/api/health' };
    const req = http.get(options, (res) => process.exit(res.statusCode === 200 ? 0 : 1));
    req.on('error', () => process.exit(1));
    "
  interval: 30s
  timeout: 15s
  start_period: 45s
  retries: 3
```

## ✅ Summary

**Yes, the MongoDB will be accessible from the container because:**

1. ✅ **External IP Access**: Containers can reach external IPs by default
2. ✅ **Bridge Network**: Current setup allows external connectivity
3. ✅ **Proven Pattern**: Already connecting to 10.10.10.11 (PostgreSQL)
4. ✅ **Network Route**: Host can reach 10.10.10.13, so container can too

**Key Integration Steps:**
1. Add MongoDB environment variables to docker-compose.yml
2. Install mongodb npm package in container
3. Update application code to use MongoDB instead of PostgreSQL
4. Test connectivity with the provided scripts
5. Implement proper error handling and connection pooling

The MongoDB tenant we created will work seamlessly with the containerized MCP-Hub! 🎉

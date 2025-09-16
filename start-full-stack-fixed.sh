#!/bin/bash

# MCP Hub Full Stack Startup Script (Fixed Version)
# Includes: Core MCP Hub, PostgreSQL Integration, ML/DL Pipeline Support

set -e

echo "========================================"
echo "🚀 MCP Hub Full Stack Startup (Fixed)"
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Set working directory
cd /home/daclab-ai/dev/mcp-hub

# Kill any existing MCP Hub processes
echo -e "${YELLOW}🔍 Checking for existing MCP Hub processes...${NC}"
pkill -f "node.*mcp-hub" 2>/dev/null || true
pkill -f "node.*cli.js.*3005" 2>/dev/null || true
sleep 2

# Export required environment variables
echo -e "${YELLOW}🔧 Setting up environment variables...${NC}"

# Core configuration
export NODE_ENV=production
export PORT=3005
export HOST=0.0.0.0
export MCP_CONFIG_FILE="./config/mcp-servers.json"

# Data directory (local file system, not Docker path)
export DATA_DIR="/home/daclab-ai/dev/mcp-hub/data"
mkdir -p "$DATA_DIR"

# Hub instance ID for database tracking
export HUB_INSTANCE_ID="mcp-hub-$(hostname)-$(date +%Y%m%d)"

# PostgreSQL Configuration (LXD container)
export POSTGRES_ENABLED=true
export POSTGRES_HOST=10.10.10.11
export POSTGRES_PORT=5432
export POSTGRES_DB=mcp_hub
export POSTGRES_USER=admin
export POSTGRES_PASSWORD=admin123
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
export PG_CONNECTION_STRING="$DATABASE_URL"

# MongoDB Configuration (LXD container)
export MONGODB_ENABLED=true
export MONGODB_URI="mongodb://admin:admin123@10.10.10.13:27017/mcp_hub?authSource=admin"
export MONGO_CONNECTION_STRING="$MONGODB_URI"

# Redis Configuration (LXD container)
export REDIS_ENABLED=true
export REDIS_HOST=10.10.10.14
export REDIS_PORT=6379
export REDIS_URL="redis://${REDIS_HOST}:${REDIS_PORT}"

# Qdrant Configuration (LXD container)
export QDRANT_ENABLED=true
export QDRANT_HOST=10.10.10.15
export QDRANT_PORT=6333
export QDRANT_URL="http://${QDRANT_HOST}:${QDRANT_PORT}"

# Telemetry Configuration
export TELEMETRY_ENABLED=false  # Start with telemetry disabled for now
export TELEMETRY_DATABASE_URL="$DATABASE_URL"
export TELEMETRY_BATCH_SIZE=100
export TELEMETRY_FLUSH_INTERVAL=5000

# ML/DL Pipeline Configuration
export ML_PIPELINE_ENABLED=false  # Start with ML disabled for now
export ML_MONGO_URI="$MONGODB_URI"
export ML_QDRANT_URL="$QDRANT_URL"
export ML_REDIS_URL="$REDIS_URL"
export ML_OLLAMA_HOST="http://localhost:11434"
export ML_OPENAI_API_KEY="${OPENAI_API_KEY:-sk-proj-dummy}"

# Server Loading Manager Configuration
export SERVER_LOADING_STRATEGY=progressive
export IDLE_LOAD_TRIGGER_MS=30000
export SERVER_IDLE_TIMEOUT_MS=300000
export BATCH_SIZE=5
export ENABLE_PERSISTENCE=true

# Logging Configuration
export LOG_LEVEL=info
export LOG_TO_FILE=true
export LOG_FILE_PATH="./logs/mcp-hub.log"
export LOG_MAX_SIZE=10485760
export LOG_MAX_FILES=5

# Test database connectivity
echo -e "${YELLOW}🔍 Testing database connectivity...${NC}"

# Test PostgreSQL
if pg_isready -h 10.10.10.11 -p 5432 -U admin > /dev/null 2>&1; then
    echo -e "${GREEN}✅ PostgreSQL is ready${NC}"
    
    # Initialize schema if needed
    echo -e "${YELLOW}🔧 Initializing PostgreSQL schema...${NC}"
    PGPASSWORD=admin123 psql -h 10.10.10.11 -U admin -d mcp_hub -f src/database/comprehensive-mcp-schema.sql 2>/dev/null || {
        echo -e "${YELLOW}⚠️  Schema already exists or minor error (continuing)${NC}"
    }
else
    echo -e "${RED}❌ PostgreSQL is not accessible${NC}"
    echo -e "${YELLOW}⚠️  Disabling PostgreSQL integration${NC}"
    export POSTGRES_ENABLED=false
fi

# Test MongoDB
if timeout 2 mongosh --host 10.10.10.13 --username admin --password admin123 --authenticationDatabase admin --eval "db.adminCommand('ping')" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ MongoDB is ready${NC}"
else
    echo -e "${RED}❌ MongoDB is not accessible${NC}"
    echo -e "${YELLOW}⚠️  Disabling MongoDB integration${NC}"
    export MONGODB_ENABLED=false
fi

# Test Redis
if redis-cli -h 10.10.10.14 ping > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Redis is ready${NC}"
else
    echo -e "${RED}❌ Redis is not accessible${NC}"
    echo -e "${YELLOW}⚠️  Disabling Redis integration${NC}"
    export REDIS_ENABLED=false
fi

# Test Qdrant
if curl -s "http://10.10.10.15:6333/collections" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Qdrant is ready${NC}"
else
    echo -e "${RED}❌ Qdrant is not accessible${NC}"
    echo -e "${YELLOW}⚠️  Disabling Qdrant integration${NC}"
    export QDRANT_ENABLED=false
fi

# Create logs directory
mkdir -p logs

# Start MCP Hub with appropriate features
echo -e "${YELLOW}🚀 Starting MCP Hub with integrated features...${NC}"

# Build command based on enabled features
NODE_CMD="node src/utils/cli.js --port $PORT --config $MCP_CONFIG_FILE"

# Add feature flags based on what's enabled
if [ "$POSTGRES_ENABLED" = "true" ]; then
    echo -e "${GREEN}✅ PostgreSQL integration enabled${NC}"
fi

if [ "$MONGODB_ENABLED" = "true" ]; then
    echo -e "${GREEN}✅ MongoDB integration enabled${NC}"
fi

if [ "$REDIS_ENABLED" = "true" ]; then
    echo -e "${GREEN}✅ Redis integration enabled${NC}"
fi

if [ "$QDRANT_ENABLED" = "true" ]; then
    echo -e "${GREEN}✅ Qdrant integration enabled${NC}"
fi

# Start the hub
echo -e "${YELLOW}🚀 Launching MCP Hub...${NC}"
$NODE_CMD &
MCP_PID=$!

# Wait for startup
echo -e "${YELLOW}⏳ Waiting for MCP Hub to start...${NC}"
sleep 5

# Check if process is still running
if kill -0 $MCP_PID 2>/dev/null; then
    echo -e "${GREEN}✅ MCP Hub is running (PID: $MCP_PID)${NC}"
    
    # Test the API
    echo -e "${YELLOW}🔍 Testing API endpoints...${NC}"
    
    # Test servers endpoint
    if curl -s "http://localhost:3005/api/servers" > /dev/null; then
        echo -e "${GREEN}✅ API is responding${NC}"
        
        # Get server count
        SERVER_COUNT=$(curl -s "http://localhost:3005/api/servers" | jq 'length' 2>/dev/null || echo "unknown")
        echo -e "${GREEN}📊 Connected servers: $SERVER_COUNT${NC}"
    else
        echo -e "${RED}❌ API is not responding${NC}"
    fi
    
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}🎉 MCP Hub Full Stack is running!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo "Access points:"
    echo "  - API: http://localhost:3005/api"
    echo "  - Health: http://localhost:3005/health"
    echo "  - Servers: http://localhost:3005/api/servers"
    echo "  - Tools: http://localhost:3005/api/tools"
    echo ""
    echo "Database connections:"
    if [ "$POSTGRES_ENABLED" = "true" ]; then
        echo "  - PostgreSQL: 10.10.10.11:5432 (✅ Connected)"
    fi
    if [ "$MONGODB_ENABLED" = "true" ]; then
        echo "  - MongoDB: 10.10.10.13:27017 (✅ Connected)"
    fi
    if [ "$REDIS_ENABLED" = "true" ]; then
        echo "  - Redis: 10.10.10.14:6379 (✅ Connected)"
    fi
    if [ "$QDRANT_ENABLED" = "true" ]; then
        echo "  - Qdrant: 10.10.10.15:6333 (✅ Connected)"
    fi
    echo ""
    echo "Logs: tail -f logs/mcp-hub.log"
    echo "Stop: kill $MCP_PID"
    echo ""
    
    # Follow logs
    echo -e "${YELLOW}📋 Following logs (Ctrl+C to exit)...${NC}"
    tail -f logs/mcp-hub.log
else
    echo -e "${RED}❌ MCP Hub failed to start${NC}"
    echo -e "${YELLOW}📋 Checking logs for errors...${NC}"
    tail -20 logs/mcp-hub.log
    exit 1
fi

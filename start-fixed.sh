#!/bin/bash

# MCP Hub Production Server with Fixes
# Version 4.2.1 with ML/DL Pipeline

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║           🚀 MCP Hub Production Server v4.2.1 🚀            ║"
echo "║                                                              ║"
echo "║     ML/DL Pipeline | Telemetry | Fixed | Production         ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Environment
export NODE_ENV=production
export PORT=${PORT:-3456}
export HOST=${HOST:-0.0.0.0}

# PostgreSQL fix - reset shutdown state
export POSTGRES_NO_SHUTDOWN=true

# MongoDB
export MONGODB_URI=mongodb://10.10.10.13:27017/mcp_hub
export MONGODB_DATABASE=mcp_hub

# Redis
export REDIS_HOST=10.10.10.14
export REDIS_PORT=6379

# PostgreSQL
export POSTGRES_HOST=10.10.10.11
export POSTGRES_PORT=5432
export POSTGRES_DB=mcp_hub
export POSTGRES_USER=mcp_hub_app
export POSTGRES_PASSWORD=mcp_hub_secure_password
export ENABLE_POSTGRESQL_INTEGRATION=true

# ML/DL Features
export ENABLE_ML_TELEMETRY=true
export ENABLE_ML_FEATURE_STORE=true

# Disable problematic features
export DISABLE_QDRANT=true

echo -e "${BLUE}═══ System Information ═══${NC}"
echo "• Host: $(hostname)"
echo "• OS: $(uname -s) $(uname -r)"
echo "• Node: $(node -v)"
echo "• NPM: v$(npm -v)"
echo "• CPU: $(nproc) cores"
echo "• Memory: $(free -h | awk '/^Mem:/ {print $2}')"
echo "• Time: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo ""

echo -e "${BLUE}═══ Configuration ═══${NC}"
echo "• Environment: $NODE_ENV"
echo "• Config File: config/mcp-servers.json"
echo "• Server: http://$HOST:$PORT"
echo "• Log File: ./server.log"
echo ""

# Check services
echo -e "${BLUE}═══ Service Status ═══${NC}"

# PostgreSQL
if pg_isready -h $POSTGRES_HOST -p $POSTGRES_PORT -q 2>/dev/null; then
    echo -e "${GREEN}✅ PostgreSQL: Available${NC}"
else
    echo -e "${YELLOW}⚠️  PostgreSQL: Not available${NC}"
fi

# MongoDB
if node -e "
const { MongoClient } = require('mongodb');
const client = new MongoClient('$MONGODB_URI');
client.connect().then(() => {
  console.log('connected');
  client.close();
  process.exit(0);
}).catch(() => {
  process.exit(1);
});
" 2>/dev/null | grep -q "connected"; then
    echo -e "${GREEN}✅ MongoDB: Available${NC}"
else
    echo -e "${YELLOW}⚠️  MongoDB: Not available${NC}"
fi

# Redis
if redis-cli -h $REDIS_HOST -p $REDIS_PORT ping 2>/dev/null | grep -q PONG; then
    echo -e "${GREEN}✅ Redis: Available${NC}"
else
    echo -e "${YELLOW}⚠️  Redis: Not available${NC}"
fi

# Docker
if docker info >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Docker: Available${NC}"
else
    echo -e "${YELLOW}⚠️  Docker: Not available${NC}"
fi

echo ""

# Kill any existing instances
echo -e "${BLUE}═══ Cleaning up old instances ═══${NC}"
pkill -f "node src/utils/cli.js" 2>/dev/null || true
pkill -f "node src/server.js" 2>/dev/null || true
sleep 2
echo "• Old instances cleaned up"
echo ""

# Start server
echo -e "${BLUE}═══ Starting Production Server ═══${NC}"
echo "• Starting MCP Hub..."
echo "• Server URL: http://$HOST:$PORT"
echo "• Press Ctrl+C to stop"
echo ""

# Start server
if [ "$1" = "--background" ]; then
    echo "• Starting in background mode..."
    nohup node src/utils/cli.js \
        --port $PORT \
        --config config/mcp-servers.json \
        --host $HOST \
        > server.log 2>&1 &
    
    SERVER_PID=$!
    echo "• Server started with PID: $SERVER_PID"
    echo "• Logs: tail -f server.log"
    
    # Wait and check if server started successfully
    sleep 5
    if ps -p $SERVER_PID > /dev/null; then
        echo -e "${GREEN}✅ Server is running${NC}"
        echo ""
        echo -e "${BLUE}═══ Quick Commands ═══${NC}"
        echo "• Check status: curl http://localhost:$PORT/api/health"
        echo "• View logs: tail -f server.log"
        echo "• Stop server: kill $SERVER_PID"
    else
        echo -e "${RED}❌ Server failed to start${NC}"
        echo "• Check logs: tail -100 server.log"
        exit 1
    fi
else
    echo "• Starting in foreground mode..."
    echo ""
    echo -e "${BLUE}═══ Server Output ═══${NC}"
    exec node src/utils/cli.js \
        --port $PORT \
        --config config/mcp-servers.json \
        --host $HOST
fi

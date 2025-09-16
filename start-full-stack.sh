#!/bin/bash

# MCP Hub Full Stack Startup Script
# This script starts the complete MCP Hub with all components:
# - Core MCP Hub server
# - Telemetry subsystem
# - ML/DL pipelines
# - All database connections (PostgreSQL, MongoDB, Redis, Qdrant)

echo "🚀 Starting MCP Hub Full Stack"
echo "================================"
echo ""

# Set working directory
cd /home/daclab-ai/dev/mcp-hub

# Clean any stale lock files
rm -f /tmp/warp-backups/*.lock 2>/dev/null
rm -f /run/lock/warp-backups/*.lock 2>/dev/null

echo "📋 Component Configuration:"
echo "=========================="

# PostgreSQL Configuration (LXD Container)
export ENABLE_POSTGRESQL_INTEGRATION=true
export POSTGRES_HOST=10.10.10.11
export POSTGRES_PORT=5432
export POSTGRES_DB=mcp_hub
export POSTGRES_USER=mcp_hub_app
export POSTGRES_PASSWORD=mcp_hub_secure_password
echo "✅ PostgreSQL: $POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB"

# MongoDB Configuration (LXD Container)
export MONGODB_URL=mongodb://10.10.10.13:27017
export MONGODB_DB=mcp_telemetry
echo "✅ MongoDB: $MONGODB_URL/$MONGODB_DB"

# Redis Configuration (LXD Container)
export REDIS_HOST=10.10.10.14
export REDIS_PORT=6379
echo "✅ Redis: $REDIS_HOST:$REDIS_PORT"

# Qdrant Configuration (LXD Container)
export QDRANT_HOST=10.10.10.15
export QDRANT_PORT=6333
echo "✅ Qdrant: $QDRANT_HOST:$QDRANT_PORT"

echo ""
echo "🔧 Telemetry & ML/DL Pipeline Settings:"
echo "========================================"

# Enable telemetry subsystem
export TELEMETRY_ENABLED=true
export TELEMETRY_AUTO_START=true
export TELEMETRY_PIPELINE_ENABLED=true
echo "✅ Telemetry: ENABLED"

# Enable ML/DL features
export FEATURE_EXTRACTION_ENABLED=true
export EMBEDDING_ENABLED=true
export ANOMALY_DETECTION_ENABLED=true
echo "✅ Feature Extraction: ENABLED"
echo "✅ Embeddings: ENABLED"
echo "✅ Anomaly Detection: ENABLED"

# ML/DL Pipeline Configuration
export TELEMETRY_BATCH_SIZE=100
export TELEMETRY_PROCESS_INTERVAL=1000
export EMBEDDING_BATCH_SIZE=10
export ANOMALY_THRESHOLD=0.85
echo "✅ Batch Size: $TELEMETRY_BATCH_SIZE"
echo "✅ Process Interval: ${TELEMETRY_PROCESS_INTERVAL}ms"
echo "✅ Anomaly Threshold: $ANOMALY_THRESHOLD"

# LM Studio Configuration (for embeddings if available)
export LM_STUDIO_HOST=localhost
export LM_STUDIO_PORT=1234
export EMBEDDING_MODEL=nomic-embed-text

# Set log level
export LOG_LEVEL=info
export NODE_ENV=development

# Hub Instance ID for database tracking
export HUB_INSTANCE_ID=$(uuidgen)
echo ""
echo "🔑 Hub Instance ID: $HUB_INSTANCE_ID"

# Set data directory for tool registry (not /app which is Docker path)
export DATA_DIR="$HOME/.local/share/mcp-hub/data"
mkdir -p "$DATA_DIR"
echo "📁 Data Directory: $DATA_DIR"

echo ""
echo "🔍 Pre-flight Checks:"
echo "===================="

# Check Node.js
if command -v node > /dev/null; then
    echo "✅ Node.js: $(node -v)"
else
    echo "❌ Node.js not found!"
    exit 1
fi

# Check npm
if command -v npm > /dev/null; then
    echo "✅ npm: $(npm -v)"
else
    echo "❌ npm not found!"
    exit 1
fi

# Check if package.json exists
if [ -f "package.json" ]; then
    echo "✅ package.json found"
else
    echo "❌ package.json not found!"
    exit 1
fi

# Check if node_modules exists
if [ -d "node_modules" ]; then
    echo "✅ Dependencies installed"
else
    echo "⚠️  Dependencies not installed. Running npm install..."
    npm install
fi

echo ""
echo "🎯 Starting MCP Hub Server..."
echo "============================"
echo "Port: 3005"
echo "Mode: Development with auto-reload"
echo ""

# Start the server
echo "📡 Server starting..."
echo "Access URLs:"
echo "  - Health: http://localhost:3005/health"
echo "  - API: http://localhost:3005/api"
echo "  - MCP Endpoint: http://localhost:3005/mcp"
echo "  - SSE Events: http://localhost:3005/sse"
echo ""
echo "Press Ctrl+C to stop the server"
echo "================================"
echo ""

# Start with nodemon for auto-reload on file changes
exec npm run dev

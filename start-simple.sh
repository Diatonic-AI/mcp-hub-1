#!/bin/bash

# Simple MCP Hub Startup Script (without telemetry/ML)
# This starts just the core MCP Hub for testing

echo "🚀 Starting MCP Hub (Simple Mode)"
echo "================================="
echo ""

cd /home/daclab-ai/dev/mcp-hub

# Basic configuration
export PORT=3005
export NODE_ENV=development
export LOG_LEVEL=info

# Disable telemetry and ML features for now
export TELEMETRY_ENABLED=false
export TELEMETRY_AUTO_START=false
export FEATURE_EXTRACTION_ENABLED=false
export EMBEDDING_ENABLED=false
export ANOMALY_DETECTION_ENABLED=false

# Disable PostgreSQL integration temporarily to avoid the error
export ENABLE_POSTGRESQL_INTEGRATION=false

echo "📋 Configuration:"
echo "  - Port: $PORT"
echo "  - Mode: Development"
echo "  - Telemetry: DISABLED"
echo "  - PostgreSQL: DISABLED"
echo ""

echo "🎯 Starting server..."
echo "Access URLs:"
echo "  - Health: http://localhost:3005/health"
echo "  - API: http://localhost:3005/api"
echo "  - MCP Endpoint: http://localhost:3005/mcp"
echo ""

# Start the server directly without nodemon
exec node src/utils/cli.js --port 3005 --config ./config/mcp-servers.json

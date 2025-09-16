#!/bin/bash

# MCP Hub Startup Script with ML/DL Pipeline
# This script starts the MCP Hub with all telemetry and ML features enabled

echo "🚀 Starting MCP Hub with ML/DL Pipeline..."
echo "================================================"

# Set environment variables for PostgreSQL
export ENABLE_POSTGRESQL_INTEGRATION=true
export POSTGRES_HOST=10.10.10.11
export POSTGRES_PORT=5432
export POSTGRES_DB=mcp_hub
export POSTGRES_USER=mcp_hub_app
export POSTGRES_PASSWORD=mcp_hub_secure_password

# Enable telemetry subsystem
export TELEMETRY_ENABLED=true
export TELEMETRY_AUTO_START=true
export TELEMETRY_PIPELINE_ENABLED=true

# Enable ML/DL features
export FEATURE_EXTRACTION_ENABLED=true
export EMBEDDING_ENABLED=true
export ANOMALY_DETECTION_ENABLED=true

# Set batch sizes and intervals for processing
export TELEMETRY_BATCH_SIZE=100
export TELEMETRY_PROCESS_INTERVAL=1000
export EMBEDDING_BATCH_SIZE=10
export ANOMALY_THRESHOLD=0.85

# MongoDB configuration for telemetry storage (LXD container)
export MONGODB_URL=mongodb://10.10.10.13:27017
export MONGODB_DB=mcp_telemetry

# Redis configuration (LXD container)
export REDIS_HOST=10.10.10.14
export REDIS_PORT=6379

# Qdrant configuration for vector storage (LXD container)
export QDRANT_HOST=10.10.10.15
export QDRANT_PORT=6333

# LM Studio configuration for embeddings (if available)
export LM_STUDIO_HOST=localhost
export LM_STUDIO_PORT=1234
export EMBEDDING_MODEL=nomic-embed-text

# Set log level for debugging
export LOG_LEVEL=debug

echo "📋 Configuration (Using LXD Containers):"
echo "  - PostgreSQL: $POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB (LXD: postgresql)"
echo "  - MongoDB: 10.10.10.13:27017/$MONGODB_DB (LXD: mongodb)"
echo "  - Redis: $REDIS_HOST:$REDIS_PORT (LXD: redis)"
echo "  - Qdrant: $QDRANT_HOST:$QDRANT_PORT (LXD: qdrant)"
echo "  - Telemetry: ENABLED"
echo "  - ML Pipeline: ENABLED"
echo "  - Feature Extraction: ENABLED"
echo "  - Embeddings: ENABLED"
echo "  - Anomaly Detection: ENABLED"
echo ""

# Change to MCP Hub directory
cd /home/daclab-ai/dev/mcp-hub

# Start the development server with nodemon for auto-reload
echo "🔧 Starting development server with nodemon..."
npm run dev

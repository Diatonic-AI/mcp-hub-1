#!/bin/bash
set -euo pipefail

echo "🚀 Starting MCP Hub Telemetry Container"
echo "======================================"

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL to be ready..."
while ! pg_isready -h ${POSTGRES_HOST} -p ${POSTGRES_PORT} -U ${POSTGRES_ADMIN_USER:-postgres}; do
    echo "PostgreSQL is unavailable - sleeping"
    sleep 2
done
echo "✅ PostgreSQL is ready"

# Check if schema needs to be created
echo "🔍 Checking database schema..."
SCHEMA_EXISTS=$(PGPASSWORD=${POSTGRES_ADMIN_PASSWORD} psql -h ${POSTGRES_HOST} -p ${POSTGRES_PORT} -U ${POSTGRES_ADMIN_USER:-postgres} -d ${POSTGRES_DB} -tAc "SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name='mcp_hub')" 2>/dev/null || echo "false")

if [ "$SCHEMA_EXISTS" != "t" ]; then
    echo "📋 Schema not found, running database setup..."
    node scripts/setup-database.js
else
    echo "✅ Database schema already exists"
fi

# Start the application
echo "🎯 Starting MCP Hub Telemetry Server..."
exec "$@"

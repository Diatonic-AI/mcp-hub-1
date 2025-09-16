#!/bin/bash

# MCP Hub Telemetry Docker - Quick Start Script

set -euo pipefail

echo "🚀 MCP Hub Telemetry Docker - Quick Start"
echo "========================================="

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is available (either as plugin or standalone)
COMPOSE_CMD=""
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
    echo "✅ Using Docker Compose plugin"
elif command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
    echo "✅ Using Docker Compose standalone"
else
    echo "❌ Docker Compose is not available. Please install Docker Compose."
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    
    # Generate secure passwords
    POSTGRES_PASS=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
    GRAFANA_PASS=$(openssl rand -base64 16 | tr -d "=+/" | cut -c1-12)
    
    # Update .env with generated passwords
    sed -i "s/secure_postgres_password_change_me/$POSTGRES_PASS/g" .env
    sed -i "s/secure_grafana_password_change_me/$GRAFANA_PASS/g" .env
    
    echo "✅ Created .env file with secure generated passwords"
    echo "📝 PostgreSQL password: $POSTGRES_PASS"
    echo "📝 Grafana password: $GRAFANA_PASS"
    echo ""
fi

# Check if we should build or pull
if [ "${1:-}" = "--build" ]; then
    echo "🔨 Building Docker images..."
    $COMPOSE_CMD build
else
    echo "📦 Starting services..."
fi

# Start services
echo "🚀 Starting MCP Hub Telemetry services..."
$COMPOSE_CMD up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check service health
echo "🔍 Checking service health..."

# Check PostgreSQL
if $COMPOSE_CMD exec -T postgresql pg_isready -U postgres -d mcp_hub >/dev/null 2>&1; then
    echo "✅ PostgreSQL is healthy"
else
    echo "⚠️  PostgreSQL may not be ready yet"
fi

# Check telemetry service
if curl -sf http://localhost:3000/health >/dev/null 2>&1; then
    echo "✅ Telemetry service is healthy"
else
    echo "⚠️  Telemetry service may not be ready yet"
fi

echo ""
echo "🎉 MCP Hub Telemetry is starting up!"
echo ""
echo "📊 Services:"
echo "  - Telemetry API: http://localhost:3000"
echo "  - Dashboard: http://localhost:3000/api/telemetry/dashboard"
echo "  - Admin: http://localhost:3000/admin/metrics"
echo "  - Health: http://localhost:3000/health"
echo "  - PostgreSQL: localhost:5432"
echo "  - Grafana: http://localhost:3002 (admin/$(grep GRAFANA_PASSWORD .env | cut -d'=' -f2))"
echo ""
echo "🔧 Management commands:"
echo "  - View logs: $COMPOSE_CMD logs -f mcp-hub-telemetry"
echo "  - Stop services: $COMPOSE_CMD down"
echo "  - Restart: $COMPOSE_CMD restart"
echo "  - Update: $COMPOSE_CMD pull && $COMPOSE_CMD up -d"
echo ""
echo "📋 Database connection:"
echo "  - Host: localhost"
echo "  - Port: 5432"
echo "  - Database: mcp_hub"
echo "  - User: mcp_hub_app"
echo "  - Password: mcp_hub_secure_password"
echo ""

# Show final status
echo "📈 Current status:"
$COMPOSE_CMD ps

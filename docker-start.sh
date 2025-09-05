#!/bin/bash
set -euo pipefail

echo "Starting MCP Hub with Docker Compose..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "Creating .env file from .env.example..."
    cp .env.example .env
    echo ""
    echo "⚠️  IMPORTANT: Please edit .env file and set your WIX_API_TOKEN"
    echo "   nano .env"
    echo ""
fi

# Create Docker directories if they don't exist
mkdir -p docker/{config,data,logs}

# Start the services
docker-compose up -d

echo ""
echo "MCP Hub is starting up..."
echo ""
echo "Access URLs:"
echo "  - MCP Endpoint: http://localhost:37373/mcp"
echo "  - Health Check: http://localhost:37373/api/health"  
echo "  - REST API: http://localhost:37373/api/*"
echo ""
echo "Commands:"
echo "  - View logs: docker-compose logs -f"
echo "  - Stop: docker-compose down"
echo "  - Restart: docker-compose restart"

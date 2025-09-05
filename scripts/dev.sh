#!/bin/bash

# MCP Hub Development Server Startup Script
set -e

echo "🚀 Starting MCP Hub Development Environment..."

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found. Please install Docker to continue."
    exit 1
fi

# Check if docker compose is available
if ! docker compose version &> /dev/null; then
    echo "❌ docker compose not found. Please install Docker with Compose plugin."
    exit 1
fi

# Create .env.dev if it doesn't exist
if [ ! -f .env.dev ]; then
    echo "📝 Creating .env.dev from template..."
    cp .env.example .env.dev
    echo "✅ Created .env.dev - please update it with your configuration"
fi

# Ensure required directories exist
echo "📁 Creating required directories..."
mkdir -p docker/data docker/logs

# Build and start development environment
echo "🔨 Building development Docker image..."
docker compose -f docker-compose.dev.yml build

echo "🏃 Starting development server with hot-reloading..."
docker compose -f docker-compose.dev.yml up

echo "🎉 MCP Hub development server is now running!"
echo "📖 Server URL: http://localhost:3001"
echo "🐛 Debugger URL: ws://localhost:9229"
echo "📊 Health Check: http://localhost:3001/api/health"
echo ""
echo "To run tests in watch mode:"
echo "  docker compose -f docker-compose.dev.yml --profile test up mcp-hub-test"
echo ""
echo "To stop the development server:"
echo "  docker compose -f docker-compose.dev.yml down"

#!/bin/bash
set -euo pipefail

echo "Building MCP Hub Docker image..."

# Ensure we have the built CLI
if [ ! -f dist/cli.js ]; then
    echo "Building MCP Hub first..."
    npm run build
fi

echo "Build context size:"
du -sh .

# Build the Docker image
docker build -t mcp-hub:latest .

echo ""
echo "Docker image built successfully!"
echo ""
echo "Image size:"
docker images mcp-hub:latest

echo ""
echo "You can now run the container with:"
echo "  ./docker-start.sh"
echo ""
echo "Or run directly with:"
echo "  docker run -d -p 37373:37373 --name mcp-hub -e WIX_API_TOKEN=your-token mcp-hub:latest"

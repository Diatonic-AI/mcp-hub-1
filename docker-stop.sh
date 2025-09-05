#!/bin/bash
set -euo pipefail

echo "Stopping MCP Hub..."

docker-compose down

echo "MCP Hub stopped successfully!"

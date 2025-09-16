#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Installing additional MCP servers..."

# Additional Python servers to try
PYTHON_SERVERS=(
  "mcp-server-youtube-transcript"
  "mcp-server-bigquery" 
  "mcp-server-firecrawl"
  "mcp-server-playwright"
  "mcp-server-browserbase"
  "mcp-server-searxng"
  "mcp-server-chroma"
  "mcp-server-pinecone"
  "mcp-server-weaviate"
  "mcp-server-elasticsearch"
  "mcp-server-langchain"
  "mcp-server-llama-index"
  "mcp-server-pandas"
  "mcp-server-jupyter"
  "mcp-server-redis"
  "mcp-server-kafka"
  "mcp-server-rabbitmq"
  "mcp-server-nats"
)

echo "📦 Attempting to install additional Python MCP servers..."
for server in "${PYTHON_SERVERS[@]}"; do
  echo -n "  Trying $server..."
  if uv tool install "$server" 2>/dev/null; then
    echo " ✅ Installed"
  else
    echo " ❌ Not available"
  fi
done

# NPM servers from the search
echo "📦 Installing enhanced NPM MCP servers..."
npx -y enhanced-postgres-mcp-server --help 2>/dev/null || echo "Failed enhanced-postgres"
npx -y puppeteer-mcp-server --help 2>/dev/null || echo "Failed puppeteer-mcp"
npx -y "@magneticwatermelon/mcp-toolkit" --help 2>/dev/null || echo "Failed mcp-toolkit"

echo "✅ Installation attempts complete"

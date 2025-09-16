# Filesystem MCP Server
FROM mcp-hub/base:latest

# Install filesystem server
USER root
RUN npm install -g @modelcontextprotocol/server-filesystem@latest

# Create data directory
RUN mkdir -p /data && chown -R mcp:mcp /data

USER mcp

# Copy configuration
COPY --chown=mcp:mcp config.json /app/config.json

# Set working directory
WORKDIR /data

# Environment variables
ENV MCP_SERVER_TYPE=filesystem \
    MCP_DATA_DIR=/data \
    MCP_ALLOWED_PATHS=/data

# Start the server
CMD ["npx", "@modelcontextprotocol/server-filesystem", "--port", "8080", "--allowed-paths", "/data"]

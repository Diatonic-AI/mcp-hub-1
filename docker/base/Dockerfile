# Base image for MCP servers
FROM node:20-alpine AS base

# Install common dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    curl \
    bash

# Create app directory
WORKDIR /app

# Install MCP SDK
RUN npm install -g @modelcontextprotocol/sdk@latest

# Create MCP user
RUN addgroup -g 1001 mcp && \
    adduser -D -u 1001 -G mcp mcp

# Base setup for health checks
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))" || exit 1

# Switch to non-root user
USER mcp

# Default environment
ENV NODE_ENV=production \
    MCP_PORT=8080 \
    MCP_HOST=0.0.0.0

# Expose MCP port
EXPOSE 8080

# Base entrypoint (will be overridden by specific servers)
ENTRYPOINT ["node"]

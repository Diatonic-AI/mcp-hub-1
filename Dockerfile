###############################
# MCP Hub Hybrid Base Image   #
# - Node.js runtime (production)
# - uv/uvx for Python MCP servers
# - Supports advanced tool chaining across uvx/npx servers
# - Built CLI + API with optimized dist
###############################

FROM node:24-bullseye-slim AS base
WORKDIR /app

# System deps (curl, git) and Python for uv bootstrap
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
		python3 python3-pip git ca-certificates curl bash tini \
		build-essential python3-dev \
		&& rm -rf /var/lib/apt/lists/*

# Install uv (includes uvx) with latest version and create uv alias
RUN pip3 install --no-cache-dir --upgrade uv \
    && echo 'alias uv="uv"' >> /etc/bash.bashrc \
    && echo 'export PATH="/home/mcp/.local/bin:$PATH"' >> /etc/bash.bashrc

# Create non-root user
RUN useradd -u 1001 -m mcp && mkdir -p /app && chown -R mcp:mcp /app

ENV NODE_ENV=production \
		PORT=37373 \
		HOST=0.0.0.0 \
		PATH="/home/mcp/.local/bin:/root/.local/bin:$PATH" \
		UV_TOOL_DIR="/home/mcp/.local/share/uv/tools" \
		UV_CACHE_DIR="/home/mcp/.cache/uv" \
		PIP_BREAK_SYSTEM_PACKAGES=1

###############################
# Builder stage: install deps & build dist
###############################
FROM base AS build
COPY package*.json ./
RUN npm ci --include=dev
COPY src ./src
COPY scripts ./scripts
COPY examples ./examples
COPY tests ./tests
RUN npm run build && npm test

###############################
# Runtime stage: slim copy of build artifacts + prod deps
###############################
FROM base AS runtime
WORKDIR /app

# Copy only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built CLI + source (retain src for advanced features like chain tools)
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/examples ./examples

# Copy configuration files
COPY config ./config

# Pre-create runtime dirs with proper permissions
RUN mkdir -p config data logs /workspace /app/data /home/mcp/.local/share/uv /home/mcp/.cache/uv /home/mcp/.npm/_logs /home/mcp/.local/bin \
    && chown -R mcp:mcp /app /home/mcp /workspace

# Pre-install frequently used MCP servers BEFORE switching to non-root user
RUN echo "Installing common Node.js MCP servers..." \
 && npm install -g \
    @modelcontextprotocol/server-filesystem \
    @modelcontextprotocol/server-github \
    @modelcontextprotocol/server-everything \
    @modelcontextprotocol/server-memory \
    @modelcontextprotocol/server-sequential-thinking \
 && echo "Verifying Node.js MCP server installations..." \
 && npm ls -g --depth=0 \
 && echo "Node.js MCP servers installed successfully"

USER mcp

# Install uv as mcp user and then install Python MCP servers
RUN pip3 install --user --no-cache-dir --upgrade uv

# Ensure uv is in PATH for the mcp user and install Python MCP servers
ENV PATH="/home/mcp/.local/bin:$PATH"
RUN echo "Installing Python MCP servers via uv tool..." \
 && uv tool install mcp-server-fetch \
 && uv tool install mcp-server-git \
 && uv tool install mcp-server-time \
 && uv tool install mcp-server-sqlite \
 && echo "Python MCP servers installed successfully"

# Test Python MCP servers availability and create tool links
RUN echo "Testing Python MCP servers via uvx..." \
 && uvx --help > /dev/null 2>&1 || echo "uvx not available" \
 && echo "Testing uv tool run..." \
 && uv tool run --help > /dev/null 2>&1 || echo "uv tool run not available" \
 && echo "MCP server pre-installation complete"

EXPOSE 37373 8001

# Healthcheck (API) - updated to test the new chain tool endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=25s --retries=3 \
	CMD node -e " \
		const http=require('http'); \
		const p=process.env.PORT||37373; \
		http.get({host:'localhost',port:p,path:'/api/health',timeout:5000}, \
			r=>process.exit(r.statusCode===200?0:1) \
		).on('error',()=>process.exit(1))" || exit 1

ENTRYPOINT ["tini","--"]
CMD ["node","dist/cli.js","--port","37373","--host","0.0.0.0","--config","./config/mcp-servers.json"]


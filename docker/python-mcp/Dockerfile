########################################
# Dedicated Python MCP Servers Image   #
# - uv/uvx managed tool installs       #
# - Runs a lightweight supervisor      #
# - Exposes no port (stdio via hub)    #
########################################
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    UV_SYSTEM_PYTHON=1 \
    PATH="/root/.local/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends git curl bash ca-certificates && rm -rf /var/lib/apt/lists/*

# Install uv
RUN pip install --no-cache-dir uv

# Convenience uvx shim if needed
RUN echo '#!/bin/bash\nexec uv tool run "$@"' > /usr/local/bin/uvx && chmod +x /usr/local/bin/uvx

WORKDIR /workspace

# Pre-install core Python MCP servers (extend as needed)
# Use || true to avoid failing build if a package has transient issues
RUN uv tool install mcp-server-fetch || true \
 && uv tool install mcp-server-git || true \
 && uv tool install mcp-server-time || true \
 && uv tool install mcp-server-sqlite || true

# Placeholder entrypoint: idle loop so container stays alive and hub can exec into it if needed
# Later we can replace with an API or a small task runner to spawn stdio processes on demand.
ENTRYPOINT ["bash","-c","echo 'python-mcp sidecar ready (uv/uvx installed)'; tail -f /dev/null"]

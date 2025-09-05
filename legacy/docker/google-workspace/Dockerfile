# Google Workspace MCP Server Docker Container
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install uv for package management
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# Set working directory
WORKDIR /app

# Install workspace-mcp from PyPI using uv
RUN /root/.local/bin/uv venv && \
    . .venv/bin/activate && \
    /root/.local/bin/uv pip install workspace-mcp

# Copy entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Expose port for OAuth callback (if needed)
EXPOSE 8000

# Set environment variables (these will be overridden by docker-compose)
ENV PYTHONUNBUFFERED=1
ENV UV_SYSTEM_PYTHON=1

# Use the virtual environment Python
ENV PATH="/app/.venv/bin:${PATH}"

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["--tool-tier", "core"]

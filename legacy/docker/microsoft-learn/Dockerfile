# Microsoft Learn MCP Server Docker Container
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Clone the Learn MCP repository
RUN git clone https://github.com/softchris/learn-mcp.git .

# Install Python dependencies
RUN pip install --no-cache-dir requests "mcp[cli]" fastapi uvicorn starlette

# Expose the SSE port
EXPOSE 8000

# Set environment variables
ENV PYTHONUNBUFFERED=1

# Change to src directory and run the server
WORKDIR /app/src

# Run the server
CMD ["python", "server.py"]

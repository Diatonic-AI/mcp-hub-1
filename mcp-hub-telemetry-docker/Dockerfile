# MCP Hub Telemetry Docker Container
FROM node:20-alpine AS base

# Install system dependencies
RUN apk add --no-cache \
    postgresql-client \
    curl \
    bash \
    tzdata

# Set timezone
ENV TZ=UTC
RUN cp /usr/share/zoneinfo/UTC /etc/localtime

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install Node.js dependencies and generate lock file
RUN npm install --omit=dev && npm cache clean --force

# Create non-root user
RUN addgroup -g 1001 -S telemetry && \
    adduser -S telemetry -u 1001

# Copy application code
COPY src/ ./src/
COPY sql/ ./sql/
COPY config/ ./config/
COPY scripts/ ./scripts/

# Make scripts executable
RUN chmod +x scripts/*.sh

# Set ownership
RUN chown -R telemetry:telemetry /app

# Switch to non-root user for most operations
USER telemetry

# Expose ports
EXPOSE 3000 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Set entrypoint and default command
USER root
ENTRYPOINT ["/app/scripts/entrypoint.sh"]
USER telemetry
CMD ["npm", "start"]

#!/bin/bash

# MCP Hub Production Server Startup Script
# Version: 4.2.1

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
NODE_ENV=${NODE_ENV:-production}
PORT=${PORT:-3456}
HOST=${HOST:-0.0.0.0}
CONFIG_FILE=${CONFIG_FILE:-config.production.json}
LOG_FILE=${LOG_FILE:-./logs/mcp-hub-production.log}

# Print banner
echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║           🚀 MCP Hub Production Server v4.2.1 🚀            ║"
echo "║                                                              ║"
echo "║     ML/DL Pipeline | Telemetry | Docker | Real-Time         ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# System information
echo -e "${BLUE}═══ System Information ═══${NC}"
echo "• Host: $(hostname)"
echo "• OS: $(uname -s) $(uname -r)"
echo "• Node: $(node --version)"
echo "• NPM: $(npm --version)"
echo "• CPU: $(nproc) cores"
echo "• Memory: $(free -h | awk 'NR==2{print $2}')"
echo "• Time: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo ""

# Configuration
echo -e "${GREEN}═══ Configuration ═══${NC}"
echo "• Environment: $NODE_ENV"
echo "• Config File: $CONFIG_FILE"
echo "• Server: http://$HOST:$PORT"
echo "• Log File: $LOG_FILE"
echo ""

# Check dependencies
echo -e "${YELLOW}═══ Checking Dependencies ═══${NC}"

# Check for required Node modules
if [ ! -d "node_modules" ]; then
    echo "⚠️  Node modules not found. Installing..."
    npm install --production
fi

# Create necessary directories
mkdir -p logs models data/sqlite .warp

# Check database connections (non-blocking)
echo -e "${MAGENTA}═══ Service Status ═══${NC}"

# PostgreSQL
if command -v psql &> /dev/null && pg_isready -q 2>/dev/null; then
    echo "✅ PostgreSQL: Available"
else
    echo "⚠️  PostgreSQL: Not available (some features disabled)"
fi

# MongoDB
if command -v mongosh &> /dev/null && mongosh --quiet --eval "db.adminCommand('ping')" 2>/dev/null | grep -q "ok"; then
    echo "✅ MongoDB: Available"
else
    echo "⚠️  MongoDB: Not available (some features disabled)"
fi

# Redis
if command -v redis-cli &> /dev/null && redis-cli ping 2>/dev/null | grep -q "PONG"; then
    echo "✅ Redis: Available"
else
    echo "⚠️  Redis: Not available (some features disabled)"
fi

# Docker
if command -v docker &> /dev/null && docker info &> /dev/null; then
    echo "✅ Docker: Available"
else
    echo "⚠️  Docker: Not available (containerization disabled)"
fi

echo ""

# Export environment variables
export NODE_ENV=$NODE_ENV
export PORT=$PORT
export HOST=$HOST

# Start the server
echo -e "${GREEN}═══ Starting Production Server ═══${NC}"
echo "• Starting MCP Hub..."
echo "• Press Ctrl+C to stop"
echo ""

# Function to handle shutdown
shutdown() {
    echo ""
    echo -e "${YELLOW}═══ Shutting Down ═══${NC}"
    echo "• Graceful shutdown initiated..."
    kill -SIGTERM $SERVER_PID 2>/dev/null || true
    wait $SERVER_PID 2>/dev/null
    echo "• Server stopped"
    echo -e "${GREEN}✅ Shutdown complete${NC}"
    exit 0
}

# Trap signals for graceful shutdown
trap shutdown SIGINT SIGTERM

# Start the server with production configuration
if [ "$1" == "--daemon" ]; then
    # Run as daemon
    echo "• Starting in daemon mode..."
    nohup node src/server.js \
        --config "$CONFIG_FILE" \
        --port "$PORT" \
        --host "$HOST" \
        >> "$LOG_FILE" 2>&1 &
    SERVER_PID=$!
    echo "• Server started with PID: $SERVER_PID"
    echo "• Logs: tail -f $LOG_FILE"
else
    # Run in foreground
    echo "• Starting in foreground mode..."
    echo ""
    echo -e "${CYAN}═══ Server Output ═══${NC}"
    
    node src/server.js \
        --config "$CONFIG_FILE" \
        --port "$PORT" \
        --host "$HOST" &
    
    SERVER_PID=$!
    
    # Wait for server process
    wait $SERVER_PID
fi

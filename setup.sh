#!/bin/bash
# MCP-Hub Master Setup Script
# Runs all necessary setup steps to get the full pipeline operational

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║           MCP-Hub Complete Setup Script                    ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Function to check command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to wait for service
wait_for_service() {
    local service="$1"
    local host="$2"
    local port="$3"
    local max_attempts=30
    local attempt=0
    
    echo -ne "${YELLOW}Waiting for $service...${NC}"
    while ! nc -z "$host" "$port" 2>/dev/null; do
        attempt=$((attempt + 1))
        if [ $attempt -gt $max_attempts ]; then
            echo -e " ${RED}✗ Failed${NC}"
            return 1
        fi
        echo -n "."
        sleep 1
    done
    echo -e " ${GREEN}✓ Ready${NC}"
    return 0
}

echo -e "${BLUE}Step 1: Environment Setup${NC}"
echo "================================"

# Check for .env file
if [ ! -f .env ]; then
    echo -e "${YELLOW}Creating .env file from .env.production...${NC}"
    cp .env.production .env
    echo -e "${GREEN}✓ Environment file created${NC}"
else
    echo -e "${GREEN}✓ Environment file exists${NC}"
fi

# Load environment variables
export $(cat .env | grep -v '^#' | xargs)

echo ""
echo -e "${BLUE}Step 2: Dependency Check${NC}"
echo "================================"

# Check Node.js
if command_exists node; then
    echo -e "${GREEN}✓ Node.js installed: $(node --version)${NC}"
else
    echo -e "${RED}✗ Node.js not installed${NC}"
    exit 1
fi

# Check npm
if command_exists npm; then
    echo -e "${GREEN}✓ npm installed: $(npm --version)${NC}"
else
    echo -e "${RED}✗ npm not installed${NC}"
    exit 1
fi

# Check PostgreSQL client
if command_exists psql; then
    echo -e "${GREEN}✓ PostgreSQL client installed${NC}"
else
    echo -e "${YELLOW}⚠ PostgreSQL client not installed (optional)${NC}"
fi

echo ""
echo -e "${BLUE}Step 3: Install Node Dependencies${NC}"
echo "================================"

if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing npm packages...${NC}"
    npm install
    echo -e "${GREEN}✓ Dependencies installed${NC}"
else
    echo -e "${GREEN}✓ Dependencies already installed${NC}"
fi

echo ""
echo -e "${BLUE}Step 4: Service Health Check${NC}"
echo "================================"

# Check PostgreSQL
echo -n "PostgreSQL: "
if wait_for_service "PostgreSQL" localhost 5432; then
    POSTGRES_OK=true
else
    POSTGRES_OK=false
    echo -e "${YELLOW}⚠ PostgreSQL not running. Please start it first.${NC}"
fi

# Check Redis
echo -n "Redis: "
if wait_for_service "Redis" localhost 6379; then
    REDIS_OK=true
else
    REDIS_OK=false
    echo -e "${YELLOW}⚠ Redis not running (optional).${NC}"
fi

# Check MongoDB
echo -n "MongoDB: "
if wait_for_service "MongoDB" localhost 27017; then
    MONGODB_OK=true
else
    MONGODB_OK=false
    echo -e "${YELLOW}⚠ MongoDB not running (optional).${NC}"
fi

echo ""
echo -e "${BLUE}Step 5: Database Migration${NC}"
echo "================================"

if [ "$POSTGRES_OK" = true ]; then
    echo -e "${YELLOW}Running PostgreSQL migrations...${NC}"
    ./scripts/run-migration.sh
    echo -e "${GREEN}✓ Database migration completed${NC}"
else
    echo -e "${RED}✗ Skipping migration - PostgreSQL not available${NC}"
    echo -e "${YELLOW}Run './scripts/run-migration.sh' after starting PostgreSQL${NC}"
fi

echo ""
echo -e "${BLUE}Step 6: Create Required Directories${NC}"
echo "================================"

# Create necessary directories
mkdir -p logs
mkdir -p public
mkdir -p .warp
mkdir -p config

echo -e "${GREEN}✓ Directories created${NC}"

echo ""
echo -e "${BLUE}Step 7: Configuration Files${NC}"
echo "================================"

# Check for MCP config
if [ ! -f "config/servers.json" ]; then
    echo -e "${YELLOW}Creating default MCP server configuration...${NC}"
    echo '{"mcpServers": {}}' > config/servers.json
    echo -e "${GREEN}✓ MCP configuration created${NC}"
else
    echo -e "${GREEN}✓ MCP configuration exists${NC}"
fi

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                  Setup Complete! 🎉                        ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${BLUE}Ready to start MCP-Hub!${NC}"
echo ""
echo -e "${GREEN}Start the server:${NC}"
echo "  npm start"
echo ""
echo -e "${GREEN}Or start in development mode:${NC}"
echo "  npm run dev"
echo ""
echo -e "${GREEN}Run tests:${NC}"
echo "  ./scripts/test-pipeline.sh"
echo ""
echo -e "${GREEN}Access points:${NC}"
echo "  Dashboard: ${CYAN}http://localhost:3456/dashboard.html${NC}"
echo "  API:       ${CYAN}http://localhost:3456/api${NC}"
echo "  Docs:      ${CYAN}http://localhost:3456/api-docs${NC}"
echo ""

# Offer to start the server
read -p "Would you like to start the MCP-Hub server now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${GREEN}Starting MCP-Hub server...${NC}"
    npm start
fi

# MCP Hub Makefile
.PHONY: help build start stop restart status logs clean setup-env test

# Default target
help:
	@echo "MCP Hub Management Commands"
	@echo "============================"
	@echo "make setup-env     - Create .env file for credentials"
	@echo "make build         - Build all Docker images"
	@echo "make start         - Start all MCP servers"
	@echo "make stop          - Stop all MCP servers"
	@echo "make restart       - Restart all MCP servers"
	@echo "make status        - Show server status"
	@echo "make logs          - View all server logs"
	@echo "make clean         - Remove all containers and volumes"
	@echo ""
	@echo "Server-specific commands:"
	@echo "make start-google  - Start Google Workspace server"
	@echo "make start-learn   - Start Microsoft Learn server"
	@echo "make logs-google   - View Google Workspace logs"
	@echo "make logs-learn    - View Microsoft Learn logs"
	@echo ""
	@echo "Development commands:"
	@echo "make dev           - Start mcp-hub in development mode"
	@echo "make test          - Run tests"

# Environment setup
setup-env:
	@./scripts/manage-mcp-servers.sh setup-env

# Docker commands
build:
	@./scripts/manage-mcp-servers.sh build

start:
	@./scripts/manage-mcp-servers.sh start

stop:
	@./scripts/manage-mcp-servers.sh stop

restart:
	@./scripts/manage-mcp-servers.sh restart

status:
	@./scripts/manage-mcp-servers.sh status

logs:
	@docker-compose -f docker-compose.mcp.yml logs --tail=100

clean:
	@./scripts/manage-mcp-servers.sh cleanup

# Server-specific commands
start-google:
	@./scripts/manage-mcp-servers.sh start google-workspace

stop-google:
	@./scripts/manage-mcp-servers.sh stop google-workspace

logs-google:
	@./scripts/manage-mcp-servers.sh logs google-workspace

start-learn:
	@./scripts/manage-mcp-servers.sh start microsoft-learn

stop-learn:
	@./scripts/manage-mcp-servers.sh stop microsoft-learn

logs-learn:
	@./scripts/manage-mcp-servers.sh logs microsoft-learn

# Development commands
dev:
	npm run dev

test:
	npm test

# Docker compose shortcuts
up:
	docker-compose -f docker-compose.mcp.yml up -d

down:
	docker-compose -f docker-compose.mcp.yml down

ps:
	docker-compose -f docker-compose.mcp.yml ps

# Combined commands
all: build start status

refresh: stop build start status

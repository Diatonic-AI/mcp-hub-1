#!/bin/bash

# MCP Hub Management Script
# Provides comprehensive management for MCP Hub including OAuth persistence,
# server monitoring, health checks, and recovery procedures.

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HUB_URL="http://localhost:37373"
PID_FILE="$PROJECT_DIR/.mcp-hub.pid"
LOG_FILE="$PROJECT_DIR/logs/mcp-hub-manager.log"
OAUTH_MANAGER="$SCRIPT_DIR/enhance-oauth-persistence.js"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    mkdir -p "$(dirname "$LOG_FILE")"
    echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
    
    case $level in
        ERROR) echo -e "${RED}❌ $message${NC}" ;;
        WARN) echo -e "${YELLOW}⚠️  $message${NC}" ;;
        INFO) echo -e "${GREEN}✅ $message${NC}" ;;
        DEBUG) echo -e "${BLUE}🔍 $message${NC}" ;;
        *) echo "📋 $message" ;;
    esac
}

# Check if MCP Hub is running
is_hub_running() {
    if [[ -f "$PID_FILE" ]]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            return 0
        else
            rm -f "$PID_FILE"
            return 1
        fi
    fi
    return 1
}

# Check if MCP Hub is responding
is_hub_responsive() {
    curl -s "$HUB_URL/api/health" >/dev/null 2>&1
}

# Start MCP Hub
start_hub() {
    log "INFO" "Starting MCP Hub..."
    
    if is_hub_running; then
        log "WARN" "MCP Hub is already running (PID: $(cat "$PID_FILE"))"
        return 0
    fi
    
    cd "$PROJECT_DIR"
    
    # Ensure all dependencies are installed
    if [[ ! -d "node_modules" ]] || [[ ! -f "node_modules/.bin/nodemon" ]]; then
        log "INFO" "Installing dependencies..."
        npm install
    fi
    
    # Create logs directory
    mkdir -p logs
    
    # Start the hub with nodemon for development, pm2 for production
    if command -v pm2 >/dev/null 2>&1; then
        log "INFO" "Starting with PM2..."
        pm2 start ecosystem.config.js --only mcp-hub 2>/dev/null || {
            pm2 start "npm run dev" --name mcp-hub --log-file logs/mcp-hub.log
        }
        pm2 save
        pm2 startup
    else
        log "INFO" "Starting with nodemon..."
        nohup npm run dev > logs/mcp-hub.log 2>&1 &
        local pid=$!
        echo "$pid" > "$PID_FILE"
        
        # Wait for startup
        local retries=30
        while [[ $retries -gt 0 ]]; do
            if is_hub_responsive; then
                log "INFO" "MCP Hub started successfully (PID: $pid)"
                return 0
            fi
            sleep 1
            ((retries--))
        done
        
        log "ERROR" "MCP Hub failed to start within 30 seconds"
        return 1
    fi
}

# Stop MCP Hub
stop_hub() {
    log "INFO" "Stopping MCP Hub..."
    
    if command -v pm2 >/dev/null 2>&1; then
        pm2 stop mcp-hub 2>/dev/null || true
        pm2 delete mcp-hub 2>/dev/null || true
    fi
    
    if is_hub_running; then
        local pid=$(cat "$PID_FILE")
        kill "$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
        rm -f "$PID_FILE"
        log "INFO" "MCP Hub stopped"
    else
        log "INFO" "MCP Hub was not running"
    fi
}

# Restart MCP Hub
restart_hub() {
    log "INFO" "Restarting MCP Hub..."
    stop_hub
    sleep 2
    start_hub
}

# Check MCP Hub status
status_hub() {
    echo "🔍 MCP Hub Status Check"
    echo "======================="
    
    if is_hub_running; then
        local pid=$(cat "$PID_FILE")
        echo "✅ Process: Running (PID: $pid)"
        
        if is_hub_responsive; then
            echo "✅ Service: Responding"
            
            # Get detailed status
            local status_data=$(curl -s "$HUB_URL/api/health" | jq -r '.status // "unknown"')
            local server_count=$(curl -s "$HUB_URL/api/servers" | jq -r '.servers | length // 0')
            local connected_count=$(curl -s "$HUB_URL/api/servers" | jq -r '[.servers[] | select(.status == "connected")] | length // 0')
            
            echo "📊 Status: $status_data"
            echo "🔌 Servers: $connected_count/$server_count connected"
        else
            echo "❌ Service: Not responding"
        fi
    else
        echo "❌ Process: Not running"
    fi
    
    echo ""
    echo "📁 Locations:"
    echo "   - Project: $PROJECT_DIR"
    echo "   - Logs: $LOG_FILE"
    echo "   - PID File: $PID_FILE"
    echo "   - Hub URL: $HUB_URL"
}

# OAuth management functions
oauth_status() {
    log "INFO" "Checking OAuth status..."
    node "$OAUTH_MANAGER" status
}

oauth_repair() {
    log "INFO" "Repairing OAuth connections..."
    node "$OAUTH_MANAGER" repair
}

oauth_monitor() {
    log "INFO" "Starting OAuth monitoring..."
    node "$OAUTH_MANAGER" monitor
}

# Health check function
health_check() {
    log "INFO" "Performing comprehensive health check..."
    
    # Check MCP Hub
    if ! is_hub_running; then
        log "ERROR" "MCP Hub is not running - attempting to start..."
        start_hub
    elif ! is_hub_responsive; then
        log "ERROR" "MCP Hub is not responding - attempting restart..."
        restart_hub
    else
        log "INFO" "MCP Hub is healthy"
    fi
    
    # Check OAuth connections
    node "$OAUTH_MANAGER" health
    
    # Check server connections
    local servers_data=$(curl -s "$HUB_URL/api/servers")
    local total_servers=$(echo "$servers_data" | jq -r '.servers | length // 0')
    local connected_servers=$(echo "$servers_data" | jq -r '[.servers[] | select(.status == "connected")] | length // 0')
    local disconnected_servers=$(echo "$servers_data" | jq -r '[.servers[] | select(.status == "disconnected")] | length // 0')
    
    log "INFO" "Server Summary: $connected_servers/$total_servers connected, $disconnected_servers disconnected"
    
    if [[ $disconnected_servers -gt 0 ]]; then
        log "WARN" "Found $disconnected_servers disconnected servers"
        echo "$servers_data" | jq -r '.servers[] | select(.status == "disconnected") | "  - \(.name): \(.description)"'
    fi
}

# Backup function
backup_data() {
    log "INFO" "Creating backup..."
    
    local backup_dir="$PROJECT_DIR/backups/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$backup_dir"
    
    # Backup configuration
    cp -r config "$backup_dir/"
    
    # Backup OAuth data
    node "$OAUTH_MANAGER" backup
    
    # Backup logs
    if [[ -d logs ]]; then
        cp -r logs "$backup_dir/"
    fi
    
    # Create backup metadata
    cat > "$backup_dir/metadata.json" << EOF
{
    "created_at": "$(date -u +"%Y-%m-%d %H:%M:%S UTC")",
    "version": "$(npm pkg get version 2>/dev/null | tr -d '"' || echo 'unknown')",
    "git_commit": "$(git rev-parse HEAD 2>/dev/null || echo 'unknown')",
    "node_version": "$(node --version)",
    "hub_url": "$HUB_URL"
}
EOF
    
    log "INFO" "Backup created at: $backup_dir"
}

# Install service (systemd)
install_service() {
    log "INFO" "Installing MCP Hub as systemd service..."
    
    local service_file="/etc/systemd/system/mcp-hub.service"
    local user=$(whoami)
    
    sudo tee "$service_file" > /dev/null << EOF
[Unit]
Description=MCP Hub - Model Context Protocol Hub
After=network.target
Wants=network.target

[Service]
Type=simple
User=$user
WorkingDirectory=$PROJECT_DIR
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/cli.js --port 37373 --host 0.0.0.0 --config ./config/mcp-servers.json
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mcp-hub

[Install]
WantedBy=multi-user.target
EOF

    # Reload systemd and enable service
    sudo systemctl daemon-reload
    sudo systemctl enable mcp-hub
    
    log "INFO" "Service installed. Use 'sudo systemctl start mcp-hub' to start"
}

# Update function
update_hub() {
    log "INFO" "Updating MCP Hub..."
    
    # Backup first
    backup_data
    
    # Stop hub
    stop_hub
    
    # Update code
    git pull origin main 2>/dev/null || {
        log "WARN" "Could not update via git - manual update may be required"
    }
    
    # Update dependencies
    npm install
    
    # Build if needed
    if [[ -f "package.json" ]] && npm run build >/dev/null 2>&1; then
        log "INFO" "Built successfully"
    fi
    
    # Restart
    start_hub
    
    log "INFO" "Update completed"
}

# Show logs
show_logs() {
    local lines="${1:-50}"
    
    echo "📋 MCP Hub Logs (last $lines lines):"
    echo "===================================="
    
    if [[ -f "$PROJECT_DIR/logs/mcp-hub.log" ]]; then
        tail -n "$lines" "$PROJECT_DIR/logs/mcp-hub.log"
    else
        log "WARN" "No log file found at $PROJECT_DIR/logs/mcp-hub.log"
    fi
    
    echo ""
    echo "📋 Manager Logs (last $lines lines):"
    echo "===================================="
    
    if [[ -f "$LOG_FILE" ]]; then
        tail -n "$lines" "$LOG_FILE"
    else
        log "WARN" "No manager log file found"
    fi
}

# Development helper
dev_mode() {
    log "INFO" "Starting development mode with auto-reload and OAuth monitoring..."
    
    # Start OAuth monitoring in background
    nohup node "$OAUTH_MANAGER" monitor > logs/oauth-monitor.log 2>&1 &
    local oauth_pid=$!
    
    # Start the hub in dev mode
    start_hub
    
    # Monitor logs
    echo "Press Ctrl+C to stop..."
    trap "kill $oauth_pid 2>/dev/null || true; stop_hub; exit" INT
    
    tail -f logs/mcp-hub.log 2>/dev/null &
    tail -f logs/oauth-monitor.log 2>/dev/null &
    
    wait
}

# Show usage
usage() {
    cat << EOF
MCP Hub Manager - Comprehensive MCP Hub Management

Usage: $0 <command> [options]

Commands:
  start           Start MCP Hub
  stop            Stop MCP Hub  
  restart         Restart MCP Hub
  status          Show MCP Hub status
  health          Perform health check
  logs [lines]    Show recent logs (default: 50 lines)
  
OAuth Management:
  oauth:status    Show OAuth connection status
  oauth:repair    Attempt to repair OAuth connections
  oauth:monitor   Start OAuth monitoring (continuous)
  
System Management:
  backup          Create backup of configuration and data
  update          Update MCP Hub to latest version
  install-service Install as systemd service
  dev             Start in development mode with monitoring
  
Examples:
  $0 start                    # Start the hub
  $0 oauth:status            # Check OAuth connections
  $0 health                  # Run health check
  $0 logs 100                # Show last 100 log lines
  $0 dev                     # Start development mode

EOF
}

# Main command handler
main() {
    local command="${1:-}"
    
    case "$command" in
        start)
            start_hub
            ;;
        stop)
            stop_hub
            ;;
        restart)
            restart_hub
            ;;
        status)
            status_hub
            ;;
        health)
            health_check
            ;;
        logs)
            show_logs "${2:-50}"
            ;;
        oauth:status)
            oauth_status
            ;;
        oauth:repair)
            oauth_repair
            ;;
        oauth:monitor)
            oauth_monitor
            ;;
        backup)
            backup_data
            ;;
        update)
            update_hub
            ;;
        install-service)
            install_service
            ;;
        dev)
            dev_mode
            ;;
        *)
            usage
            exit 1
            ;;
    esac
}

# Run main function
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi

#!/bin/bash

# MCP Servers Docker Management Script
# This script manages Docker containers for MCP servers

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.mcp.yml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if Docker is installed
check_docker() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
}

# Build Docker images
build_servers() {
    print_status "Building MCP server Docker images..."
    cd "$PROJECT_ROOT"
    docker-compose -f "$COMPOSE_FILE" build
    print_status "Build complete!"
}

# Start all MCP servers
start_all() {
    print_status "Starting all MCP servers..."
    cd "$PROJECT_ROOT"
    docker-compose -f "$COMPOSE_FILE" up -d
    print_status "All servers started!"
    status
}

# Stop all MCP servers
stop_all() {
    print_status "Stopping all MCP servers..."
    cd "$PROJECT_ROOT"
    docker-compose -f "$COMPOSE_FILE" down
    print_status "All servers stopped!"
}

# Start specific server
start_server() {
    local server=$1
    print_status "Starting $server..."
    cd "$PROJECT_ROOT"
    docker-compose -f "$COMPOSE_FILE" up -d "$server"
    print_status "$server started!"
}

# Stop specific server
stop_server() {
    local server=$1
    print_status "Stopping $server..."
    cd "$PROJECT_ROOT"
    docker-compose -f "$COMPOSE_FILE" stop "$server"
    print_status "$server stopped!"
}

# Restart specific server
restart_server() {
    local server=$1
    print_status "Restarting $server..."
    cd "$PROJECT_ROOT"
    docker-compose -f "$COMPOSE_FILE" restart "$server"
    print_status "$server restarted!"
}

# Show status of all servers
status() {
    print_status "MCP Server Status:"
    echo ""
    docker-compose -f "$COMPOSE_FILE" ps
}

# View logs for a server
view_logs() {
    local server=$1
    local follow=${2:-false}
    
    if [ "$follow" = "true" ]; then
        docker-compose -f "$COMPOSE_FILE" logs -f "$server"
    else
        docker-compose -f "$COMPOSE_FILE" logs --tail=50 "$server"
    fi
}

# Clean up containers and volumes
cleanup() {
    print_warning "This will remove all MCP server containers and volumes!"
    read -p "Are you sure? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_status "Cleaning up..."
        cd "$PROJECT_ROOT"
        docker-compose -f "$COMPOSE_FILE" down -v
        print_status "Cleanup complete!"
    else
        print_status "Cleanup cancelled."
    fi
}

# Setup environment file
setup_env() {
    local env_file="$PROJECT_ROOT/.env"
    
    if [ -f "$env_file" ]; then
        print_warning ".env file already exists. Do you want to overwrite it? (y/N)"
        read -p "" -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_status "Setup cancelled."
            return
        fi
    fi
    
    print_status "Setting up environment file..."
    cat > "$env_file" << 'EOF'
# Google Workspace OAuth Credentials
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret
USER_GOOGLE_EMAIL=your-email@gmail.com
OAUTHLIB_INSECURE_TRANSPORT=1

# Google Custom Search (Optional)
GOOGLE_PSE_API_KEY=
GOOGLE_PSE_ENGINE_ID=
EOF
    
    print_status "Environment file created at $env_file"
    print_warning "Please edit $env_file and add your actual credentials!"
}

# Main menu
show_menu() {
    echo ""
    echo "MCP Servers Docker Management"
    echo "=============================="
    echo "1. Build server images"
    echo "2. Start all servers"
    echo "3. Stop all servers"
    echo "4. Start specific server"
    echo "5. Stop specific server"
    echo "6. Restart specific server"
    echo "7. Show server status"
    echo "8. View server logs"
    echo "9. Setup environment file"
    echo "10. Clean up (remove all)"
    echo "0. Exit"
    echo ""
    read -p "Select an option: " choice
}

# Main script logic
main() {
    check_docker
    
    case "$1" in
        build)
            build_servers
            ;;
        start)
            if [ -z "$2" ]; then
                start_all
            else
                start_server "$2"
            fi
            ;;
        stop)
            if [ -z "$2" ]; then
                stop_all
            else
                stop_server "$2"
            fi
            ;;
        restart)
            if [ -z "$2" ]; then
                print_error "Please specify a server to restart"
                exit 1
            else
                restart_server "$2"
            fi
            ;;
        status)
            status
            ;;
        logs)
            if [ -z "$2" ]; then
                print_error "Please specify a server name"
                exit 1
            else
                view_logs "$2" "${3:-false}"
            fi
            ;;
        cleanup)
            cleanup
            ;;
        setup-env)
            setup_env
            ;;
        menu|"")
            while true; do
                show_menu
                case $choice in
                    1) build_servers ;;
                    2) start_all ;;
                    3) stop_all ;;
                    4) 
                        read -p "Enter server name (google-workspace/microsoft-learn): " server
                        start_server "$server"
                        ;;
                    5)
                        read -p "Enter server name (google-workspace/microsoft-learn): " server
                        stop_server "$server"
                        ;;
                    6)
                        read -p "Enter server name (google-workspace/microsoft-learn): " server
                        restart_server "$server"
                        ;;
                    7) status ;;
                    8)
                        read -p "Enter server name (google-workspace/microsoft-learn): " server
                        read -p "Follow logs? (y/N): " follow
                        if [[ $follow =~ ^[Yy]$ ]]; then
                            view_logs "$server" true
                        else
                            view_logs "$server" false
                        fi
                        ;;
                    9) setup_env ;;
                    10) cleanup ;;
                    0) exit 0 ;;
                    *) print_error "Invalid option" ;;
                esac
            done
            ;;
        help|--help|-h)
            echo "Usage: $0 [command] [options]"
            echo ""
            echo "Commands:"
            echo "  build              Build Docker images for all servers"
            echo "  start [server]     Start all servers or specific server"
            echo "  stop [server]      Stop all servers or specific server"
            echo "  restart <server>   Restart specific server"
            echo "  status             Show status of all servers"
            echo "  logs <server>      View logs for specific server"
            echo "  cleanup            Remove all containers and volumes"
            echo "  setup-env          Create .env file template"
            echo "  menu               Show interactive menu (default)"
            echo ""
            echo "Server names:"
            echo "  google-workspace   Google Workspace MCP Server"
            echo "  microsoft-learn    Microsoft Learn MCP Server"
            echo ""
            echo "Examples:"
            echo "  $0 build"
            echo "  $0 start google-workspace"
            echo "  $0 logs microsoft-learn true  # Follow logs"
            ;;
        *)
            print_error "Unknown command: $1"
            echo "Use '$0 help' for usage information"
            exit 1
            ;;
    esac
}

main "$@"

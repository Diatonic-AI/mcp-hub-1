#!/bin/bash

# AWS MCP Servers Diagnostic and Repair Tool
# Comprehensive tool for diagnosing and fixing AWS MCP server connectivity issues

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HUB_URL="http://localhost:37373"
CONFIG_FILE="$PROJECT_DIR/config/mcp-servers.json"
ENV_FILE="$PROJECT_DIR/.env"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Logging function
log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    case $level in
        ERROR) echo -e "${RED}❌ [$timestamp] $message${NC}" ;;
        WARN) echo -e "${YELLOW}⚠️  [$timestamp] $message${NC}" ;;
        INFO) echo -e "${GREEN}✅ [$timestamp] $message${NC}" ;;
        DEBUG) echo -e "${BLUE}🔍 [$timestamp] $message${NC}" ;;
        *) echo -e "${CYAN}📋 [$timestamp] $message${NC}" ;;
    esac
}

# Check AWS CLI and credentials
check_aws_prerequisites() {
    log "INFO" "Checking AWS prerequisites..."
    
    # Check if AWS CLI is installed
    if ! command -v aws >/dev/null 2>&1; then
        log "WARN" "AWS CLI not found. Installing via apt..."
        sudo apt update && sudo apt install -y awscli || {
            log "ERROR" "Failed to install AWS CLI"
            return 1
        }
    fi
    
    local aws_version=$(aws --version 2>&1)
    log "INFO" "AWS CLI version: $aws_version"
    
    # Check if UV is installed (needed for some AWS MCP servers)
    if ! command -v uv >/dev/null 2>&1; then
        log "WARN" "UV (Python package manager) not found. Installing..."
        curl -LsSf https://astral.sh/uv/install.sh | sh
        source ~/.cargo/env 2>/dev/null || true
        export PATH="$HOME/.cargo/bin:$PATH"
    fi
    
    local uv_version=$(uv --version 2>/dev/null || echo "Not available")
    log "INFO" "UV version: $uv_version"
    
    # Check if NPX is available
    if ! command -v npx >/dev/null 2>&1; then
        log "ERROR" "NPX not found. Please install Node.js and npm"
        return 1
    fi
    
    local node_version=$(node --version 2>/dev/null || echo "Not available")
    log "INFO" "Node.js version: $node_version"
}

# Parse AWS credentials from environment
parse_aws_credentials() {
    log "INFO" "Parsing AWS credentials from environment files..."
    
    # Check .env file
    if [[ -f "$ENV_FILE" ]]; then
        log "DEBUG" "Reading credentials from .env file"
        
        # Source the .env file safely
        while IFS= read -r line || [[ -n "$line" ]]; do
            # Skip comments and empty lines
            [[ "$line" =~ ^[[:space:]]*# ]] && continue
            [[ -z "${line// }" ]] && continue
            
            # Export environment variables
            if [[ "$line" =~ ^[[:space:]]*([^=]+)=(.*)$ ]]; then
                local var_name="${BASH_REMATCH[1]}"
                local var_value="${BASH_REMATCH[2]}"
                export "$var_name"="$var_value"
            fi
        done < "$ENV_FILE"
    fi
    
    # Display current AWS configuration
    echo "🔑 Current AWS Configuration:"
    echo "   AWS_REGION: ${AWS_REGION:-not set}"
    echo "   AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID:+***${AWS_ACCESS_KEY_ID: -4}}"
    echo "   AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY:+***redacted***}"
    
    # Validate credentials format
    if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
        log "ERROR" "AWS_ACCESS_KEY_ID not set"
        return 1
    fi
    
    if [[ -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
        log "ERROR" "AWS_SECRET_ACCESS_KEY not set"
        return 1
    fi
    
    if [[ -z "${AWS_REGION:-}" ]]; then
        log "WARN" "AWS_REGION not set, defaulting to us-east-1"
        export AWS_REGION="us-east-1"
    fi
}

# Test AWS credentials
test_aws_credentials() {
    log "INFO" "Testing AWS credentials..."
    
    # Test basic AWS connectivity
    if aws sts get-caller-identity >/dev/null 2>&1; then
        local identity=$(aws sts get-caller-identity)
        local account=$(echo "$identity" | jq -r '.Account // "unknown"' 2>/dev/null || echo "unknown")
        local arn=$(echo "$identity" | jq -r '.Arn // "unknown"' 2>/dev/null || echo "unknown")
        
        log "INFO" "AWS credentials valid"
        echo "   Account: $account"
        echo "   ARN: $arn"
        echo "   Region: ${AWS_REGION}"
        
        return 0
    else
        log "ERROR" "AWS credentials test failed"
        echo "Common issues:"
        echo "   - Invalid credentials"
        echo "   - Expired credentials"
        echo "   - Network connectivity issues"
        echo "   - AWS service outage"
        return 1
    fi
}

# Check AWS permissions for MCP operations
check_aws_permissions() {
    log "INFO" "Checking AWS permissions for MCP operations..."
    
    local permissions_ok=true
    
    # Test S3 permissions
    log "DEBUG" "Testing S3 permissions..."
    if aws s3 ls >/dev/null 2>&1; then
        log "INFO" "S3 ListBuckets permission: ✅"
    else
        log "WARN" "S3 ListBuckets permission: ❌"
        permissions_ok=false
    fi
    
    # Test DynamoDB permissions
    log "DEBUG" "Testing DynamoDB permissions..."
    if aws dynamodb list-tables >/dev/null 2>&1; then
        log "INFO" "DynamoDB ListTables permission: ✅"
    else
        log "WARN" "DynamoDB ListTables permission: ❌"
        permissions_ok=false
    fi
    
    # Test Lambda permissions
    log "DEBUG" "Testing Lambda permissions..."
    if aws lambda list-functions >/dev/null 2>&1; then
        log "INFO" "Lambda ListFunctions permission: ✅"
    else
        log "WARN" "Lambda ListFunctions permission: ❌"
        permissions_ok=false
    fi
    
    # Test EC2 permissions (for AWS API server)
    log "DEBUG" "Testing EC2 permissions..."
    if aws ec2 describe-regions >/dev/null 2>&1; then
        log "INFO" "EC2 DescribeRegions permission: ✅"
    else
        log "WARN" "EC2 DescribeRegions permission: ❌"
        permissions_ok=false
    fi
    
    if $permissions_ok; then
        log "INFO" "AWS permissions check passed"
        return 0
    else
        log "WARN" "Some AWS permissions missing - some MCP servers may have limited functionality"
        return 1
    fi
}

# Get current AWS MCP server statuses
get_aws_server_statuses() {
    log "INFO" "Getting current AWS MCP server statuses..."
    
    if ! curl -s "$HUB_URL/api/health" >/dev/null; then
        log "ERROR" "MCP Hub not responding at $HUB_URL"
        return 1
    fi
    
    local servers_data=$(curl -s "$HUB_URL/api/servers")
    
    echo "🔌 AWS MCP Server Status:"
    echo "$servers_data" | jq -r '.servers[] | select(.name | startswith("aws")) | "   \(.name): \(.status) - \(.description)"'
    
    # Count statuses
    local total_aws=$(echo "$servers_data" | jq -r '[.servers[] | select(.name | startswith("aws"))] | length')
    local connected_aws=$(echo "$servers_data" | jq -r '[.servers[] | select(.name | startswith("aws") and .status == "connected")] | length')
    local disconnected_aws=$(echo "$servers_data" | jq -r '[.servers[] | select(.name | startswith("aws") and .status == "disconnected")] | length')
    
    echo ""
    echo "📊 Summary: $connected_aws/$total_aws AWS servers connected ($disconnected_aws disconnected)"
    
    export AWS_SERVERS_TOTAL="$total_aws"
    export AWS_SERVERS_CONNECTED="$connected_aws"
    export AWS_SERVERS_DISCONNECTED="$disconnected_aws"
}

# Fix configuration inconsistencies
fix_configuration() {
    log "INFO" "Fixing configuration inconsistencies..."
    
    # Create backup of current configuration
    cp "$CONFIG_FILE" "$CONFIG_FILE.backup.$(date +%Y%m%d-%H%M%S)"
    log "INFO" "Configuration backup created"
    
    # Update AWS credentials in configuration to match .env file
    log "INFO" "Updating AWS credentials in MCP configuration..."
    
    local temp_config="/tmp/mcp-servers-fixed.json"
    
    # Use jq to update all AWS server configurations
    jq --arg access_key "$AWS_ACCESS_KEY_ID" \
       --arg secret_key "$AWS_SECRET_ACCESS_KEY" \
       --arg region "$AWS_REGION" \
       '
       .mcpServers |= with_entries(
         if .key | startswith("aws") then
           .value.env = (.value.env // {}) | 
           .value.env.AWS_ACCESS_KEY_ID = $access_key |
           .value.env.AWS_SECRET_ACCESS_KEY = $secret_key |
           .value.env.AWS_REGION = $region
         else
           .
         end
       )
       ' "$CONFIG_FILE" > "$temp_config"
    
    # Verify the JSON is valid
    if jq . "$temp_config" >/dev/null 2>&1; then
        mv "$temp_config" "$CONFIG_FILE"
        log "INFO" "Configuration updated successfully"
    else
        log "ERROR" "Generated configuration is invalid JSON"
        rm -f "$temp_config"
        return 1
    fi
}

# Install missing AWS MCP packages
install_aws_packages() {
    log "INFO" "Installing/updating AWS MCP packages..."
    
    # AWS SDK MCP Server (aws-api)
    log "DEBUG" "Installing AWS SDK MCP Server..."
    if ! npx -y @aws-sdk/mcp-server --help >/dev/null 2>&1; then
        log "WARN" "AWS SDK MCP Server may not be installed correctly"
    fi
    
    # AWS Knowledge MCP Server (aws-knowledge)  
    log "DEBUG" "Installing AWS Knowledge MCP Server..."
    if ! npx -y awslabs-aws-knowledge-mcp-server --help >/dev/null 2>&1; then
        log "WARN" "AWS Knowledge MCP Server may not be installed correctly"
    fi
    
    # AWS Lambda Tool MCP Server (aws-lambda-tool)
    log "DEBUG" "Installing AWS Lambda Tool MCP Server..."
    if ! uv tool install awslabs.lambda-tool-mcp-server 2>/dev/null; then
        log "WARN" "Failed to install AWS Lambda Tool MCP Server via UV"
    fi
    
    log "INFO" "AWS MCP packages installation completed"
}

# Test individual AWS MCP servers
test_aws_servers() {
    log "INFO" "Testing individual AWS MCP servers..."
    
    local test_results=()
    
    # Test aws-api server
    log "DEBUG" "Testing aws-api server..."
    if timeout 10 npx -y @aws-sdk/mcp-server <<< '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' >/dev/null 2>&1; then
        test_results+=("aws-api: ✅")
    else
        test_results+=("aws-api: ❌")
    fi
    
    # Test aws-knowledge server
    log "DEBUG" "Testing aws-knowledge server..."
    if timeout 10 npx -y awslabs-aws-knowledge-mcp-server <<< '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' >/dev/null 2>&1; then
        test_results+=("aws-knowledge: ✅")
    else
        test_results+=("aws-knowledge: ❌")
    fi
    
    # Test aws-lambda-tool server (using uv)
    log "DEBUG" "Testing aws-lambda-tool server..."
    if timeout 10 uvx awslabs.lambda-tool-mcp-server <<< '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' >/dev/null 2>&1; then
        test_results+=("aws-lambda-tool: ✅")
    else
        test_results+=("aws-lambda-tool: ❌")
    fi
    
    echo "🧪 Individual Server Tests:"
    printf '   %s\n' "${test_results[@]}"
}

# Restart disconnected AWS servers
restart_aws_servers() {
    log "INFO" "Restarting disconnected AWS servers..."
    
    local servers_to_restart=("aws-api" "aws-knowledge" "aws-lambda-tool")
    local restart_count=0
    
    for server in "${servers_to_restart[@]}"; do
        log "DEBUG" "Restarting $server..."
        
        if curl -s -X POST "$HUB_URL/api/servers/start" \
           -H "Content-Type: application/json" \
           -d "{\"server_name\":\"$server\"}" >/dev/null; then
            log "INFO" "Started $server"
            ((restart_count++))
        else
            log "ERROR" "Failed to start $server"
        fi
        
        # Wait a bit between restarts
        sleep 2
    done
    
    log "INFO" "Restarted $restart_count servers"
    
    # Wait for servers to initialize
    log "INFO" "Waiting 10 seconds for servers to initialize..."
    sleep 10
}

# Generate comprehensive diagnostic report
generate_diagnostic_report() {
    local report_file="$PROJECT_DIR/logs/aws-mcp-diagnostic-$(date +%Y%m%d-%H%M%S).md"
    mkdir -p "$(dirname "$report_file")"
    
    cat > "$report_file" << EOF
# AWS MCP Servers Diagnostic Report

**Generated:** $(date -u "+%Y-%m-%d %H:%M:%S UTC")
**Host:** $(hostname)
**User:** $USER

## Environment Information

### System
- OS: $(uname -s) $(uname -r)
- Architecture: $(uname -m)
- Shell: $SHELL

### Prerequisites
- AWS CLI: $(aws --version 2>&1 || echo "Not installed")
- UV: $(uv --version 2>/dev/null || echo "Not installed") 
- Node.js: $(node --version 2>/dev/null || echo "Not installed")
- NPM: $(npm --version 2>/dev/null || echo "Not installed")

### AWS Configuration
- Region: ${AWS_REGION:-not set}
- Access Key: ${AWS_ACCESS_KEY_ID:+***${AWS_ACCESS_KEY_ID: -4}}
- Account ID: $(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "unknown")

## AWS MCP Servers Status

$(curl -s "$HUB_URL/api/servers" | jq -r '.servers[] | select(.name | startswith("aws")) | "- **\(.name)**: \(.status) - \(.description)"')

## Summary
- Total AWS Servers: ${AWS_SERVERS_TOTAL:-0}  
- Connected: ${AWS_SERVERS_CONNECTED:-0}
- Disconnected: ${AWS_SERVERS_DISCONNECTED:-0}

## Recommendations

$(if [[ ${AWS_SERVERS_DISCONNECTED:-0} -gt 0 ]]; then
    echo "### Fix Disconnected Servers"
    echo "1. Run the repair function: \`./scripts/aws-mcp-diagnostics.sh repair\`"
    echo "2. Check AWS credentials and permissions"
    echo "3. Verify network connectivity to AWS services"
fi)

### Next Steps
1. Monitor server status with: \`./scripts/aws-mcp-diagnostics.sh status\`
2. Test AWS operations with: \`./scripts/aws-mcp-diagnostics.sh test\`
3. View this report at: \`$report_file\`

---
**Report generated by AWS MCP Diagnostics Tool**
EOF

    log "INFO" "Diagnostic report saved to: $report_file"
    echo "$report_file"
}

# Main diagnostic function
run_diagnostics() {
    log "INFO" "Starting AWS MCP Servers Diagnostic..."
    echo "========================================"
    
    check_aws_prerequisites || {
        log "ERROR" "Prerequisites check failed"
        return 1
    }
    
    parse_aws_credentials || {
        log "ERROR" "Failed to parse AWS credentials"
        return 1
    }
    
    test_aws_credentials || {
        log "ERROR" "AWS credentials test failed"
        return 1
    }
    
    check_aws_permissions
    get_aws_server_statuses
    test_aws_servers
    
    local report_file
    report_file=$(generate_diagnostic_report)
    
    echo ""
    log "INFO" "Diagnostic completed successfully"
    log "INFO" "Full report available at: $report_file"
}

# Repair function
repair_aws_servers() {
    log "INFO" "Starting AWS MCP Servers Repair..."
    echo "==================================="
    
    run_diagnostics || {
        log "ERROR" "Diagnostic failed - cannot proceed with repair"
        return 1
    }
    
    if [[ ${AWS_SERVERS_DISCONNECTED:-0} -eq 0 ]]; then
        log "INFO" "All AWS servers are connected - no repair needed"
        return 0
    fi
    
    fix_configuration
    install_aws_packages
    restart_aws_servers
    
    # Re-check status after repair
    log "INFO" "Verifying repair results..."
    sleep 5
    get_aws_server_statuses
    
    if [[ ${AWS_SERVERS_DISCONNECTED:-0} -eq 0 ]]; then
        log "INFO" "🎉 All AWS servers successfully repaired and connected!"
    else
        log "WARN" "⚠️  Some AWS servers still disconnected (${AWS_SERVERS_DISCONNECTED} remaining)"
        echo "Check the diagnostic report for more details"
    fi
}

# Usage function
usage() {
    cat << EOF
AWS MCP Servers Diagnostic and Repair Tool

Usage: $0 <command>

Commands:
  diagnose    Run comprehensive AWS MCP diagnostics
  repair      Repair AWS MCP server connectivity issues
  status      Show current AWS MCP server status
  test        Test AWS credentials and permissions
  install     Install/update AWS MCP packages
  help        Show this help message

Examples:
  $0 diagnose       # Run full diagnostic
  $0 repair         # Fix connection issues
  $0 status         # Quick status check
  $0 test           # Test AWS connectivity

EOF
}

# Command routing
main() {
    local command="${1:-help}"
    
    case "$command" in
        diagnose|diagnostic)
            run_diagnostics
            ;;
        repair|fix)
            repair_aws_servers
            ;;
        status)
            parse_aws_credentials
            get_aws_server_statuses
            ;;
        test)
            parse_aws_credentials
            test_aws_credentials
            check_aws_permissions
            ;;
        install)
            install_aws_packages
            ;;
        help|--help|-h)
            usage
            ;;
        *)
            echo "Unknown command: $command"
            usage
            exit 1
            ;;
    esac
}

# Run main function if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi

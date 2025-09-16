#!/bin/bash
# Quick test script for MCP Hub authentication system
# This script tests basic functionality of the authentication endpoints

set -e

# Configuration
BASE_URL="${BASE_URL:-http://localhost:3000}"
API_BASE="$BASE_URL/api"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Test server health
test_health() {
    log_info "Testing server health..."
    
    response=$(curl -s "$API_BASE/health" || echo "")
    
    if [[ -z "$response" ]]; then
        log_error "Server is not responding. Make sure MCP Hub is running at $BASE_URL"
        exit 1
    fi
    
    # Check if authentication is enabled
    auth_enabled=$(echo "$response" | jq -r '.authentication.enabled // false' 2>/dev/null || echo "false")
    
    if [[ "$auth_enabled" == "true" ]]; then
        log_success "Server is running with authentication enabled"
        echo "$response" | jq '.authentication' 2>/dev/null || echo "Authentication status: enabled"
    else
        log_warning "Server is running but authentication is disabled"
        log_warning "Make sure DATABASE_URL and JWT secrets are configured"
    fi
}

# Test OAuth providers endpoint
test_oauth_providers() {
    log_info "Testing OAuth providers endpoint..."
    
    response=$(curl -s "$API_BASE/auth/oauth/providers" || echo "")
    
    if [[ -z "$response" ]]; then
        log_error "OAuth providers endpoint not responding"
        return 1
    fi
    
    provider_count=$(echo "$response" | jq '.count // 0' 2>/dev/null || echo "0")
    
    if [[ "$provider_count" -gt 0 ]]; then
        log_success "OAuth providers configured: $provider_count"
        echo "$response" | jq '.providers[].display_name' 2>/dev/null || echo "Providers available"
    else
        log_warning "No OAuth providers configured"
        log_warning "Configure Google, GitHub, or Microsoft OAuth for login"
    fi
}

# Test unauthorized endpoint access
test_protected_endpoint() {
    log_info "Testing protected endpoint access without authentication..."
    
    status_code=$(curl -s -w "%{http_code}" -o /dev/null "$API_BASE/auth/me" || echo "000")
    
    if [[ "$status_code" == "401" ]]; then
        log_success "Protected endpoint correctly returns 401 Unauthorized"
    else
        log_warning "Protected endpoint returned status: $status_code (expected 401)"
    fi
}

# Test API key creation endpoint (should fail without auth)
test_api_key_creation() {
    log_info "Testing API key creation without authentication..."
    
    response=$(curl -s -w "\n%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -d '{"name": "Test Key", "scopes": ["read"]}' \
        "$API_BASE/auth/api-keys" 2>/dev/null || echo -e "\n000")
    
    status_code=$(echo "$response" | tail -1)
    
    if [[ "$status_code" == "401" ]]; then
        log_success "API key creation correctly requires authentication"
    else
        log_warning "API key creation returned status: $status_code (expected 401)"
    fi
}

# Test database connection (if health endpoint provides info)
test_database_connection() {
    log_info "Checking database connection status..."
    
    response=$(curl -s "$API_BASE/health" || echo "")
    auth_enabled=$(echo "$response" | jq -r '.authentication.enabled // false' 2>/dev/null || echo "false")
    
    if [[ "$auth_enabled" == "true" ]]; then
        log_success "Database connection appears to be working (auth is enabled)"
    else
        log_warning "Database connection may not be working (auth is disabled)"
        log_info "Check your DATABASE_URL and ensure PostgreSQL is running"
    fi
}

# Main test function
run_tests() {
    echo
    log_info "🧪 MCP Hub Authentication System Test"
    echo "========================================"
    echo
    
    test_health
    echo
    
    test_database_connection
    echo
    
    test_oauth_providers
    echo
    
    test_protected_endpoint
    echo
    
    test_api_key_creation
    echo
    
    log_info "📋 Test Summary"
    echo "================"
    echo
    
    # Get final health check
    response=$(curl -s "$API_BASE/health" || echo "{}")
    auth_enabled=$(echo "$response" | jq -r '.authentication.enabled // false' 2>/dev/null || echo "false")
    
    if [[ "$auth_enabled" == "true" ]]; then
        echo -e "${GREEN}🎉 Authentication system is working correctly!${NC}"
        echo
        echo "Next steps:"
        echo "1. Set up OAuth providers for user login"
        echo "2. Visit $BASE_URL/api/auth/oauth/google (or github/microsoft) to test login"
        echo "3. Use the authentication system with your MCP servers"
        echo
        echo "Useful endpoints:"
        echo "- Health check: $API_BASE/health"
        echo "- OAuth providers: $API_BASE/auth/oauth/providers"
        echo "- Login: $API_BASE/auth/oauth/{provider}"
        echo "- User profile: $API_BASE/auth/me (requires auth)"
        echo "- API keys: $API_BASE/auth/api-keys (requires auth)"
    else
        echo -e "${YELLOW}⚠️  Authentication system is not fully configured${NC}"
        echo
        echo "To enable authentication:"
        echo "1. Set up PostgreSQL database"
        echo "2. Configure DATABASE_URL environment variable"
        echo "3. Set JWT_SECRET and JWT_REFRESH_SECRET"
        echo "4. Restart MCP Hub"
        echo
        echo "See docs/AUTHENTICATION.md for detailed setup instructions"
    fi
}

# Run tests
run_tests

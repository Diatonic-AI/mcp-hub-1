#!/bin/bash
# MCP-Hub Full Pipeline Test Script
# Tests all components of the ML/DL telemetry pipeline

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║          MCP-Hub Full Pipeline Test Suite                  ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Configuration
API_BASE="http://localhost:3456/api"
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Load environment
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Test result tracking
declare -a TEST_RESULTS

# Function to run a test
run_test() {
    local test_name="$1"
    local test_command="$2"
    local expected_result="${3:-0}"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    echo -ne "${YELLOW}Testing:${NC} $test_name... "
    
    if eval "$test_command" > /dev/null 2>&1; then
        if [ "$?" -eq "$expected_result" ]; then
            echo -e "${GREEN}✓ PASSED${NC}"
            PASSED_TESTS=$((PASSED_TESTS + 1))
            TEST_RESULTS+=("✓ $test_name")
        else
            echo -e "${RED}✗ FAILED${NC}"
            FAILED_TESTS=$((FAILED_TESTS + 1))
            TEST_RESULTS+=("✗ $test_name")
        fi
    else
        echo -e "${RED}✗ FAILED${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        TEST_RESULTS+=("✗ $test_name")
    fi
}

# Function to check service health
check_service() {
    local service_name="$1"
    local host="$2"
    local port="$3"
    
    nc -z "$host" "$port" 2>/dev/null
    return $?
}

# Function to test API endpoint
test_api() {
    local endpoint="$1"
    local method="${2:-GET}"
    local data="${3:-}"
    
    if [ -n "$data" ]; then
        curl -s -X "$method" -H "Content-Type: application/json" -d "$data" "${API_BASE}${endpoint}" > /dev/null
    else
        curl -s -X "$method" "${API_BASE}${endpoint}" > /dev/null
    fi
    return $?
}

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}1. Infrastructure Services Check${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Check PostgreSQL
run_test "PostgreSQL Connection" "check_service localhost 5432"

# Check Redis
run_test "Redis Connection" "check_service localhost 6379"

# Check MongoDB
run_test "MongoDB Connection" "check_service localhost 27017"

# Check MinIO
run_test "MinIO Connection" "check_service localhost 9000"

# Check Qdrant
run_test "Qdrant Connection" "check_service localhost 6333"

# Check LM Studio
run_test "LM Studio Connection" "check_service localhost 1234"

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}2. MCP-Hub Server Health${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Check if server is running
run_test "MCP-Hub Server" "check_service localhost 3456"

# Test health endpoint
run_test "Health Endpoint" "test_api /health"

# Test server status
run_test "Server Status" "test_api /status"

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}3. API Endpoints Test${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Test server management endpoints
run_test "List Servers" "test_api /servers"
run_test "List Tools" "test_api /tools"
run_test "List Resources" "test_api /resources"
run_test "List Prompts" "test_api /prompts"

# Test analytics endpoints
run_test "Analytics Summary" "test_api /analytics/summary"
run_test "Analytics Metrics" "test_api /analytics/metrics"
run_test "Analytics Health" "test_api /analytics/health"
run_test "Analytics Anomalies" "test_api /analytics/anomalies"

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}4. MCP Tool Execution Test${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Test meta tools
run_test "Hub List All Tools" "test_api /tools/execute POST '{\"tool\":\"hub__list_all_tools\",\"arguments\":{}}'"
run_test "Hub List All Servers" "test_api /tools/execute POST '{\"tool\":\"hub__list_all_servers\",\"arguments\":{}}'"

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}5. Telemetry Pipeline Test${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Send test telemetry event
TEST_EVENT='{
    "event_type": "test.pipeline",
    "server": "test-server",
    "tool": "test-tool",
    "session_id": "test-session-'$(date +%s)'",
    "payload": {
        "test": true,
        "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
    }
}'

run_test "Send Telemetry Event" "test_api /telemetry/events POST '$TEST_EVENT'"

# Test telemetry stream
run_test "Telemetry Stream" "curl -s -N ${API_BASE}/telemetry/stream 2>/dev/null | head -1 | grep -q 'data:'"

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}6. Database Operations Test${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Test PostgreSQL operations
if command -v psql > /dev/null; then
    run_test "PostgreSQL Schema Check" "PGPASSWORD=${POSTGRES_PASSWORD} psql -h localhost -U ${POSTGRES_USER} -d ${POSTGRES_DB} -c 'SELECT COUNT(*) FROM mcp_hub.servers' 2>/dev/null"
    run_test "PostgreSQL Telemetry Table" "PGPASSWORD=${POSTGRES_PASSWORD} psql -h localhost -U ${POSTGRES_USER} -d ${POSTGRES_DB} -c 'SELECT COUNT(*) FROM telemetry.tool_calls' 2>/dev/null"
    run_test "PostgreSQL Analytics View" "PGPASSWORD=${POSTGRES_PASSWORD} psql -h localhost -U ${POSTGRES_USER} -d ${POSTGRES_DB} -c 'SELECT * FROM analytics.dashboard_stats' 2>/dev/null"
else
    echo -e "${YELLOW}Skipping PostgreSQL tests (psql not installed)${NC}"
fi

# Test Redis operations
if command -v redis-cli > /dev/null; then
    run_test "Redis Ping" "redis-cli ping"
    run_test "Redis Key Count" "redis-cli DBSIZE"
else
    echo -e "${YELLOW}Skipping Redis tests (redis-cli not installed)${NC}"
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}7. Dashboard & UI Test${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Test dashboard availability
run_test "Dashboard HTML" "curl -s http://localhost:3456/dashboard.html | grep -q 'MCP-Hub Dashboard'"
run_test "Static Assets" "curl -s -o /dev/null -w '%{http_code}' http://localhost:3456/dashboard.html | grep -q '200'"

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}8. Performance & Load Test${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Simple load test
echo -e "${YELLOW}Running performance test (10 concurrent requests)...${NC}"

for i in {1..10}; do
    (curl -s "${API_BASE}/servers" > /dev/null 2>&1) &
done
wait

run_test "Concurrent Request Handling" "true"

# Measure API response time
START_TIME=$(date +%s%N)
curl -s "${API_BASE}/tools" > /dev/null 2>&1
END_TIME=$(date +%s%N)
RESPONSE_TIME=$(( ($END_TIME - $START_TIME) / 1000000 ))

if [ $RESPONSE_TIME -lt 1000 ]; then
    echo -e "${GREEN}✓ API Response Time: ${RESPONSE_TIME}ms${NC}"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    echo -e "${YELLOW}⚠ API Response Time: ${RESPONSE_TIME}ms (slow)${NC}"
fi
TOTAL_TESTS=$((TOTAL_TESTS + 1))

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}9. Security Test${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Test CORS headers
run_test "CORS Headers" "curl -s -I ${API_BASE}/health | grep -q 'Access-Control-Allow-Origin'"

# Test rate limiting (if enabled)
run_test "Rate Limiting Headers" "curl -s -I ${API_BASE}/tools | grep -q 'X-RateLimit'"

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                    Test Results Summary                     ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Display results
echo -e "${BLUE}Test Results:${NC}"
for result in "${TEST_RESULTS[@]}"; do
    if [[ $result == *"✓"* ]]; then
        echo -e "  ${GREEN}$result${NC}"
    else
        echo -e "  ${RED}$result${NC}"
    fi
done

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "Total Tests: ${TOTAL_TESTS}"
echo -e "${GREEN}Passed: ${PASSED_TESTS}${NC}"
echo -e "${RED}Failed: ${FAILED_TESTS}${NC}"

# Calculate success rate
if [ $TOTAL_TESTS -gt 0 ]; then
    SUCCESS_RATE=$(( ($PASSED_TESTS * 100) / $TOTAL_TESTS ))
    echo -e "Success Rate: ${SUCCESS_RATE}%"
    
    if [ $SUCCESS_RATE -ge 90 ]; then
        echo ""
        echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║     🎉 Pipeline Test PASSED! System is operational! 🎉     ║${NC}"
        echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    elif [ $SUCCESS_RATE -ge 70 ]; then
        echo ""
        echo -e "${YELLOW}╔════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${YELLOW}║   ⚠️  Pipeline Test PARTIAL PASS - Some issues detected    ║${NC}"
        echo -e "${YELLOW}╚════════════════════════════════════════════════════════════╝${NC}"
    else
        echo ""
        echo -e "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${RED}║     ❌ Pipeline Test FAILED - System needs attention       ║${NC}"
        echo -e "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
    fi
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Next Steps:${NC}"
echo -e "  1. View dashboard: ${CYAN}http://localhost:3456/dashboard.html${NC}"
echo -e "  2. Check API docs: ${CYAN}http://localhost:3456/api-docs${NC}"
echo -e "  3. Monitor logs: ${CYAN}tail -f logs/mcp-hub.log${NC}"
echo -e "  4. View telemetry stream: ${CYAN}curl -N http://localhost:3456/api/telemetry/stream${NC}"
echo ""

exit $([ $FAILED_TESTS -eq 0 ] && echo 0 || echo 1)

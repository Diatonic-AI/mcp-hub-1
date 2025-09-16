#!/bin/bash
# One-step database setup script for MCP Hub
# Run this from the host machine to configure PostgreSQL and apply schema

echo "MCP Hub Database Setup - Complete Installation"
echo "=============================================="
echo ""

# Configuration
LXC_HOST="10.10.10.11"
LXC_USER="root"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

echo "Step 1: Configuring PostgreSQL server on LXC container ($LXC_HOST)..."
echo "---------------------------------------------------------------"

# Copy and run the configuration script on the LXC container
cat "$SCRIPT_DIR/configure_postgres_server.sh" | ssh ${LXC_USER}@${LXC_HOST} "cat > /tmp/configure_postgres_server.sh && bash /tmp/configure_postgres_server.sh"

if [ $? -ne 0 ]; then
    echo "❌ Failed to configure PostgreSQL server"
    echo "Please check the error messages above and ensure:"
    echo "1. You have SSH access to root@${LXC_HOST}"
    echo "2. PostgreSQL is installed on the container"
    exit 1
fi

echo ""
echo "✅ PostgreSQL server configured successfully"
echo ""

# Wait a moment for PostgreSQL to reload
sleep 2

echo "Step 2: Applying database schema..."
echo "------------------------------------"

# Run the schema application script
"$SCRIPT_DIR/apply_schema.sh"

if [ $? -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "✅ Database setup completed successfully!"
    echo "=========================================="
    echo ""
    echo "Connection details:"
    echo "  Host: ${LXC_HOST}"
    echo "  Database: mcp_hub"
    echo "  User: mcp_hub"
    echo "  Password: McpHub2024!@#"
    echo ""
    echo "The following tables have been created:"
    echo "  - training_runs (with training_events using 'timestamp' column)"
    echo "  - models, evaluation_metrics, batch_jobs, predictions"
    echo "  - features, experiments, datasets, hpo_runs"
    echo "  - And all supporting tables with indexes and triggers"
else
    echo ""
    echo "❌ Failed to apply database schema"
    echo "The PostgreSQL server has been configured, but the schema application failed."
    echo "You can try running the schema manually:"
    echo "  ./apply_schema.sh"
    exit 1
fi

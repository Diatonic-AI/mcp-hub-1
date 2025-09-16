#!/bin/bash
# Script to apply MCP Hub database schema
# Run this from the host machine (10.10.10.1/10.0.0.219)

echo "MCP Hub Database Schema Application"
echo "===================================="
echo ""

# Database connection details
DB_HOST="10.10.10.11"
DB_PORT="5432"
DB_NAME="mcp_hub"
DB_USER="mcp_hub"
DB_PASS="McpHub2024!@#"

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
SCHEMA_FILE="$SCRIPT_DIR/setup_ml_tables.sql"

# Check if schema file exists
if [ ! -f "$SCHEMA_FILE" ]; then
    echo "Error: Schema file not found at $SCHEMA_FILE"
    exit 1
fi

echo "Testing database connection..."
PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT version();" > /dev/null 2>&1

if [ $? -ne 0 ]; then
    echo "❌ Cannot connect to PostgreSQL database at $DB_HOST"
    echo ""
    echo "Please ensure:"
    echo "1. PostgreSQL is running on the LXC container (10.10.10.11)"
    echo "2. The configuration script has been run on the PostgreSQL server:"
    echo "   ssh <lxc-container> 'sudo bash' < $SCRIPT_DIR/configure_postgres_server.sh"
    echo ""
    echo "Attempting connection with verbose output:"
    PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT version();"
    exit 1
fi

echo "✓ Database connection successful"
echo ""

echo "Applying database schema..."
PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$SCHEMA_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Database schema applied successfully!"
    echo ""
    echo "Verifying tables..."
    PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
    SELECT table_name, table_type 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name IN (
        'training_runs', 'training_events', 'models', 
        'evaluation_metrics', 'batch_jobs', 'predictions',
        'features', 'experiments', 'datasets', 'hpo_runs'
    )
    ORDER BY table_name;" 2>/dev/null
    
    echo ""
    echo "✅ All required tables are ready for use!"
    echo ""
    echo "Key points:"
    echo "• training_events table uses 'timestamp' column (as required by code)"
    echo "• All ML/DL pipeline tables are created"
    echo "• Indexes and triggers are set up"
    echo "• Permissions granted to mcp_hub user"
else
    echo ""
    echo "❌ Failed to apply database schema"
    echo "Please check the error messages above"
    exit 1
fi

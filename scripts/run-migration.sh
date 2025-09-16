#!/bin/bash
# MCP-Hub PostgreSQL Migration Runner
# Runs database migrations for MCP-Hub telemetry and analytics

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}==================================================${NC}"
echo -e "${BLUE}MCP-Hub PostgreSQL Migration Runner${NC}"
echo -e "${BLUE}==================================================${NC}"

# Load environment variables
if [ -f .env ]; then
    echo -e "${GREEN}Loading environment variables from .env${NC}"
    export $(cat .env | grep -v '^#' | xargs)
else
    echo -e "${YELLOW}Warning: .env file not found, using defaults${NC}"
fi

# Database configuration with defaults
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-mcp_hub}"
DB_USER="${POSTGRES_USER:-mcp_hub_app}"
DB_PASSWORD="${POSTGRES_PASSWORD:-mcp_hub_secure_password}"

# Check if running in Docker or native
if [ -f /.dockerenv ]; then
    echo -e "${BLUE}Running in Docker container${NC}"
    DB_HOST="${POSTGRES_HOST:-postgres}"
fi

echo -e "${BLUE}Database Configuration:${NC}"
echo "  Host: $DB_HOST"
echo "  Port: $DB_PORT"
echo "  Database: $DB_NAME"
echo "  User: $DB_USER"

# Function to check PostgreSQL connection
check_postgres() {
    echo -e "${YELLOW}Checking PostgreSQL connection...${NC}"
    
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c '\q' 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ PostgreSQL connection successful${NC}"
        return 0
    else
        echo -e "${RED}✗ Cannot connect to PostgreSQL${NC}"
        return 1
    fi
}

# Function to create database if it doesn't exist
create_database() {
    echo -e "${YELLOW}Checking if database exists...${NC}"
    
    DB_EXISTS=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null)
    
    if [ "$DB_EXISTS" = "1" ]; then
        echo -e "${GREEN}✓ Database '$DB_NAME' already exists${NC}"
    else
        echo -e "${YELLOW}Creating database '$DB_NAME'...${NC}"
        PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "CREATE DATABASE $DB_NAME" 2>/dev/null
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓ Database created successfully${NC}"
        else
            echo -e "${RED}✗ Failed to create database${NC}"
            exit 1
        fi
    fi
}

# Function to run migrations
run_migrations() {
    echo -e "${YELLOW}Running migrations...${NC}"
    
    MIGRATION_DIR="$(dirname "$0")/../migrations"
    
    if [ ! -d "$MIGRATION_DIR" ]; then
        echo -e "${RED}✗ Migration directory not found: $MIGRATION_DIR${NC}"
        exit 1
    fi
    
    # Find all SQL migration files
    MIGRATIONS=$(find "$MIGRATION_DIR" -name "*.sql" | sort)
    
    if [ -z "$MIGRATIONS" ]; then
        echo -e "${YELLOW}No migration files found${NC}"
        return
    fi
    
    for MIGRATION in $MIGRATIONS; do
        MIGRATION_NAME=$(basename "$MIGRATION")
        echo -e "${BLUE}Running migration: $MIGRATION_NAME${NC}"
        
        PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "$MIGRATION"
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓ Migration completed: $MIGRATION_NAME${NC}"
        else
            echo -e "${RED}✗ Migration failed: $MIGRATION_NAME${NC}"
            exit 1
        fi
    done
}

# Function to verify migration
verify_migration() {
    echo -e "${YELLOW}Verifying migration...${NC}"
    
    # Check schemas
    SCHEMAS=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -tAc "SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('mcp_hub', 'telemetry', 'analytics')" 2>/dev/null | wc -l)
    
    if [ "$SCHEMAS" -eq "3" ]; then
        echo -e "${GREEN}✓ All schemas created successfully${NC}"
    else
        echo -e "${RED}✗ Some schemas are missing${NC}"
        exit 1
    fi
    
    # Check main tables
    TABLES=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema IN ('mcp_hub', 'telemetry', 'analytics')" 2>/dev/null)
    
    echo -e "${GREEN}✓ Created $TABLES tables${NC}"
    
    # Check views
    VIEWS=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -tAc "SELECT COUNT(*) FROM information_schema.views WHERE table_schema = 'analytics'" 2>/dev/null)
    
    echo -e "${GREEN}✓ Created $VIEWS views${NC}"
    
    # Display summary
    echo -e "${BLUE}==================================================${NC}"
    echo -e "${GREEN}Migration Summary:${NC}"
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "
    SELECT 
        table_schema as schema,
        COUNT(*) as table_count
    FROM information_schema.tables 
    WHERE table_schema IN ('mcp_hub', 'telemetry', 'analytics')
    GROUP BY table_schema
    ORDER BY table_schema;"
}

# Main execution
main() {
    echo -e "${YELLOW}Starting PostgreSQL migration process...${NC}"
    echo ""
    
    # Wait for PostgreSQL to be ready (useful in Docker)
    MAX_RETRIES=30
    RETRY_COUNT=0
    
    while ! check_postgres; do
        RETRY_COUNT=$((RETRY_COUNT + 1))
        if [ $RETRY_COUNT -gt $MAX_RETRIES ]; then
            echo -e "${RED}✗ PostgreSQL is not available after $MAX_RETRIES attempts${NC}"
            exit 1
        fi
        echo -e "${YELLOW}Waiting for PostgreSQL to be ready... (attempt $RETRY_COUNT/$MAX_RETRIES)${NC}"
        sleep 2
    done
    
    # Create database if needed
    create_database
    
    # Run migrations
    run_migrations
    
    # Verify migration
    verify_migration
    
    echo ""
    echo -e "${GREEN}==================================================${NC}"
    echo -e "${GREEN}✓ Migration completed successfully!${NC}"
    echo -e "${GREEN}==================================================${NC}"
    echo ""
    echo -e "${BLUE}Database is ready for use:${NC}"
    echo "  Connection string: postgresql://$DB_USER:****@$DB_HOST:$DB_PORT/$DB_NAME"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo "  1. Start the MCP-Hub server: npm start"
    echo "  2. Access the dashboard: http://localhost:3456/dashboard.html"
    echo "  3. View API docs: http://localhost:3456/api-docs"
}

# Run main function
main

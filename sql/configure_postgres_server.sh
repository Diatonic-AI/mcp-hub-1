#!/bin/bash
# Script to configure PostgreSQL server for MCP Hub
# This script needs to be run on the PostgreSQL server (10.10.10.11)

echo "PostgreSQL Server Configuration for MCP Hub"
echo "==========================================="
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root" 
   exit 1
fi

# PostgreSQL version (adjust if different)
PG_VERSION=16

# PostgreSQL configuration directory
PG_CONFIG_DIR="/etc/postgresql/$PG_VERSION/main"

# Backup existing configuration
echo "Backing up existing configuration..."
cp $PG_CONFIG_DIR/pg_hba.conf $PG_CONFIG_DIR/pg_hba.conf.backup.$(date +%Y%m%d_%H%M%S)
cp $PG_CONFIG_DIR/postgresql.conf $PG_CONFIG_DIR/postgresql.conf.backup.$(date +%Y%m%d_%H%M%S)

echo "Adding MCP Hub access rules to pg_hba.conf..."

# Check if the rule already exists
if ! grep -q "10.10.10.1/32.*mcp_hub" $PG_CONFIG_DIR/pg_hba.conf; then
    # Add rule for mcp_hub user from host machine (10.10.10.1 - dbnet0 bridge)
    echo "" >> $PG_CONFIG_DIR/pg_hba.conf
    echo "# MCP Hub access from host development machine" >> $PG_CONFIG_DIR/pg_hba.conf
    echo "host    mcp_hub         mcp_hub         10.10.10.1/32           md5" >> $PG_CONFIG_DIR/pg_hba.conf
    echo "host    all             mcp_hub         10.10.10.1/32           md5" >> $PG_CONFIG_DIR/pg_hba.conf
    echo "# Also allow from main host IP" >> $PG_CONFIG_DIR/pg_hba.conf
    echo "host    mcp_hub         mcp_hub         10.0.0.219/32          md5" >> $PG_CONFIG_DIR/pg_hba.conf
    echo "host    all             mcp_hub         10.0.0.219/32          md5" >> $PG_CONFIG_DIR/pg_hba.conf
    echo "✓ Added pg_hba.conf rules for MCP Hub"
else
    echo "✓ pg_hba.conf rules already exist"
fi

# Ensure PostgreSQL is listening on the correct interface
echo "Checking PostgreSQL listen addresses..."
if ! grep -q "^listen_addresses.*'\*'\|10.10.10.11" $PG_CONFIG_DIR/postgresql.conf; then
    # Update listen_addresses to listen on all interfaces (or specific ones)
    sed -i "s/^#*listen_addresses.*/listen_addresses = '*'/" $PG_CONFIG_DIR/postgresql.conf
    echo "✓ Updated listen_addresses in postgresql.conf to listen on all interfaces"
else
    echo "✓ listen_addresses already configured"
fi

# Reload PostgreSQL configuration
echo "Reloading PostgreSQL configuration..."
systemctl reload postgresql

echo ""
echo "Creating database and user if they don't exist..."

# Create database and user
su - postgres -c "psql" <<EOF
-- Create user if not exists
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_user WHERE usename = 'mcp_hub') THEN
        CREATE USER mcp_hub WITH PASSWORD 'McpHub2024!@#';
    END IF;
END
\$\$;

-- Create database if not exists
SELECT 'CREATE DATABASE mcp_hub OWNER mcp_hub'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'mcp_hub')\gexec

-- Grant all privileges
GRANT ALL PRIVILEGES ON DATABASE mcp_hub TO mcp_hub;

-- Connect to mcp_hub database and grant schema privileges
\c mcp_hub
GRANT ALL ON SCHEMA public TO mcp_hub;
GRANT CREATE ON SCHEMA public TO mcp_hub;
EOF

echo ""
echo "Testing connection from current host..."
PGPASSWORD='McpHub2024!@#' psql -h localhost -U mcp_hub -d mcp_hub -c "SELECT version();" && echo "✓ Local connection successful"

echo ""
echo "Configuration complete!"
echo ""
echo "To apply the database schema, run from the development machine (10.10.10.1):"
echo "  PGPASSWORD='McpHub2024!@#' psql -h 10.10.10.11 -U mcp_hub -d mcp_hub -f /home/daclab-ai/dev/mcp-hub/sql/setup_ml_tables.sql"
echo ""
echo "To test the connection from the development machine:"
echo "  PGPASSWORD='McpHub2024!@#' psql -h 10.10.10.11 -U mcp_hub -d mcp_hub -c 'SELECT version();'"

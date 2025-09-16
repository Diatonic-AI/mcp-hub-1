-- Create MCP Hub schema and grant permissions
-- This script runs as the postgres superuser during database initialization

-- Note: The full schema will be created by the application on startup
-- This just sets up the basic structure and permissions

-- Create schema
CREATE SCHEMA IF NOT EXISTS mcp_hub;

-- Grant schema usage to application user
GRANT USAGE ON SCHEMA mcp_hub TO mcp_hub_app;

-- Grant table permissions (for current and future tables)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA mcp_hub TO mcp_hub_app;
GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA mcp_hub TO mcp_hub_app;

-- Grant permissions to future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA mcp_hub 
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mcp_hub_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA mcp_hub 
    GRANT SELECT, USAGE ON SEQUENCES TO mcp_hub_app;

-- Create extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Log completion
DO $$ 
BEGIN 
    RAISE NOTICE 'Schema setup completed. Application will create full schema on startup.';
END $$;

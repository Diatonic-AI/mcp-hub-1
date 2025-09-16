-- Create MCP Hub application user
-- This script runs as the postgres superuser during database initialization

DO $$
BEGIN
    -- Create the application user if it doesn't exist
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'mcp_hub_app') THEN
        CREATE ROLE mcp_hub_app WITH 
            LOGIN 
            PASSWORD 'mcp_hub_secure_password'
            NOSUPERUSER 
            NOCREATEDB 
            NOCREATEROLE;
        
        RAISE NOTICE 'Created user: mcp_hub_app';
    ELSE
        RAISE NOTICE 'User mcp_hub_app already exists';
    END IF;
    
    -- Grant connection privileges
    GRANT CONNECT ON DATABASE mcp_hub TO mcp_hub_app;
    
    RAISE NOTICE 'User setup completed';
END
$$;

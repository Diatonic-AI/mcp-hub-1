-- MCP Hub Comprehensive Database Schema
-- Designed for multi-tenant tracking of MCP hub servers, tools, executions, and metrics

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "timescaledb" CASCADE;

-- Create dedicated schema for MCP Hub
CREATE SCHEMA IF NOT EXISTS mcp_hub;

-- Set default search path
SET search_path TO mcp_hub, public;

-- =============================================================================
-- ENUM TYPES
-- =============================================================================

-- Hub instance states
CREATE TYPE hub_state_enum AS ENUM (
    'STARTING', 'READY', 'RESTARTING', 'RESTARTED', 
    'STOPPING', 'STOPPED', 'ERROR'
);

-- MCP connection states  
CREATE TYPE connection_state_enum AS ENUM (
    'CONNECTED', 'CONNECTING', 'DISCONNECTED', 
    'UNAUTHORIZED', 'DISABLED'
);

-- Transport types
CREATE TYPE transport_type_enum AS ENUM (
    'stdio', 'sse', 'http', 'streamableHttp'
);

-- Event types
CREATE TYPE event_type_enum AS ENUM (
    'heartbeat', 'hub_state', 'log', 'subscription_event',
    'config_changed', 'servers_updating', 'servers_updated',
    'tool_list_changed', 'resource_list_changed', 'prompt_list_changed',
    'workspaces_updated', 'server_connected', 'server_disconnected'
);

-- Log levels
CREATE TYPE log_level_enum AS ENUM (
    'error', 'warn', 'info', 'debug'
);

-- OAuth flow status
CREATE TYPE oauth_status_enum AS ENUM (
    'initiated', 'pending', 'completed', 'failed', 'expired'
);

-- Tool execution status
CREATE TYPE execution_status_enum AS ENUM (
    'started', 'running', 'completed', 'failed', 'timeout', 'cancelled'
);

-- =============================================================================
-- CORE TENANT AND HUB TABLES
-- =============================================================================

-- Tenants table for multi-tenancy
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN DEFAULT TRUE
);

-- MCP Hub instances 
CREATE TABLE hub_instances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    instance_name VARCHAR(255) NOT NULL,
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL,
    pid INTEGER,
    version VARCHAR(50),
    config_path TEXT,
    hub_server_url TEXT,
    state hub_state_enum DEFAULT 'STARTING',
    hub_options JSONB DEFAULT '{}', -- metaOnly, lazyLoad, idleTimeoutMs
    started_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_state_change TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    shutdown_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    
    UNIQUE(tenant_id, host, port)
);

-- MCP Servers connected to hub instances
CREATE TABLE mcp_servers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hub_instance_id UUID NOT NULL REFERENCES hub_instances(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    description TEXT,
    transport_type transport_type_enum NOT NULL,
    connection_state connection_state_enum DEFAULT 'DISCONNECTED',
    endpoint TEXT,
    config JSONB NOT NULL DEFAULT '{}',
    resolved_config JSONB DEFAULT '{}',
    server_info JSONB DEFAULT '{}', -- name, version from server
    error_message TEXT,
    disabled BOOLEAN DEFAULT FALSE,
    
    -- Connection timing
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_started TIMESTAMPTZ,
    last_connected TIMESTAMPTZ,
    last_disconnected TIMESTAMPTZ,
    connection_attempts INTEGER DEFAULT 0,
    total_uptime_seconds INTEGER DEFAULT 0,
    
    -- Capabilities count
    tools_count INTEGER DEFAULT 0,
    resources_count INTEGER DEFAULT 0,
    prompts_count INTEGER DEFAULT 0,
    resource_templates_count INTEGER DEFAULT 0,
    
    metadata JSONB DEFAULT '{}',
    
    UNIQUE(hub_instance_id, name)
);

-- =============================================================================
-- TOOLS AND CAPABILITIES
-- =============================================================================

-- MCP Tools registry
CREATE TABLE mcp_tools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    namespaced_name VARCHAR(255) NOT NULL, -- server__tool format
    description TEXT,
    input_schema JSONB DEFAULT '{}',
    output_schema JSONB DEFAULT '{}',
    category VARCHAR(100) DEFAULT 'general',
    
    -- Usage statistics
    registered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMPTZ,
    usage_count BIGINT DEFAULT 0,
    success_count BIGINT DEFAULT 0,
    error_count BIGINT DEFAULT 0,
    total_execution_time_ms BIGINT DEFAULT 0,
    avg_execution_time_ms DECIMAL(10,2),
    
    metadata JSONB DEFAULT '{}',
    
    UNIQUE(server_id, original_name)
);

-- MCP Resources
CREATE TABLE mcp_resources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    uri TEXT NOT NULL,
    mime_type VARCHAR(100),
    description TEXT,
    
    registered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_accessed_at TIMESTAMPTZ,
    access_count BIGINT DEFAULT 0,
    
    metadata JSONB DEFAULT '{}',
    
    UNIQUE(server_id, uri)
);

-- MCP Resource Templates
CREATE TABLE mcp_resource_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    uri_template TEXT NOT NULL,
    description TEXT,
    
    registered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    
    UNIQUE(server_id, uri_template)
);

-- MCP Prompts
CREATE TABLE mcp_prompts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    arguments JSONB DEFAULT '[]',
    
    registered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMPTZ,
    usage_count BIGINT DEFAULT 0,
    
    metadata JSONB DEFAULT '{}',
    
    UNIQUE(server_id, name)
);

-- =============================================================================
-- EXECUTION TRACKING
-- =============================================================================

-- Tool executions with detailed tracking
CREATE TABLE tool_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tool_id UUID NOT NULL REFERENCES mcp_tools(id) ON DELETE CASCADE,
    server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    hub_instance_id UUID NOT NULL REFERENCES hub_instances(id) ON DELETE CASCADE,
    
    -- Execution context
    execution_id VARCHAR(255), -- For tracing related executions
    session_id UUID,
    correlation_id UUID, -- For chaining tools
    parent_execution_id UUID REFERENCES tool_executions(id),
    
    -- Request details
    tool_name VARCHAR(255) NOT NULL,
    arguments JSONB DEFAULT '{}',
    status execution_status_enum DEFAULT 'started',
    
    -- Timing
    started_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    execution_time_ms INTEGER,
    
    -- Results
    result JSONB,
    error_message TEXT,
    error_code VARCHAR(100),
    error_details JSONB DEFAULT '{}',
    
    -- Resource usage
    memory_usage_mb INTEGER,
    cpu_time_ms INTEGER,
    
    metadata JSONB DEFAULT '{}'
);

-- Convert to hypertable for time-series data
SELECT create_hypertable('tool_executions', 'started_at', 
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- =============================================================================
-- EVENT STREAMING AND LOGS
-- =============================================================================

-- SSE Events and notifications
CREATE TABLE sse_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hub_instance_id UUID NOT NULL REFERENCES hub_instances(id) ON DELETE CASCADE,
    
    event_type event_type_enum NOT NULL,
    event_data JSONB DEFAULT '{}',
    
    -- Connection context
    connection_id UUID,
    client_count INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
);

-- Convert to hypertable
SELECT create_hypertable('sse_events', 'created_at',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Structured log entries
CREATE TABLE log_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hub_instance_id UUID REFERENCES hub_instances(id) ON DELETE CASCADE,
    server_id UUID REFERENCES mcp_servers(id) ON DELETE CASCADE,
    
    level log_level_enum NOT NULL,
    message TEXT NOT NULL,
    code VARCHAR(100),
    data JSONB DEFAULT '{}',
    stack_trace TEXT,
    
    -- Context
    source VARCHAR(100), -- 'hub', 'server', 'connection', 'tool'
    component VARCHAR(100),
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
);

-- Convert to hypertable
SELECT create_hypertable('log_entries', 'created_at',
    chunk_time_interval => INTERVAL '1 day', 
    if_not_exists => TRUE
);

-- =============================================================================
-- OAUTH AND AUTHENTICATION
-- =============================================================================

-- OAuth flows tracking
CREATE TABLE oauth_flows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    
    provider VARCHAR(100) NOT NULL, -- 'wix', 'google', 'github', etc.
    flow_type VARCHAR(50) DEFAULT 'authorization_code',
    
    -- OAuth parameters
    client_id VARCHAR(255),
    redirect_uri TEXT,
    state VARCHAR(255),
    code_verifier VARCHAR(255),
    code_challenge VARCHAR(255),
    scope VARCHAR(500),
    
    -- Flow status
    status oauth_status_enum DEFAULT 'initiated',
    authorization_url TEXT,
    authorization_code VARCHAR(500),
    
    -- Tokens (encrypted or hashed)
    access_token_hash VARCHAR(255),
    refresh_token_hash VARCHAR(255), 
    token_expires_at TIMESTAMPTZ,
    
    -- Timing
    initiated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    authorized_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    
    -- Results
    error_message TEXT,
    user_info JSONB DEFAULT '{}',
    
    metadata JSONB DEFAULT '{}'
);

-- =============================================================================
-- API ENDPOINT TRACKING
-- =============================================================================

-- REST API calls tracking
CREATE TABLE api_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hub_instance_id UUID NOT NULL REFERENCES hub_instances(id) ON DELETE CASCADE,
    
    -- Request details
    method VARCHAR(10) NOT NULL,
    path TEXT NOT NULL,
    full_url TEXT,
    query_params JSONB DEFAULT '{}',
    headers JSONB DEFAULT '{}',
    body JSONB,
    
    -- Response details
    status_code INTEGER,
    response_headers JSONB DEFAULT '{}',
    response_body JSONB,
    response_size_bytes INTEGER,
    
    -- Timing
    started_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    
    -- Client info
    client_ip INET,
    user_agent TEXT,
    session_id UUID,
    
    -- Errors
    error_message TEXT,
    
    metadata JSONB DEFAULT '{}'
);

-- Convert to hypertable  
SELECT create_hypertable('api_requests', 'started_at',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- =============================================================================
-- DOCKER AND INFRASTRUCTURE METRICS
-- =============================================================================

-- Docker container metrics
CREATE TABLE docker_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hub_instance_id UUID REFERENCES hub_instances(id) ON DELETE CASCADE,
    
    container_id VARCHAR(255) NOT NULL,
    container_name VARCHAR(255),
    image_name VARCHAR(255),
    
    -- Resource usage
    cpu_usage_percent DECIMAL(5,2),
    memory_usage_mb INTEGER,
    memory_limit_mb INTEGER,
    memory_usage_percent DECIMAL(5,2),
    
    -- Network
    network_rx_bytes BIGINT,
    network_tx_bytes BIGINT,
    network_rx_packets BIGINT,
    network_tx_packets BIGINT,
    
    -- Storage
    disk_read_bytes BIGINT,
    disk_write_bytes BIGINT,
    disk_usage_bytes BIGINT,
    
    -- Container state
    status VARCHAR(50), -- running, stopped, restarting
    restart_count INTEGER DEFAULT 0,
    uptime_seconds INTEGER,
    
    collected_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
);

-- Convert to hypertable
SELECT create_hypertable('docker_metrics', 'collected_at',
    chunk_time_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

-- System-level metrics
CREATE TABLE system_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hub_instance_id UUID REFERENCES hub_instances(id) ON DELETE CASCADE,
    
    -- System load
    load_1min DECIMAL(5,2),
    load_5min DECIMAL(5,2), 
    load_15min DECIMAL(5,2),
    
    -- CPU
    cpu_count INTEGER,
    cpu_usage_percent DECIMAL(5,2),
    
    -- Memory
    total_memory_mb INTEGER,
    free_memory_mb INTEGER,
    used_memory_mb INTEGER,
    cached_memory_mb INTEGER,
    
    -- Disk
    disk_total_gb INTEGER,
    disk_free_gb INTEGER,
    disk_used_gb INTEGER,
    
    -- Network
    network_connections INTEGER,
    
    collected_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
);

-- Convert to hypertable
SELECT create_hypertable('system_metrics', 'collected_at',
    chunk_time_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

-- =============================================================================
-- REAL-TIME PERFORMANCE METRICS
-- =============================================================================

-- Hub performance metrics
CREATE TABLE hub_performance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hub_instance_id UUID NOT NULL REFERENCES hub_instances(id) ON DELETE CASCADE,
    
    -- Connection metrics
    active_connections INTEGER DEFAULT 0,
    total_servers INTEGER DEFAULT 0,
    connected_servers INTEGER DEFAULT 0,
    
    -- Tool metrics  
    total_tools INTEGER DEFAULT 0,
    tools_executed_per_minute INTEGER DEFAULT 0,
    avg_tool_execution_time_ms DECIMAL(10,2),
    
    -- Error rates
    error_rate_percent DECIMAL(5,2) DEFAULT 0,
    connection_error_rate_percent DECIMAL(5,2) DEFAULT 0,
    
    -- SSE metrics
    sse_connections INTEGER DEFAULT 0,
    events_broadcasted_per_minute INTEGER DEFAULT 0,
    
    -- Memory usage
    node_memory_usage_mb INTEGER,
    heap_used_mb INTEGER,
    heap_total_mb INTEGER,
    
    collected_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
);

-- Convert to hypertable
SELECT create_hypertable('hub_performance', 'collected_at',
    chunk_time_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

-- =============================================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================================

-- Hub instances indexes
CREATE INDEX idx_hub_instances_tenant_state ON hub_instances(tenant_id, state);
CREATE INDEX idx_hub_instances_host_port ON hub_instances(host, port);

-- MCP servers indexes  
CREATE INDEX idx_mcp_servers_hub_state ON mcp_servers(hub_instance_id, connection_state);
CREATE INDEX idx_mcp_servers_transport ON mcp_servers(transport_type, connection_state);
CREATE INDEX idx_mcp_servers_last_connected ON mcp_servers(last_connected DESC);

-- Tools indexes
CREATE INDEX idx_mcp_tools_server_name ON mcp_tools(server_id, namespaced_name);
CREATE INDEX idx_mcp_tools_category ON mcp_tools(category);
CREATE INDEX idx_mcp_tools_usage ON mcp_tools(usage_count DESC, last_used_at DESC);

-- Tool executions indexes (TimescaleDB automatically creates time-based indexes)
CREATE INDEX idx_tool_executions_tool_status ON tool_executions(tool_id, status);
CREATE INDEX idx_tool_executions_correlation ON tool_executions(correlation_id);
CREATE INDEX idx_tool_executions_session ON tool_executions(session_id);

-- Events indexes
CREATE INDEX idx_sse_events_type_time ON sse_events(event_type, created_at DESC);
CREATE INDEX idx_log_entries_level_time ON log_entries(level, created_at DESC);
CREATE INDEX idx_log_entries_source_component ON log_entries(source, component);

-- API requests indexes
CREATE INDEX idx_api_requests_method_path ON api_requests(method, path);
CREATE INDEX idx_api_requests_status ON api_requests(status_code, started_at DESC);

-- OAuth flows indexes
CREATE INDEX idx_oauth_flows_server_status ON oauth_flows(server_id, status);
CREATE INDEX idx_oauth_flows_provider ON oauth_flows(provider, initiated_at DESC);

-- =============================================================================
-- FUNCTIONS AND TRIGGERS
-- =============================================================================

-- Function to update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add updated_at triggers
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate average execution time for tools
CREATE OR REPLACE FUNCTION update_tool_avg_execution_time()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status = 'completed' AND NEW.execution_time_ms IS NOT NULL THEN
        UPDATE mcp_tools 
        SET 
            usage_count = usage_count + 1,
            last_used_at = NEW.completed_at,
            total_execution_time_ms = total_execution_time_ms + NEW.execution_time_ms,
            avg_execution_time_ms = (total_execution_time_ms + NEW.execution_time_ms)::decimal / (usage_count + 1),
            success_count = CASE WHEN NEW.error_message IS NULL THEN success_count + 1 ELSE success_count END,
            error_count = CASE WHEN NEW.error_message IS NOT NULL THEN error_count + 1 ELSE error_count END
        WHERE id = NEW.tool_id;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql';

-- Trigger to update tool statistics
CREATE TRIGGER update_tool_statistics 
    AFTER INSERT ON tool_executions
    FOR EACH ROW EXECUTE FUNCTION update_tool_avg_execution_time();

-- Function to update server capabilities count
CREATE OR REPLACE FUNCTION update_server_capabilities_count()
RETURNS TRIGGER AS $$
BEGIN
    -- Update tools count
    UPDATE mcp_servers 
    SET tools_count = (
        SELECT COUNT(*) FROM mcp_tools WHERE server_id = COALESCE(NEW.server_id, OLD.server_id)
    )
    WHERE id = COALESCE(NEW.server_id, OLD.server_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql';

-- Triggers for capability counts
CREATE TRIGGER update_tools_count 
    AFTER INSERT OR DELETE ON mcp_tools
    FOR EACH ROW EXECUTE FUNCTION update_server_capabilities_count();

-- =============================================================================
-- VIEWS FOR COMMON QUERIES
-- =============================================================================

-- Comprehensive server status view
CREATE VIEW server_status_view AS
SELECT 
    s.id,
    s.name,
    s.display_name,
    s.description,
    s.transport_type,
    s.connection_state,
    s.endpoint,
    s.error_message,
    s.disabled,
    s.last_connected,
    s.total_uptime_seconds,
    s.tools_count,
    s.resources_count,
    s.prompts_count,
    h.instance_name as hub_name,
    h.host as hub_host,
    h.port as hub_port,
    h.state as hub_state,
    t.name as tenant_name,
    
    -- Recent activity
    (SELECT MAX(started_at) FROM tool_executions WHERE server_id = s.id) as last_tool_execution,
    (SELECT COUNT(*) FROM tool_executions WHERE server_id = s.id AND started_at > CURRENT_TIMESTAMP - INTERVAL '1 hour') as executions_last_hour,
    
    -- Error rates
    (SELECT 
        ROUND(
            (COUNT(*) FILTER (WHERE error_message IS NOT NULL)::decimal / NULLIF(COUNT(*), 0)) * 100, 
            2
        )
        FROM tool_executions 
        WHERE server_id = s.id 
        AND started_at > CURRENT_TIMESTAMP - INTERVAL '1 day'
    ) as error_rate_24h
    
FROM mcp_servers s
JOIN hub_instances h ON s.hub_instance_id = h.id
JOIN tenants t ON h.tenant_id = t.id
WHERE t.active = TRUE;

-- Tool performance view
CREATE VIEW tool_performance_view AS
SELECT 
    t.id,
    t.name,
    t.namespaced_name,
    t.description,
    t.category,
    t.usage_count,
    t.success_count,
    t.error_count,
    t.avg_execution_time_ms,
    t.last_used_at,
    s.name as server_name,
    s.connection_state,
    
    -- Success rate
    ROUND(
        (t.success_count::decimal / NULLIF(t.usage_count, 0)) * 100, 
        2
    ) as success_rate_percent,
    
    -- Recent usage
    (SELECT COUNT(*) FROM tool_executions WHERE tool_id = t.id AND started_at > CURRENT_TIMESTAMP - INTERVAL '1 hour') as usage_last_hour,
    (SELECT COUNT(*) FROM tool_executions WHERE tool_id = t.id AND started_at > CURRENT_TIMESTAMP - INTERVAL '1 day') as usage_last_day
    
FROM mcp_tools t
JOIN mcp_servers s ON t.server_id = s.id;

-- Hub health view
CREATE VIEW hub_health_view AS
SELECT 
    h.id,
    h.instance_name,
    h.host,
    h.port,
    h.state,
    h.started_at,
    t.name as tenant_name,
    
    -- Server stats
    COUNT(s.id) as total_servers,
    COUNT(s.id) FILTER (WHERE s.connection_state = 'CONNECTED') as connected_servers,
    COUNT(s.id) FILTER (WHERE s.disabled = FALSE) as enabled_servers,
    
    -- Tool stats
    COALESCE(SUM(s.tools_count), 0) as total_tools,
    
    -- Recent activity
    (SELECT COUNT(*) FROM tool_executions te 
     JOIN mcp_servers ms ON te.server_id = ms.id 
     WHERE ms.hub_instance_id = h.id 
     AND te.started_at > CURRENT_TIMESTAMP - INTERVAL '1 hour') as executions_last_hour,
    
    -- Error rates
    (SELECT 
        ROUND(
            (COUNT(*) FILTER (WHERE error_message IS NOT NULL)::decimal / NULLIF(COUNT(*), 0)) * 100, 
            2
        )
        FROM tool_executions te
        JOIN mcp_servers ms ON te.server_id = ms.id
        WHERE ms.hub_instance_id = h.id 
        AND te.started_at > CURRENT_TIMESTAMP - INTERVAL '1 day'
    ) as error_rate_24h

FROM hub_instances h
JOIN tenants t ON h.tenant_id = t.id
LEFT JOIN mcp_servers s ON h.id = s.hub_instance_id
WHERE t.active = TRUE
GROUP BY h.id, h.instance_name, h.host, h.port, h.state, h.started_at, t.name;

-- =============================================================================
-- SAMPLE DATA FOR TESTING
-- =============================================================================

-- Insert sample tenant
INSERT INTO tenants (name, description) 
VALUES ('daclab-ai', 'DAClab AI Development Environment');

-- Get tenant ID for sample data
DO $$
DECLARE
    tenant_uuid UUID;
    hub_uuid UUID;
    server_uuid UUID;
    tool_uuid UUID;
BEGIN
    SELECT id INTO tenant_uuid FROM tenants WHERE name = 'daclab-ai';
    
    -- Insert sample hub instance
    INSERT INTO hub_instances (
        tenant_id, instance_name, host, port, pid, version, 
        hub_server_url, state, hub_options
    ) VALUES (
        tenant_uuid, 'mcp-hub-main', 'localhost', 37373, 12345, '4.2.1',
        'http://localhost:37373', 'READY', 
        '{"metaOnly": true, "lazyLoad": true, "idleTimeoutMs": 300000}'
    ) RETURNING id INTO hub_uuid;
    
    -- Insert sample MCP server
    INSERT INTO mcp_servers (
        hub_instance_id, name, display_name, description, transport_type,
        connection_state, endpoint, config, tools_count
    ) VALUES (
        hub_uuid, 'filesystem', 'Filesystem Server', 'File system operations',
        'stdio', 'CONNECTED', 'http://localhost:37373/mcp', 
        '{"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home", "/tmp"]}',
        14
    ) RETURNING id INTO server_uuid;
    
    -- Insert sample tool
    INSERT INTO mcp_tools (
        server_id, name, original_name, namespaced_name, description,
        input_schema, category, usage_count, success_count
    ) VALUES (
        server_uuid, 'read_text_file', 'read_text_file', 'filesystem__read_text_file',
        'Read the complete contents of a file from the file system as text',
        '{"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}',
        'filesystem', 25, 23
    ) RETURNING id INTO tool_uuid;
    
    -- Insert sample tool execution
    INSERT INTO tool_executions (
        tool_id, server_id, hub_instance_id, tool_name, arguments,
        status, started_at, completed_at, execution_time_ms, 
        result
    ) VALUES (
        tool_uuid, server_uuid, hub_uuid, 'read_text_file',
        '{"path": "/home/user/test.txt"}', 'completed',
        CURRENT_TIMESTAMP - INTERVAL '5 minutes',
        CURRENT_TIMESTAMP - INTERVAL '5 minutes' + INTERVAL '150 milliseconds',
        150, '{"content": [{"type": "text", "text": "File contents here"}]}'
    );
    
END $$;

-- =============================================================================
-- GRANT PERMISSIONS
-- =============================================================================

-- Create role for MCP Hub application
CREATE ROLE mcp_hub_app WITH LOGIN PASSWORD 'mcp_hub_secure_password';

-- Grant schema usage
GRANT USAGE ON SCHEMA mcp_hub TO mcp_hub_app;

-- Grant table permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA mcp_hub TO mcp_hub_app;
GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA mcp_hub TO mcp_hub_app;

-- Grant permissions to future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA mcp_hub 
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mcp_hub_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA mcp_hub 
    GRANT SELECT, USAGE ON SEQUENCES TO mcp_hub_app;

-- =============================================================================
-- CONTINUOUS AGGREGATES FOR ANALYTICS (TimescaleDB)
-- =============================================================================

-- Hourly tool execution metrics
CREATE MATERIALIZED VIEW IF NOT EXISTS tool_executions_hourly
WITH (timescaledb.continuous) AS
SELECT 
    time_bucket('1 hour', started_at) as hour,
    tool_id,
    server_id,
    hub_instance_id,
    COUNT(*) as total_executions,
    COUNT(*) FILTER (WHERE status = 'completed') as successful_executions,
    COUNT(*) FILTER (WHERE status = 'failed') as failed_executions,
    AVG(execution_time_ms) as avg_execution_time_ms,
    MAX(execution_time_ms) as max_execution_time_ms,
    MIN(execution_time_ms) as min_execution_time_ms
FROM tool_executions
GROUP BY hour, tool_id, server_id, hub_instance_id;

-- Daily hub metrics
CREATE MATERIALIZED VIEW IF NOT EXISTS hub_metrics_daily
WITH (timescaledb.continuous) AS
SELECT 
    time_bucket('1 day', collected_at) as day,
    hub_instance_id,
    AVG(active_connections) as avg_active_connections,
    MAX(active_connections) as max_active_connections,
    AVG(connected_servers) as avg_connected_servers,
    AVG(tools_executed_per_minute) as avg_tools_per_minute,
    AVG(error_rate_percent) as avg_error_rate_percent,
    AVG(node_memory_usage_mb) as avg_memory_usage_mb
FROM hub_performance
GROUP BY day, hub_instance_id;

-- Enable real-time aggregation
SELECT add_continuous_aggregate_policy('tool_executions_hourly',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy('hub_metrics_daily',
    start_offset => INTERVAL '3 days', 
    end_offset => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

COMMIT;

-- Success message
\echo 'MCP Hub comprehensive database schema created successfully!'
\echo 'Schema includes:'
\echo '- Multi-tenant MCP hub and server tracking'
\echo '- Comprehensive tool execution logging'
\echo '- Real-time event and SSE tracking'
\echo '- OAuth flow management'
\echo '- Docker and system metrics'
\echo '- Performance analytics with TimescaleDB'
\echo '- Sample data for testing'
\echo ''
\echo 'Connect with: psql -h localhost -U mcp_hub_app -d mcp_hub'

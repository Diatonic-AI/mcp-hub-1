-- MCP-Hub PostgreSQL Schema Migration
-- Version: 1.0.0
-- Description: Initial schema for telemetry, analytics, and ML/DL pipeline

-- Create schema if not exists
CREATE SCHEMA IF NOT EXISTS mcp_hub;
CREATE SCHEMA IF NOT EXISTS telemetry;
CREATE SCHEMA IF NOT EXISTS analytics;

-- Set search path
SET search_path TO mcp_hub, telemetry, analytics, public;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =====================================================
-- Core MCP-Hub Tables
-- =====================================================

-- MCP Servers table
CREATE TABLE IF NOT EXISTS mcp_hub.servers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'disconnected',
    config JSONB NOT NULL DEFAULT '{}',
    capabilities JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    installed BOOLEAN DEFAULT false,
    auth_required BOOLEAN DEFAULT false,
    last_started TIMESTAMP WITH TIME ZONE,
    last_stopped TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_servers_name ON mcp_hub.servers(name);
CREATE INDEX idx_servers_status ON mcp_hub.servers(status);
CREATE INDEX idx_servers_type ON mcp_hub.servers(type);

-- MCP Tools table
CREATE TABLE IF NOT EXISTS mcp_hub.tools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id UUID REFERENCES mcp_hub.servers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    full_name VARCHAR(512) NOT NULL,
    description TEXT,
    input_schema JSONB,
    output_schema JSONB,
    category VARCHAR(100),
    tags TEXT[],
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, name)
);

CREATE INDEX idx_tools_server_id ON mcp_hub.tools(server_id);
CREATE INDEX idx_tools_name ON mcp_hub.tools(name);
CREATE INDEX idx_tools_full_name ON mcp_hub.tools(full_name);
CREATE INDEX idx_tools_category ON mcp_hub.tools(category);
CREATE INDEX idx_tools_tags ON mcp_hub.tools USING GIN(tags);

-- MCP Resources table
CREATE TABLE IF NOT EXISTS mcp_hub.resources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id UUID REFERENCES mcp_hub.servers(id) ON DELETE CASCADE,
    uri VARCHAR(1024) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    mime_type VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, uri)
);

CREATE INDEX idx_resources_server_id ON mcp_hub.resources(server_id);
CREATE INDEX idx_resources_uri ON mcp_hub.resources(uri);

-- =====================================================
-- Telemetry Tables
-- =====================================================

-- Raw telemetry events
CREATE TABLE IF NOT EXISTS telemetry.events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    event_type VARCHAR(100) NOT NULL,
    server VARCHAR(255),
    tool VARCHAR(255),
    session_id VARCHAR(255),
    correlation_id VARCHAR(255),
    user_id VARCHAR(255),
    payload JSONB NOT NULL DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
) PARTITION BY RANGE (timestamp);

-- Create partitions for telemetry events (monthly)
CREATE TABLE telemetry.events_2025_01 PARTITION OF telemetry.events
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE telemetry.events_2025_02 PARTITION OF telemetry.events
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
-- Add more partitions as needed

CREATE INDEX idx_events_timestamp ON telemetry.events(timestamp);
CREATE INDEX idx_events_type ON telemetry.events(event_type);
CREATE INDEX idx_events_server_tool ON telemetry.events(server, tool);
CREATE INDEX idx_events_session ON telemetry.events(session_id);
CREATE INDEX idx_events_correlation ON telemetry.events(correlation_id);

-- Tool call telemetry
CREATE TABLE IF NOT EXISTS telemetry.tool_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    server VARCHAR(255) NOT NULL,
    tool VARCHAR(255) NOT NULL,
    session_id VARCHAR(255),
    correlation_id VARCHAR(255),
    request_id VARCHAR(255),
    user_id VARCHAR(255),
    input JSONB,
    output JSONB,
    error JSONB,
    status VARCHAR(50),
    latency_ms INTEGER,
    token_count INTEGER,
    cost_estimate DECIMAL(10, 6),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
) PARTITION BY RANGE (timestamp);

-- Create partitions for tool calls (weekly)
CREATE TABLE telemetry.tool_calls_2025_w01 PARTITION OF telemetry.tool_calls
    FOR VALUES FROM ('2025-01-01') TO ('2025-01-08');
CREATE TABLE telemetry.tool_calls_2025_w02 PARTITION OF telemetry.tool_calls
    FOR VALUES FROM ('2025-01-08') TO ('2025-01-15');
-- Add more partitions as needed

CREATE INDEX idx_tool_calls_timestamp ON telemetry.tool_calls(timestamp);
CREATE INDEX idx_tool_calls_server_tool ON telemetry.tool_calls(server, tool, timestamp);
CREATE INDEX idx_tool_calls_session ON telemetry.tool_calls(session_id);
CREATE INDEX idx_tool_calls_status ON telemetry.tool_calls(status);

-- =====================================================
-- Analytics Tables
-- =====================================================

-- Aggregated metrics (materialized view)
CREATE TABLE IF NOT EXISTS analytics.metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    bucket VARCHAR(20) NOT NULL, -- 'minute', 'hour', 'day'
    server VARCHAR(255),
    tool VARCHAR(255),
    call_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    latency_p50 INTEGER,
    latency_p95 INTEGER,
    latency_p99 INTEGER,
    latency_min INTEGER,
    latency_max INTEGER,
    latency_avg DECIMAL(10, 2),
    total_tokens INTEGER DEFAULT 0,
    total_cost DECIMAL(10, 6) DEFAULT 0,
    unique_users INTEGER DEFAULT 0,
    unique_sessions INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(timestamp, bucket, server, tool)
);

CREATE INDEX idx_metrics_timestamp_bucket ON analytics.metrics(timestamp, bucket);
CREATE INDEX idx_metrics_server_tool ON analytics.metrics(server, tool);
CREATE INDEX idx_metrics_bucket ON analytics.metrics(bucket);

-- Anomaly detection results
CREATE TABLE IF NOT EXISTS analytics.anomalies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL, -- 'low', 'medium', 'high', 'critical'
    server VARCHAR(255),
    tool VARCHAR(255),
    metric VARCHAR(100),
    expected_value DECIMAL(15, 4),
    actual_value DECIMAL(15, 4),
    deviation DECIMAL(10, 4),
    description TEXT,
    metadata JSONB DEFAULT '{}',
    resolved BOOLEAN DEFAULT false,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_anomalies_detected_at ON analytics.anomalies(detected_at);
CREATE INDEX idx_anomalies_severity ON analytics.anomalies(severity);
CREATE INDEX idx_anomalies_server_tool ON analytics.anomalies(server, tool);
CREATE INDEX idx_anomalies_resolved ON analytics.anomalies(resolved);

-- ML/DL embeddings tracking
CREATE TABLE IF NOT EXISTS analytics.embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    source_type VARCHAR(100) NOT NULL,
    source_id VARCHAR(255),
    model VARCHAR(255),
    dimensions INTEGER,
    vector_id VARCHAR(255),
    collection VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_embeddings_timestamp ON analytics.embeddings(timestamp);
CREATE INDEX idx_embeddings_source ON analytics.embeddings(source_type, source_id);
CREATE INDEX idx_embeddings_collection ON analytics.embeddings(collection);

-- Usage summaries
CREATE TABLE IF NOT EXISTS analytics.usage_summary (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL,
    server VARCHAR(255),
    tool VARCHAR(255),
    total_calls INTEGER DEFAULT 0,
    successful_calls INTEGER DEFAULT 0,
    failed_calls INTEGER DEFAULT 0,
    total_latency_ms BIGINT DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    total_cost DECIMAL(10, 6) DEFAULT 0,
    unique_users INTEGER DEFAULT 0,
    unique_sessions INTEGER DEFAULT 0,
    peak_calls_per_minute INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, server, tool)
);

CREATE INDEX idx_usage_summary_date ON analytics.usage_summary(date);
CREATE INDEX idx_usage_summary_server_tool ON analytics.usage_summary(server, tool);

-- =====================================================
-- Functions and Triggers
-- =====================================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update trigger to tables
CREATE TRIGGER update_servers_updated_at BEFORE UPDATE ON mcp_hub.servers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tools_updated_at BEFORE UPDATE ON mcp_hub.tools
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_resources_updated_at BEFORE UPDATE ON mcp_hub.resources
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to aggregate metrics
CREATE OR REPLACE FUNCTION analytics.aggregate_metrics(
    p_bucket VARCHAR,
    p_start_time TIMESTAMP WITH TIME ZONE,
    p_end_time TIMESTAMP WITH TIME ZONE
) RETURNS VOID AS $$
BEGIN
    INSERT INTO analytics.metrics (
        timestamp, bucket, server, tool,
        call_count, success_count, error_count,
        latency_p50, latency_p95, latency_p99,
        latency_min, latency_max, latency_avg,
        total_tokens, total_cost,
        unique_users, unique_sessions
    )
    SELECT
        date_trunc(p_bucket, timestamp) as timestamp,
        p_bucket as bucket,
        server, tool,
        COUNT(*) as call_count,
        COUNT(*) FILTER (WHERE status = 'success') as success_count,
        COUNT(*) FILTER (WHERE status = 'error') as error_count,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) as latency_p50,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) as latency_p95,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) as latency_p99,
        MIN(latency_ms) as latency_min,
        MAX(latency_ms) as latency_max,
        AVG(latency_ms) as latency_avg,
        SUM(token_count) as total_tokens,
        SUM(cost_estimate) as total_cost,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(DISTINCT session_id) as unique_sessions
    FROM telemetry.tool_calls
    WHERE timestamp >= p_start_time AND timestamp < p_end_time
    GROUP BY date_trunc(p_bucket, timestamp), server, tool
    ON CONFLICT (timestamp, bucket, server, tool) 
    DO UPDATE SET
        call_count = EXCLUDED.call_count,
        success_count = EXCLUDED.success_count,
        error_count = EXCLUDED.error_count,
        latency_p50 = EXCLUDED.latency_p50,
        latency_p95 = EXCLUDED.latency_p95,
        latency_p99 = EXCLUDED.latency_p99,
        latency_min = EXCLUDED.latency_min,
        latency_max = EXCLUDED.latency_max,
        latency_avg = EXCLUDED.latency_avg,
        total_tokens = EXCLUDED.total_tokens,
        total_cost = EXCLUDED.total_cost,
        unique_users = EXCLUDED.unique_users,
        unique_sessions = EXCLUDED.unique_sessions;
END;
$$ LANGUAGE plpgsql;

-- Function to detect anomalies
CREATE OR REPLACE FUNCTION analytics.detect_anomalies(
    p_window_hours INTEGER DEFAULT 24
) RETURNS TABLE (
    server VARCHAR,
    tool VARCHAR,
    metric VARCHAR,
    current_value DECIMAL,
    expected_value DECIMAL,
    deviation_percent DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    WITH recent_metrics AS (
        SELECT 
            server, tool,
            AVG(latency_avg) as avg_latency,
            AVG(error_count::DECIMAL / NULLIF(call_count, 0)) as avg_error_rate,
            STDDEV(latency_avg) as stddev_latency,
            STDDEV(error_count::DECIMAL / NULLIF(call_count, 0)) as stddev_error_rate
        FROM analytics.metrics
        WHERE timestamp >= CURRENT_TIMESTAMP - INTERVAL '1 week'
          AND bucket = 'hour'
        GROUP BY server, tool
    ),
    current_metrics AS (
        SELECT 
            server, tool,
            latency_avg,
            error_count::DECIMAL / NULLIF(call_count, 0) as error_rate
        FROM analytics.metrics
        WHERE timestamp >= CURRENT_TIMESTAMP - (p_window_hours || ' hours')::INTERVAL
          AND bucket = 'hour'
    )
    SELECT 
        c.server, c.tool,
        'latency' as metric,
        c.latency_avg as current_value,
        r.avg_latency as expected_value,
        CASE 
            WHEN r.avg_latency > 0 THEN 
                ((c.latency_avg - r.avg_latency) / r.avg_latency * 100)
            ELSE 0
        END as deviation_percent
    FROM current_metrics c
    JOIN recent_metrics r ON c.server = r.server AND c.tool = r.tool
    WHERE ABS(c.latency_avg - r.avg_latency) > 2 * r.stddev_latency
    UNION ALL
    SELECT 
        c.server, c.tool,
        'error_rate' as metric,
        c.error_rate * 100 as current_value,
        r.avg_error_rate * 100 as expected_value,
        CASE 
            WHEN r.avg_error_rate > 0 THEN 
                ((c.error_rate - r.avg_error_rate) / r.avg_error_rate * 100)
            ELSE 0
        END as deviation_percent
    FROM current_metrics c
    JOIN recent_metrics r ON c.server = r.server AND c.tool = r.tool
    WHERE ABS(c.error_rate - r.avg_error_rate) > 2 * r.stddev_error_rate;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Views
-- =====================================================

-- Real-time dashboard view
CREATE OR REPLACE VIEW analytics.dashboard_stats AS
SELECT 
    (SELECT COUNT(*) FROM mcp_hub.servers WHERE status = 'connected') as active_servers,
    (SELECT COUNT(*) FROM mcp_hub.tools) as total_tools,
    (SELECT COUNT(*) FROM telemetry.tool_calls 
     WHERE timestamp >= CURRENT_TIMESTAMP - INTERVAL '24 hours') as calls_24h,
    (SELECT AVG(latency_ms) FROM telemetry.tool_calls 
     WHERE timestamp >= CURRENT_TIMESTAMP - INTERVAL '1 hour') as avg_latency_1h,
    (SELECT COUNT(*) FROM telemetry.tool_calls 
     WHERE timestamp >= CURRENT_TIMESTAMP - INTERVAL '1 hour' 
     AND status = 'error') as errors_1h,
    (SELECT COUNT(*) FROM analytics.anomalies 
     WHERE detected_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours' 
     AND NOT resolved) as active_anomalies;

-- Top tools by usage
CREATE OR REPLACE VIEW analytics.top_tools AS
SELECT 
    server, tool,
    COUNT(*) as call_count,
    AVG(latency_ms) as avg_latency,
    COUNT(*) FILTER (WHERE status = 'success') * 100.0 / COUNT(*) as success_rate
FROM telemetry.tool_calls
WHERE timestamp >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
GROUP BY server, tool
ORDER BY call_count DESC
LIMIT 20;

-- =====================================================
-- Permissions
-- =====================================================

-- Create read-only role for analytics
CREATE ROLE mcp_hub_readonly;
GRANT USAGE ON SCHEMA mcp_hub, telemetry, analytics TO mcp_hub_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA mcp_hub, telemetry, analytics TO mcp_hub_readonly;

-- Create read-write role for application
CREATE ROLE mcp_hub_app;
GRANT ALL ON SCHEMA mcp_hub, telemetry, analytics TO mcp_hub_app;
GRANT ALL ON ALL TABLES IN SCHEMA mcp_hub, telemetry, analytics TO mcp_hub_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA mcp_hub, telemetry, analytics TO mcp_hub_app;

-- =====================================================
-- Sample Data (Optional - Remove for production)
-- =====================================================

-- Insert sample servers
INSERT INTO mcp_hub.servers (name, type, status, config, capabilities) VALUES
    ('filesystem', 'builtin', 'connected', '{"path": "/usr/local/bin/mcp-filesystem"}', '{"tools": true, "resources": true}'),
    ('github', 'installed', 'connected', '{"token": "***"}', '{"tools": true}'),
    ('mcp-postgres', 'installed', 'connected', '{"connection": "postgresql://localhost:5432"}', '{"tools": true}')
ON CONFLICT (name) DO NOTHING;

-- =====================================================
-- Maintenance
-- =====================================================

-- Add comment documentation
COMMENT ON SCHEMA mcp_hub IS 'Core MCP-Hub configuration and metadata';
COMMENT ON SCHEMA telemetry IS 'Raw telemetry data and events';
COMMENT ON SCHEMA analytics IS 'Aggregated metrics and analytics';
COMMENT ON TABLE mcp_hub.servers IS 'MCP server configurations and status';
COMMENT ON TABLE mcp_hub.tools IS 'Available MCP tools and their schemas';
COMMENT ON TABLE telemetry.tool_calls IS 'Individual tool call telemetry records';
COMMENT ON TABLE analytics.metrics IS 'Aggregated metrics at various time buckets';
COMMENT ON TABLE analytics.anomalies IS 'Detected anomalies in system behavior';

-- Migration completion
DO $$
BEGIN
    RAISE NOTICE 'MCP-Hub PostgreSQL schema migration completed successfully';
    RAISE NOTICE 'Schemas created: mcp_hub, telemetry, analytics';
    RAISE NOTICE 'Tables created: servers, tools, resources, events, tool_calls, metrics, anomalies, embeddings, usage_summary';
    RAISE NOTICE 'Functions created: update_updated_at_column, aggregate_metrics, detect_anomalies';
    RAISE NOTICE 'Views created: dashboard_stats, top_tools';
    RAISE NOTICE 'Roles created: mcp_hub_readonly, mcp_hub_app';
END $$;

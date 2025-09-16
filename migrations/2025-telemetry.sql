-- Migration: Comprehensive ML/DL Telemetry Schema
-- Version: 2025-telemetry
-- Description: Real-time analytics and pattern recognition for MCP Hub
-- Purpose: System of Record for normalized telemetry with embedding references

BEGIN;

-- =====================================================
-- SCHEMAS
-- =====================================================

CREATE SCHEMA IF NOT EXISTS telemetry;

-- Grant usage to application user
GRANT USAGE ON SCHEMA telemetry TO CURRENT_USER;

-- =====================================================
-- CORE TELEMETRY EVENT TABLE (PARTITIONED)
-- =====================================================

-- Main telemetry event table (partitioned by month)
CREATE TABLE IF NOT EXISTS telemetry.event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Tenant and session context
    tenant TEXT NOT NULL DEFAULT 'default',
    session_id TEXT,
    user_agent TEXT,
    
    -- MCP context
    server TEXT NOT NULL,
    tool TEXT NOT NULL,
    
    -- Execution metrics
    status TEXT NOT NULL CHECK (status IN ('success', 'error', 'timeout', 'cancelled')),
    latency_ms INTEGER,
    input_len INTEGER,
    output_len INTEGER,
    
    -- Error tracking
    error_code TEXT,
    error_class TEXT,
    
    -- References
    raw_ref UUID, -- Reference to MongoDB raw event
    chain_id TEXT, -- For hub__chain_tools tracking
    parent_id UUID, -- Parent event for nested calls
    
    -- Flexible attributes
    attrs JSONB DEFAULT '{}',
    
    -- Versioning
    version INTEGER NOT NULL DEFAULT 1,
    
    -- Constraints
    CONSTRAINT event_latency_positive CHECK (latency_ms >= 0),
    CONSTRAINT event_lens_positive CHECK (input_len >= 0 AND output_len >= 0)
) PARTITION BY RANGE (created_at);

-- Create indexes for efficient queries
CREATE INDEX idx_telemetry_event_created_at 
    ON telemetry.event (created_at DESC);
CREATE INDEX idx_telemetry_event_tool 
    ON telemetry.event (server, tool, created_at DESC);
CREATE INDEX idx_telemetry_event_status 
    ON telemetry.event (status, created_at DESC);
CREATE INDEX idx_telemetry_event_tenant 
    ON telemetry.event (tenant, created_at DESC);
CREATE INDEX idx_telemetry_event_session 
    ON telemetry.event (session_id, created_at DESC) 
    WHERE session_id IS NOT NULL;
CREATE INDEX idx_telemetry_event_chain 
    ON telemetry.event (chain_id, created_at DESC) 
    WHERE chain_id IS NOT NULL;
CREATE INDEX idx_telemetry_event_error 
    ON telemetry.event (error_code, created_at DESC) 
    WHERE error_code IS NOT NULL;

-- Create monthly partitions for next 12 months
DO $$
DECLARE
    start_date DATE := DATE_TRUNC('month', CURRENT_DATE);
    end_date DATE;
    partition_name TEXT;
BEGIN
    FOR i IN 0..11 LOOP
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'event_' || TO_CHAR(start_date, 'YYYY_MM');
        
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS telemetry.%I PARTITION OF telemetry.event
            FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );
        
        start_date := end_date;
    END LOOP;
END $$;

-- =====================================================
-- EMBEDDING REFERENCES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS telemetry.embedding_ref (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES telemetry.event(id) ON DELETE CASCADE,
    
    -- Source context
    source TEXT NOT NULL CHECK (source IN ('telemetry', 'postgres', 'mongodb')),
    source_table TEXT, -- For postgres source
    source_collection TEXT, -- For mongodb source
    source_key TEXT, -- Primary key in source
    
    -- Vector details
    vector_name TEXT NOT NULL CHECK (vector_name IN ('input_text', 'output_text', 'error_text', 'combined')),
    vector_dim INTEGER NOT NULL,
    qdrant_point_id TEXT NOT NULL,
    qdrant_collection TEXT NOT NULL DEFAULT 'mcp_telemetry',
    
    -- Metadata
    model_name TEXT,
    embedding_time_ms INTEGER,
    text_length INTEGER,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique constraint to prevent duplicates
    CONSTRAINT embedding_ref_unique UNIQUE (event_id, vector_name)
);

CREATE INDEX idx_embedding_ref_event 
    ON telemetry.embedding_ref (event_id);
CREATE INDEX idx_embedding_ref_source 
    ON telemetry.embedding_ref (source, source_table) 
    WHERE source = 'postgres';
CREATE INDEX idx_embedding_ref_qdrant 
    ON telemetry.embedding_ref (qdrant_point_id);

-- =====================================================
-- HOURLY AGGREGATES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS telemetry.tool_agg_hour (
    bucket_start TIMESTAMPTZ NOT NULL,
    server TEXT NOT NULL,
    tool TEXT NOT NULL,
    
    -- Call statistics
    calls INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    timeouts INTEGER NOT NULL DEFAULT 0,
    
    -- Latency percentiles (milliseconds)
    p50_ms INTEGER,
    p90_ms INTEGER,
    p95_ms INTEGER,
    p99_ms INTEGER,
    max_ms INTEGER,
    
    -- Throughput
    avg_input_len INTEGER,
    avg_output_len INTEGER,
    total_input_bytes BIGINT DEFAULT 0,
    total_output_bytes BIGINT DEFAULT 0,
    
    -- Unique counts
    unique_sessions INTEGER DEFAULT 0,
    unique_tenants INTEGER DEFAULT 0,
    unique_errors INTEGER DEFAULT 0,
    
    -- Chain metrics
    chain_calls INTEGER DEFAULT 0,
    avg_chain_length FLOAT,
    
    -- Resource usage
    avg_cpu_ms INTEGER,
    avg_memory_mb INTEGER,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    PRIMARY KEY (bucket_start, server, tool)
);

CREATE INDEX idx_tool_agg_hour_bucket 
    ON telemetry.tool_agg_hour (bucket_start DESC);
CREATE INDEX idx_tool_agg_hour_tool 
    ON telemetry.tool_agg_hour (server, tool, bucket_start DESC);
CREATE INDEX idx_tool_agg_hour_errors 
    ON telemetry.tool_agg_hour (errors DESC, bucket_start DESC) 
    WHERE errors > 0;

-- =====================================================
-- SESSION TRACKING TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS telemetry.session (
    session_id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL DEFAULT 'default',
    
    -- Temporal
    started_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    duration_ms BIGINT GENERATED ALWAYS AS 
        (EXTRACT(EPOCH FROM (last_seen_at - started_at)) * 1000) STORED,
    
    -- Activity metrics
    total_calls INTEGER DEFAULT 0,
    total_errors INTEGER DEFAULT 0,
    unique_tools INTEGER DEFAULT 0,
    unique_servers INTEGER DEFAULT 0,
    
    -- Session attributes
    user_agent TEXT,
    ip_address INET,
    
    -- Aggregated stats
    stats JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_session_tenant 
    ON telemetry.session (tenant, started_at DESC);
CREATE INDEX idx_session_last_seen 
    ON telemetry.session (last_seen_at DESC);
CREATE INDEX idx_session_duration 
    ON telemetry.session (duration_ms DESC) 
    WHERE duration_ms > 60000; -- Sessions > 1 minute

-- =====================================================
-- ANOMALY DETECTION TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS telemetry.anomaly (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Anomaly classification
    anomaly_type TEXT NOT NULL CHECK (anomaly_type IN (
        'latency_spike', 'error_rate_spike', 'unusual_sequence', 
        'resource_anomaly', 'drift_detected', 'new_pattern'
    )),
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    
    -- Context
    server TEXT,
    tool TEXT,
    tenant TEXT,
    
    -- Detection metrics
    score FLOAT NOT NULL,
    threshold FLOAT NOT NULL,
    baseline_value FLOAT,
    observed_value FLOAT,
    
    -- Details
    detection_method TEXT, -- 'z_score', 'isolation_forest', 'sequence_mining'
    window_size_seconds INTEGER,
    sample_count INTEGER,
    
    -- Related events
    event_ids UUID[],
    
    -- Response
    alert_sent BOOLEAN DEFAULT FALSE,
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by TEXT,
    acknowledged_at TIMESTAMPTZ,
    
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_anomaly_detected 
    ON telemetry.anomaly (detected_at DESC);
CREATE INDEX idx_anomaly_type_severity 
    ON telemetry.anomaly (anomaly_type, severity, detected_at DESC);
CREATE INDEX idx_anomaly_tool 
    ON telemetry.anomaly (server, tool, detected_at DESC) 
    WHERE server IS NOT NULL;
CREATE INDEX idx_anomaly_unacked 
    ON telemetry.anomaly (detected_at DESC) 
    WHERE NOT acknowledged;

-- =====================================================
-- PATTERN SEQUENCES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS telemetry.pattern_sequence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Pattern identification
    pattern_hash TEXT NOT NULL,
    pattern_text TEXT NOT NULL, -- e.g., "tool_a->tool_b->tool_c"
    pattern_length INTEGER NOT NULL,
    
    -- Frequency tracking
    first_seen TIMESTAMPTZ NOT NULL,
    last_seen TIMESTAMPTZ NOT NULL,
    occurrence_count BIGINT DEFAULT 1,
    
    -- Context
    servers TEXT[],
    tools TEXT[],
    
    -- Performance metrics
    avg_total_latency_ms INTEGER,
    p95_total_latency_ms INTEGER,
    success_rate FLOAT,
    
    -- Classification
    is_common BOOLEAN DEFAULT FALSE,
    is_optimal BOOLEAN,
    suggested_alternative TEXT,
    
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT pattern_unique UNIQUE (pattern_hash)
);

CREATE INDEX idx_pattern_sequence_hash 
    ON telemetry.pattern_sequence (pattern_hash);
CREATE INDEX idx_pattern_sequence_count 
    ON telemetry.pattern_sequence (occurrence_count DESC);
CREATE INDEX idx_pattern_sequence_last_seen 
    ON telemetry.pattern_sequence (last_seen DESC);

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to update session stats
CREATE OR REPLACE FUNCTION telemetry.update_session_stats()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO telemetry.session (
        session_id, tenant, started_at, last_seen_at,
        total_calls, total_errors, user_agent
    ) VALUES (
        NEW.session_id, NEW.tenant, NEW.created_at, NEW.created_at,
        1, CASE WHEN NEW.status = 'error' THEN 1 ELSE 0 END, NEW.user_agent
    )
    ON CONFLICT (session_id) DO UPDATE SET
        last_seen_at = EXCLUDED.last_seen_at,
        total_calls = telemetry.session.total_calls + 1,
        total_errors = telemetry.session.total_errors + 
            CASE WHEN NEW.status = 'error' THEN 1 ELSE 0 END,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update sessions
CREATE TRIGGER update_session_on_event
    AFTER INSERT ON telemetry.event
    FOR EACH ROW
    WHEN (NEW.session_id IS NOT NULL)
    EXECUTE FUNCTION telemetry.update_session_stats();

-- Function to compute hourly aggregates
CREATE OR REPLACE FUNCTION telemetry.compute_hourly_aggregates(
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ
)
RETURNS INTEGER AS $$
DECLARE
    v_rows_inserted INTEGER;
BEGIN
    INSERT INTO telemetry.tool_agg_hour (
        bucket_start, server, tool,
        calls, errors, timeouts,
        p50_ms, p90_ms, p95_ms, p99_ms, max_ms,
        avg_input_len, avg_output_len,
        total_input_bytes, total_output_bytes,
        unique_sessions, unique_tenants, unique_errors,
        chain_calls, avg_chain_length
    )
    SELECT 
        DATE_TRUNC('hour', e.created_at) as bucket_start,
        e.server,
        e.tool,
        COUNT(*) as calls,
        COUNT(*) FILTER (WHERE e.status = 'error') as errors,
        COUNT(*) FILTER (WHERE e.status = 'timeout') as timeouts,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY e.latency_ms) as p50_ms,
        PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY e.latency_ms) as p90_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY e.latency_ms) as p95_ms,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY e.latency_ms) as p99_ms,
        MAX(e.latency_ms) as max_ms,
        AVG(e.input_len)::INTEGER as avg_input_len,
        AVG(e.output_len)::INTEGER as avg_output_len,
        SUM(e.input_len) as total_input_bytes,
        SUM(e.output_len) as total_output_bytes,
        COUNT(DISTINCT e.session_id) as unique_sessions,
        COUNT(DISTINCT e.tenant) as unique_tenants,
        COUNT(DISTINCT e.error_code) FILTER (WHERE e.error_code IS NOT NULL) as unique_errors,
        COUNT(*) FILTER (WHERE e.chain_id IS NOT NULL) as chain_calls,
        AVG(CASE WHEN e.chain_id IS NOT NULL 
            THEN (e.attrs->>'chain_length')::FLOAT 
            ELSE NULL END) as avg_chain_length
    FROM telemetry.event e
    WHERE e.created_at >= p_start_time 
      AND e.created_at < p_end_time
    GROUP BY DATE_TRUNC('hour', e.created_at), e.server, e.tool
    ON CONFLICT (bucket_start, server, tool) DO UPDATE SET
        calls = EXCLUDED.calls,
        errors = EXCLUDED.errors,
        timeouts = EXCLUDED.timeouts,
        p50_ms = EXCLUDED.p50_ms,
        p90_ms = EXCLUDED.p90_ms,
        p95_ms = EXCLUDED.p95_ms,
        p99_ms = EXCLUDED.p99_ms,
        max_ms = EXCLUDED.max_ms,
        avg_input_len = EXCLUDED.avg_input_len,
        avg_output_len = EXCLUDED.avg_output_len,
        total_input_bytes = EXCLUDED.total_input_bytes,
        total_output_bytes = EXCLUDED.total_output_bytes,
        unique_sessions = EXCLUDED.unique_sessions,
        unique_tenants = EXCLUDED.unique_tenants,
        unique_errors = EXCLUDED.unique_errors,
        chain_calls = EXCLUDED.chain_calls,
        avg_chain_length = EXCLUDED.avg_chain_length,
        updated_at = NOW();
    
    GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;
    RETURN v_rows_inserted;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- PERMISSIONS
-- =====================================================

-- Grant appropriate permissions
GRANT ALL ON SCHEMA telemetry TO CURRENT_USER;
GRANT ALL ON ALL TABLES IN SCHEMA telemetry TO CURRENT_USER;
GRANT ALL ON ALL SEQUENCES IN SCHEMA telemetry TO CURRENT_USER;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA telemetry TO CURRENT_USER;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON SCHEMA telemetry IS 'ML/DL telemetry schema for MCP Hub analytics and pattern recognition';
COMMENT ON TABLE telemetry.event IS 'Core telemetry events from MCP tool calls';
COMMENT ON TABLE telemetry.embedding_ref IS 'References to vector embeddings in Qdrant';
COMMENT ON TABLE telemetry.tool_agg_hour IS 'Hourly aggregated metrics per tool';
COMMENT ON TABLE telemetry.session IS 'User session tracking and statistics';
COMMENT ON TABLE telemetry.anomaly IS 'Detected anomalies and alerts';
COMMENT ON TABLE telemetry.pattern_sequence IS 'Mined tool usage patterns and sequences';

COMMIT;

-- Create a maintenance job to compute hourly aggregates (run via cron or pg_cron)
-- SELECT telemetry.compute_hourly_aggregates(
--     DATE_TRUNC('hour', NOW() - INTERVAL '1 hour'),
--     DATE_TRUNC('hour', NOW())
-- );

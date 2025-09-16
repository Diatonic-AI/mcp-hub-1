-- Fixed Telemetry Schema for MCP Hub
-- Removes partitioning issues from original migration

BEGIN;

-- Create telemetry schema
CREATE SCHEMA IF NOT EXISTS telemetry;
GRANT ALL ON SCHEMA telemetry TO mcp_hub_app;

-- =====================
-- Core Telemetry Tables
-- =====================

-- Main events table (non-partitioned for simplicity)
CREATE TABLE IF NOT EXISTS telemetry.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    event_name VARCHAR(255),
    source_system VARCHAR(50),
    source_id VARCHAR(100),
    tenant_id VARCHAR(100),
    correlation_id UUID,
    causation_id UUID,
    session_id UUID,
    user_id VARCHAR(100),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data JSONB,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for events
CREATE INDEX IF NOT EXISTS idx_telemetry_events_timestamp ON telemetry.events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_type ON telemetry.events(event_type);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_tenant ON telemetry.events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_correlation ON telemetry.events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_session ON telemetry.events(session_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_data_gin ON telemetry.events USING gin(data);

-- Metrics table for aggregated data
CREATE TABLE IF NOT EXISTS telemetry.metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name VARCHAR(100) NOT NULL,
    metric_type VARCHAR(50) NOT NULL, -- counter, gauge, histogram, summary
    value NUMERIC,
    unit VARCHAR(50),
    labels JSONB,
    source_system VARCHAR(50),
    tenant_id VARCHAR(100),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    aggregation_window INTERVAL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for metrics
CREATE INDEX IF NOT EXISTS idx_telemetry_metrics_name ON telemetry.metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_telemetry_metrics_timestamp ON telemetry.metrics(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_metrics_tenant ON telemetry.metrics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_metrics_labels_gin ON telemetry.metrics USING gin(labels);

-- ML-specific telemetry aggregates
CREATE TABLE IF NOT EXISTS telemetry.ml_aggregates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(100) NOT NULL,
    model_id UUID,
    model_name VARCHAR(255),
    model_version VARCHAR(50),
    tenant_id VARCHAR(100),
    
    -- Performance metrics
    avg_latency_ms NUMERIC(10,3),
    p50_latency_ms NUMERIC(10,3),
    p95_latency_ms NUMERIC(10,3),
    p99_latency_ms NUMERIC(10,3),
    
    -- Token metrics
    total_tokens_used BIGINT DEFAULT 0,
    avg_tokens_per_request NUMERIC(10,2),
    
    -- Success metrics
    total_requests BIGINT DEFAULT 0,
    successful_requests BIGINT DEFAULT 0,
    failed_requests BIGINT DEFAULT 0,
    success_rate NUMERIC(5,2),
    
    -- Time window
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    window_duration INTERVAL NOT NULL,
    
    -- Metadata
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for ML aggregates
CREATE INDEX IF NOT EXISTS idx_telemetry_ml_agg_model ON telemetry.ml_aggregates(model_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_ml_agg_window ON telemetry.ml_aggregates(window_start, window_end);
CREATE INDEX IF NOT EXISTS idx_telemetry_ml_agg_tenant ON telemetry.ml_aggregates(tenant_id);

-- Tool usage telemetry
CREATE TABLE IF NOT EXISTS telemetry.tool_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tool_id VARCHAR(255) NOT NULL,
    tool_name VARCHAR(255),
    server_name VARCHAR(100),
    tenant_id VARCHAR(100),
    user_id VARCHAR(100),
    session_id UUID,
    
    -- Request/Response
    request_id UUID,
    request_data JSONB,
    response_data JSONB,
    
    -- Performance
    latency_ms NUMERIC(10,3),
    success BOOLEAN,
    error_code VARCHAR(100),
    error_message TEXT,
    
    -- Context
    context JSONB,
    metadata JSONB,
    
    -- Timestamps
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for tool usage
CREATE INDEX IF NOT EXISTS idx_telemetry_tool_usage_tool ON telemetry.tool_usage(tool_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_tool_usage_server ON telemetry.tool_usage(server_name);
CREATE INDEX IF NOT EXISTS idx_telemetry_tool_usage_tenant ON telemetry.tool_usage(tenant_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_tool_usage_session ON telemetry.tool_usage(session_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_tool_usage_started ON telemetry.tool_usage(started_at DESC);

-- Connection telemetry
CREATE TABLE IF NOT EXISTS telemetry.connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id VARCHAR(255) NOT NULL,
    server_name VARCHAR(100),
    connection_type VARCHAR(50), -- stdio, http, websocket
    tenant_id VARCHAR(100),
    
    -- Status
    status VARCHAR(50),
    error_code VARCHAR(100),
    error_message TEXT,
    
    -- Timing
    connected_at TIMESTAMPTZ,
    disconnected_at TIMESTAMPTZ,
    duration_ms NUMERIC(12,3),
    
    -- Metadata
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for connections
CREATE INDEX IF NOT EXISTS idx_telemetry_conn_server ON telemetry.connections(server_name);
CREATE INDEX IF NOT EXISTS idx_telemetry_conn_status ON telemetry.connections(status);
CREATE INDEX IF NOT EXISTS idx_telemetry_conn_connected ON telemetry.connections(connected_at DESC);

-- Training telemetry
CREATE TABLE IF NOT EXISTS telemetry.training_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL,
    model_name VARCHAR(255),
    model_version VARCHAR(50),
    tenant_id VARCHAR(100),
    
    -- Event details
    event_type VARCHAR(100) NOT NULL, -- epoch_start, epoch_end, batch, checkpoint, etc.
    epoch INTEGER,
    batch INTEGER,
    step INTEGER,
    
    -- Metrics
    loss NUMERIC,
    accuracy NUMERIC,
    metrics JSONB,
    
    -- Metadata
    metadata JSONB,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for training events
CREATE INDEX IF NOT EXISTS idx_telemetry_training_run ON telemetry.training_events(run_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_training_model ON telemetry.training_events(model_name);
CREATE INDEX IF NOT EXISTS idx_telemetry_training_type ON telemetry.training_events(event_type);
CREATE INDEX IF NOT EXISTS idx_telemetry_training_timestamp ON telemetry.training_events(timestamp DESC);

-- Inference telemetry
CREATE TABLE IF NOT EXISTS telemetry.inference_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inference_id UUID NOT NULL,
    model_id UUID,
    model_name VARCHAR(255),
    model_version VARCHAR(50),
    tenant_id VARCHAR(100),
    
    -- Request/Response
    input_data JSONB,
    output_data JSONB,
    
    -- Performance
    latency_ms NUMERIC(10,3),
    preprocessing_ms NUMERIC(10,3),
    inference_ms NUMERIC(10,3),
    postprocessing_ms NUMERIC(10,3),
    
    -- Token usage
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    
    -- Status
    success BOOLEAN,
    error_code VARCHAR(100),
    error_message TEXT,
    
    -- Metadata
    metadata JSONB,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for inference events
CREATE INDEX IF NOT EXISTS idx_telemetry_inference_id ON telemetry.inference_events(inference_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_inference_model ON telemetry.inference_events(model_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_inference_tenant ON telemetry.inference_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_inference_timestamp ON telemetry.inference_events(timestamp DESC);

-- =====================
-- Functions
-- =====================

-- Function to calculate success rate
CREATE OR REPLACE FUNCTION telemetry.calculate_success_rate(
    p_successful BIGINT,
    p_total BIGINT
) RETURNS NUMERIC AS $$
BEGIN
    IF p_total = 0 THEN
        RETURN 0;
    END IF;
    RETURN ROUND((p_successful::NUMERIC / p_total::NUMERIC) * 100, 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to aggregate metrics over a time window
CREATE OR REPLACE FUNCTION telemetry.aggregate_metrics(
    p_metric_name VARCHAR,
    p_window_start TIMESTAMPTZ,
    p_window_end TIMESTAMPTZ,
    p_tenant_id VARCHAR DEFAULT NULL
) RETURNS TABLE (
    metric_name VARCHAR,
    avg_value NUMERIC,
    min_value NUMERIC,
    max_value NUMERIC,
    sum_value NUMERIC,
    count_value BIGINT,
    p50_value NUMERIC,
    p95_value NUMERIC,
    p99_value NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        m.metric_name,
        AVG(m.value) as avg_value,
        MIN(m.value) as min_value,
        MAX(m.value) as max_value,
        SUM(m.value) as sum_value,
        COUNT(*) as count_value,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY m.value) as p50_value,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY m.value) as p95_value,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY m.value) as p99_value
    FROM telemetry.metrics m
    WHERE m.metric_name = p_metric_name
        AND m.timestamp >= p_window_start
        AND m.timestamp < p_window_end
        AND (p_tenant_id IS NULL OR m.tenant_id = p_tenant_id)
    GROUP BY m.metric_name;
END;
$$ LANGUAGE plpgsql;

-- =====================
-- Triggers
-- =====================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION telemetry.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update trigger to ml_aggregates
CREATE TRIGGER update_ml_aggregates_updated_at
    BEFORE UPDATE ON telemetry.ml_aggregates
    FOR EACH ROW
    EXECUTE FUNCTION telemetry.update_updated_at();

-- =====================
-- Grants
-- =====================

-- Grant permissions to mcp_hub_app
GRANT ALL ON ALL TABLES IN SCHEMA telemetry TO mcp_hub_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA telemetry TO mcp_hub_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA telemetry TO mcp_hub_app;

-- Read-only role for diagnostics (created separately if needed)
-- GRANT USAGE ON SCHEMA telemetry TO diagnostics_reader;
-- GRANT SELECT ON ALL TABLES IN SCHEMA telemetry TO diagnostics_reader;

COMMIT;

-- Migration: Create ML Telemetry Aggregates Tables with RLS and Time Partitioning
-- Version: 003
-- Description: Comprehensive telemetry aggregates for ML/DL pipelines with tenant isolation

BEGIN;

-- =====================================================
-- SCHEMAS
-- =====================================================

-- Create telemetry schema if not exists
CREATE SCHEMA IF NOT EXISTS telemetry;

-- =====================================================
-- CORE TELEMETRY AGGREGATES TABLE (PARTITIONED)
-- =====================================================

-- Main telemetry aggregates table (partitioned by time)
CREATE TABLE IF NOT EXISTS telemetry.aggregates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    
    -- Temporal dimensions
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hour_bucket TIMESTAMPTZ NOT NULL,
    day_bucket DATE NOT NULL,
    week_bucket DATE NOT NULL,
    
    -- Entity references
    model_id VARCHAR(255) NOT NULL,
    model_version VARCHAR(50),
    tool_id VARCHAR(255),
    chain_id VARCHAR(255),
    session_id VARCHAR(255),
    
    -- Metric categories
    metric_type VARCHAR(100) NOT NULL,
    metric_subtype VARCHAR(100),
    
    -- Aggregated values
    count BIGINT DEFAULT 0,
    sum_value DOUBLE PRECISION,
    avg_value DOUBLE PRECISION,
    min_value DOUBLE PRECISION,
    max_value DOUBLE PRECISION,
    stddev_value DOUBLE PRECISION,
    
    -- Percentiles
    p50_value DOUBLE PRECISION,
    p90_value DOUBLE PRECISION,
    p95_value DOUBLE PRECISION,
    p99_value DOUBLE PRECISION,
    
    -- Additional dimensions
    dimensions JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
) PARTITION BY RANGE (timestamp);

-- Create indexes for common queries
CREATE INDEX idx_telemetry_aggregates_tenant_time 
    ON telemetry.aggregates (tenant_id, timestamp DESC);
CREATE INDEX idx_telemetry_aggregates_model 
    ON telemetry.aggregates (model_id, model_version, timestamp DESC);
CREATE INDEX idx_telemetry_aggregates_metric_type 
    ON telemetry.aggregates (metric_type, metric_subtype, timestamp DESC);
CREATE INDEX idx_telemetry_aggregates_hour_bucket 
    ON telemetry.aggregates (hour_bucket, tenant_id);
CREATE INDEX idx_telemetry_aggregates_day_bucket 
    ON telemetry.aggregates (day_bucket, tenant_id);

-- Create monthly partitions for the next 12 months
DO $$
DECLARE
    start_date DATE := DATE_TRUNC('month', CURRENT_DATE);
    end_date DATE;
    partition_name TEXT;
BEGIN
    FOR i IN 0..11 LOOP
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'aggregates_' || TO_CHAR(start_date, 'YYYY_MM');
        
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS telemetry.%I PARTITION OF telemetry.aggregates
            FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );
        
        start_date := end_date;
    END LOOP;
END $$;

-- =====================================================
-- INTER-STEP COMMUNICATION METRICS
-- =====================================================

CREATE TABLE IF NOT EXISTS telemetry.communication_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    
    chain_id VARCHAR(255) NOT NULL,
    from_step VARCHAR(255) NOT NULL,
    to_step VARCHAR(255) NOT NULL,
    
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Latency metrics
    latency_ms INTEGER NOT NULL,
    network_time_ms INTEGER,
    serialization_time_ms INTEGER,
    queue_time_ms INTEGER,
    
    -- Data transfer
    bytes_sent BIGINT,
    bytes_received BIGINT,
    
    -- Status
    success BOOLEAN DEFAULT true,
    error_code VARCHAR(50),
    
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comm_metrics_tenant_chain 
    ON telemetry.communication_metrics (tenant_id, chain_id, timestamp DESC);
CREATE INDEX idx_comm_metrics_latency 
    ON telemetry.communication_metrics (latency_ms) WHERE latency_ms > 1000;

-- =====================================================
-- RESOURCE USAGE METRICS
-- =====================================================

CREATE TABLE IF NOT EXISTS telemetry.resource_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    
    tool_id VARCHAR(255) NOT NULL,
    execution_id VARCHAR(255) NOT NULL,
    
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- CPU metrics
    cpu_percent FLOAT,
    cpu_time_user_ms BIGINT,
    cpu_time_system_ms BIGINT,
    
    -- Memory metrics
    memory_used_mb INTEGER,
    memory_peak_mb INTEGER,
    memory_limit_mb INTEGER,
    
    -- I/O metrics
    disk_read_bytes BIGINT,
    disk_write_bytes BIGINT,
    network_in_bytes BIGINT,
    network_out_bytes BIGINT,
    
    -- GPU metrics (if applicable)
    gpu_percent FLOAT,
    gpu_memory_mb INTEGER,
    
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_resource_metrics_tenant_tool 
    ON telemetry.resource_metrics (tenant_id, tool_id, timestamp DESC);
CREATE INDEX idx_resource_metrics_high_cpu 
    ON telemetry.resource_metrics (cpu_percent) WHERE cpu_percent > 80;
CREATE INDEX idx_resource_metrics_high_memory 
    ON telemetry.resource_metrics (memory_used_mb) WHERE memory_used_mb > 1024;

-- =====================================================
-- DECISION TRACKING
-- =====================================================

CREATE TABLE IF NOT EXISTS telemetry.decision_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    
    chain_id VARCHAR(255) NOT NULL,
    step_id VARCHAR(255) NOT NULL,
    decision_id VARCHAR(255) NOT NULL,
    
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Decision details
    decision_type VARCHAR(100) NOT NULL, -- conditional, branch, retry, fallback
    condition_expression TEXT,
    evaluation_result BOOLEAN,
    branch_taken VARCHAR(255),
    
    -- Input context
    input_values JSONB DEFAULT '{}',
    variables JSONB DEFAULT '{}',
    
    -- Performance
    evaluation_time_ms INTEGER,
    
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_decision_points_tenant_chain 
    ON telemetry.decision_points (tenant_id, chain_id, timestamp DESC);
CREATE INDEX idx_decision_points_type 
    ON telemetry.decision_points (decision_type, evaluation_result);

-- =====================================================
-- OUTPUT CONFIDENCE TRACKING
-- =====================================================

CREATE TABLE IF NOT EXISTS telemetry.confidence_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    
    model_id VARCHAR(255) NOT NULL,
    execution_id VARCHAR(255) NOT NULL,
    
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Confidence metrics
    confidence_score FLOAT NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
    uncertainty_score FLOAT,
    
    -- Prediction details
    prediction_type VARCHAR(100),
    predicted_class VARCHAR(255),
    class_probabilities JSONB,
    
    -- Actual outcome (if available)
    actual_outcome VARCHAR(255),
    feedback_timestamp TIMESTAMPTZ,
    is_correct BOOLEAN,
    
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_confidence_scores_tenant_model 
    ON telemetry.confidence_scores (tenant_id, model_id, timestamp DESC);
CREATE INDEX idx_confidence_scores_low 
    ON telemetry.confidence_scores (confidence_score) WHERE confidence_score < 0.5;
CREATE INDEX idx_confidence_scores_feedback 
    ON telemetry.confidence_scores (feedback_timestamp) WHERE feedback_timestamp IS NOT NULL;

-- =====================================================
-- FEATURE DRIFT MONITORING
-- =====================================================

CREATE TABLE IF NOT EXISTS telemetry.feature_drift (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    
    model_id VARCHAR(255) NOT NULL,
    feature_name VARCHAR(255) NOT NULL,
    
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    
    -- Statistical measures
    baseline_mean DOUBLE PRECISION,
    baseline_stddev DOUBLE PRECISION,
    current_mean DOUBLE PRECISION,
    current_stddev DOUBLE PRECISION,
    
    -- Drift metrics
    kl_divergence DOUBLE PRECISION,
    js_distance DOUBLE PRECISION,
    wasserstein_distance DOUBLE PRECISION,
    population_stability_index DOUBLE PRECISION,
    
    -- Thresholds
    drift_detected BOOLEAN DEFAULT false,
    drift_severity VARCHAR(20), -- low, medium, high, critical
    
    sample_size INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_feature_drift_tenant_model 
    ON telemetry.feature_drift (tenant_id, model_id, timestamp DESC);
CREATE INDEX idx_feature_drift_detected 
    ON telemetry.feature_drift (drift_detected, drift_severity) WHERE drift_detected = true;

-- =====================================================
-- HYPERPARAMETER EVOLUTION
-- =====================================================

CREATE TABLE IF NOT EXISTS telemetry.hyperparameter_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    
    model_id VARCHAR(255) NOT NULL,
    experiment_id VARCHAR(255),
    training_run_id VARCHAR(255),
    
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Hyperparameters
    hyperparameters JSONB NOT NULL,
    
    -- Performance metrics
    training_loss DOUBLE PRECISION,
    validation_loss DOUBLE PRECISION,
    test_metrics JSONB,
    
    -- Comparison with previous
    previous_run_id VARCHAR(255),
    improvement_percent DOUBLE PRECISION,
    
    -- Meta-optimization
    optimization_method VARCHAR(100), -- grid, random, bayesian, evolutionary
    optimization_iteration INTEGER,
    
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_hyperparam_history_tenant_model 
    ON telemetry.hyperparameter_history (tenant_id, model_id, timestamp DESC);
CREATE INDEX idx_hyperparam_history_experiment 
    ON telemetry.hyperparameter_history (experiment_id, optimization_iteration);

-- =====================================================
-- TOOL USAGE ANALYTICS
-- =====================================================

CREATE TABLE IF NOT EXISTS telemetry.tool_usage_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    
    tool_id VARCHAR(255) NOT NULL,
    server_name VARCHAR(255) NOT NULL,
    
    -- Time window
    hour_bucket TIMESTAMPTZ NOT NULL,
    day_bucket DATE NOT NULL,
    
    -- Usage metrics
    invocation_count BIGINT DEFAULT 0,
    success_count BIGINT DEFAULT 0,
    error_count BIGINT DEFAULT 0,
    timeout_count BIGINT DEFAULT 0,
    
    -- Performance
    avg_latency_ms DOUBLE PRECISION,
    p50_latency_ms DOUBLE PRECISION,
    p95_latency_ms DOUBLE PRECISION,
    p99_latency_ms DOUBLE PRECISION,
    
    -- Resource consumption
    total_cpu_seconds DOUBLE PRECISION,
    total_memory_mb_seconds DOUBLE PRECISION,
    
    -- Popularity metrics
    unique_users INTEGER,
    unique_sessions INTEGER,
    chain_participation_count INTEGER,
    
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, tool_id, hour_bucket)
);

CREATE INDEX idx_tool_usage_stats_tenant_time 
    ON telemetry.tool_usage_stats (tenant_id, hour_bucket DESC);
CREATE INDEX idx_tool_usage_stats_popularity 
    ON telemetry.tool_usage_stats (invocation_count DESC, day_bucket);

-- =====================================================
-- BACKPRESSURE MONITORING
-- =====================================================

CREATE TABLE IF NOT EXISTS telemetry.backpressure_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    
    component VARCHAR(255) NOT NULL, -- queue name, service, etc.
    
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Queue metrics
    queue_length INTEGER,
    queue_capacity INTEGER,
    queue_utilization_percent FLOAT,
    
    -- Processing metrics
    processing_rate_per_second DOUBLE PRECISION,
    arrival_rate_per_second DOUBLE PRECISION,
    
    -- Backpressure indicators
    backpressure_detected BOOLEAN DEFAULT false,
    dropped_items INTEGER DEFAULT 0,
    throttle_activated BOOLEAN DEFAULT false,
    
    -- Response
    action_taken VARCHAR(100), -- throttle, scale, drop, buffer
    
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_backpressure_events_tenant_component 
    ON telemetry.backpressure_events (tenant_id, component, timestamp DESC);
CREATE INDEX idx_backpressure_events_detected 
    ON telemetry.backpressure_events (backpressure_detected, timestamp DESC) 
    WHERE backpressure_detected = true;

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE telemetry.aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry.communication_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry.resource_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry.decision_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry.confidence_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry.feature_drift ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry.hyperparameter_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry.tool_usage_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry.backpressure_events ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for tenant isolation
DO $$
DECLARE
    table_name TEXT;
    tables TEXT[] := ARRAY[
        'aggregates',
        'communication_metrics',
        'resource_metrics',
        'decision_points',
        'confidence_scores',
        'feature_drift',
        'hyperparameter_history',
        'tool_usage_stats',
        'backpressure_events'
    ];
BEGIN
    FOREACH table_name IN ARRAY tables
    LOOP
        -- Select policy
        EXECUTE format('
            CREATE POLICY %I ON telemetry.%I
            FOR SELECT
            USING (tenant_id = current_setting(''app.tenant'', true))',
            'tenant_select_' || table_name, table_name
        );
        
        -- Insert policy
        EXECUTE format('
            CREATE POLICY %I ON telemetry.%I
            FOR INSERT
            WITH CHECK (tenant_id = current_setting(''app.tenant'', true))',
            'tenant_insert_' || table_name, table_name
        );
        
        -- Update policy
        EXECUTE format('
            CREATE POLICY %I ON telemetry.%I
            FOR UPDATE
            USING (tenant_id = current_setting(''app.tenant'', true))
            WITH CHECK (tenant_id = current_setting(''app.tenant'', true))',
            'tenant_update_' || table_name, table_name
        );
        
        -- Delete policy
        EXECUTE format('
            CREATE POLICY %I ON telemetry.%I
            FOR DELETE
            USING (tenant_id = current_setting(''app.tenant'', true))',
            'tenant_delete_' || table_name, table_name
        );
    END LOOP;
END $$;

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to calculate time buckets
CREATE OR REPLACE FUNCTION telemetry.calculate_buckets(ts TIMESTAMPTZ)
RETURNS TABLE (
    hour_bucket TIMESTAMPTZ,
    day_bucket DATE,
    week_bucket DATE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        DATE_TRUNC('hour', ts) AS hour_bucket,
        DATE_TRUNC('day', ts)::DATE AS day_bucket,
        DATE_TRUNC('week', ts)::DATE AS week_bucket;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to aggregate percentiles
CREATE OR REPLACE FUNCTION telemetry.calculate_percentiles(values DOUBLE PRECISION[])
RETURNS TABLE (
    p50 DOUBLE PRECISION,
    p90 DOUBLE PRECISION,
    p95 DOUBLE PRECISION,
    p99 DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        percentile_cont(0.50) WITHIN GROUP (ORDER BY unnest) AS p50,
        percentile_cont(0.90) WITHIN GROUP (ORDER BY unnest) AS p90,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY unnest) AS p95,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY unnest) AS p99
    FROM unnest(values);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger to update timestamps
CREATE OR REPLACE FUNCTION telemetry.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update trigger to tables with updated_at
CREATE TRIGGER update_aggregates_updated_at 
    BEFORE UPDATE ON telemetry.aggregates 
    FOR EACH ROW EXECUTE FUNCTION telemetry.update_updated_at();

CREATE TRIGGER update_tool_usage_stats_updated_at 
    BEFORE UPDATE ON telemetry.tool_usage_stats 
    FOR EACH ROW EXECUTE FUNCTION telemetry.update_updated_at();

-- =====================================================
-- GRANTS
-- =====================================================

-- Grant usage on schema
GRANT USAGE ON SCHEMA telemetry TO PUBLIC;

-- Grant appropriate permissions
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA telemetry TO PUBLIC;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA telemetry TO PUBLIC;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON SCHEMA telemetry IS 'ML/DL telemetry aggregates with tenant isolation';
COMMENT ON TABLE telemetry.aggregates IS 'Time-partitioned telemetry aggregates for efficient querying';
COMMENT ON TABLE telemetry.communication_metrics IS 'Inter-step communication latency and data transfer metrics';
COMMENT ON TABLE telemetry.resource_metrics IS 'Resource usage per tool execution';
COMMENT ON TABLE telemetry.decision_points IS 'Decision branch tracking for behavioral analysis';
COMMENT ON TABLE telemetry.confidence_scores IS 'Model output confidence tracking';
COMMENT ON TABLE telemetry.feature_drift IS 'Feature distribution drift monitoring';
COMMENT ON TABLE telemetry.hyperparameter_history IS 'Hyperparameter evolution tracking';
COMMENT ON TABLE telemetry.tool_usage_stats IS 'Tool popularity and usage analytics';
COMMENT ON TABLE telemetry.backpressure_events IS 'System backpressure and congestion monitoring';

COMMIT;

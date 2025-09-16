-- Migration 008: Predictions and Batch Jobs
-- Purpose: Store real-time predictions, batch prediction jobs, and input/output tracking

-- Batch prediction jobs
CREATE TABLE IF NOT EXISTS batch_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    job_name VARCHAR(255) NOT NULL,
    
    -- Job configuration
    model_id UUID REFERENCES model_registry(id) ON DELETE CASCADE,
    model_alias VARCHAR(100), -- Alternative to model_id, use alias like 'production'
    
    -- Input specification
    input_source VARCHAR(50) NOT NULL, -- 'query', 'csv', 'json', 'parquet'
    input_ref TEXT NOT NULL, -- SQL query, file path, or data reference
    input_count INTEGER,
    
    -- Job status
    status VARCHAR(50) NOT NULL DEFAULT 'queued', -- 'queued', 'running', 'completed', 'failed', 'cancelled'
    progress_percent INTEGER DEFAULT 0,
    
    -- Configuration
    batch_size INTEGER DEFAULT 100,
    parallelism INTEGER DEFAULT 1,
    timeout_seconds INTEGER DEFAULT 3600,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    
    -- Results
    predictions_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    output_location TEXT, -- Where results are stored
    
    -- Metadata
    correlation_id VARCHAR(255), -- For tracking related jobs
    request_metadata JSONB DEFAULT '{}',
    error_message TEXT,
    
    -- Timestamps
    queued_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255)
);

-- Individual predictions
CREATE TABLE IF NOT EXISTS predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    
    -- Link to batch job (optional for real-time predictions)
    batch_job_id UUID REFERENCES batch_jobs(id) ON DELETE CASCADE,
    
    -- Model reference
    model_id UUID REFERENCES model_registry(id),
    model_version VARCHAR(50),
    
    -- Input data
    input_ref VARCHAR(255), -- Reference to input entity/record
    input_data JSONB NOT NULL, -- Actual input features
    input_hash VARCHAR(64), -- For deduplication/caching
    
    -- Prediction results
    prediction JSONB NOT NULL, -- Prediction value(s)
    prediction_vector DOUBLE PRECISION[], -- For multi-class or embeddings
    confidence DOUBLE PRECISION, -- Confidence score (0-1)
    
    -- Additional outputs
    probabilities JSONB, -- Class probabilities for classification
    prediction_metadata JSONB DEFAULT '{}', -- Model-specific metadata
    
    -- Performance metrics
    latency_ms INTEGER, -- Prediction latency in milliseconds
    preprocessing_ms INTEGER,
    inference_ms INTEGER,
    postprocessing_ms INTEGER,
    
    -- Tracking
    correlation_id VARCHAR(255),
    session_id VARCHAR(255),
    request_id VARCHAR(255),
    
    -- Feedback (for online learning)
    actual_value JSONB, -- Ground truth when available
    feedback_received_at TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    predicted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Prediction cache for memoization
CREATE TABLE IF NOT EXISTS prediction_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    model_id UUID NOT NULL,
    model_version VARCHAR(50) NOT NULL,
    
    -- Cache key
    input_hash VARCHAR(64) NOT NULL,
    
    -- Cached result
    prediction JSONB NOT NULL,
    confidence DOUBLE PRECISION,
    probabilities JSONB,
    
    -- Cache metadata
    hit_count INTEGER DEFAULT 0,
    last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint for cache key
    UNIQUE(tenant_id, model_id, model_version, input_hash)
);

-- Batch job events for tracking
CREATE TABLE IF NOT EXISTS batch_job_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_job_id UUID NOT NULL REFERENCES batch_jobs(id) ON DELETE CASCADE,
    
    event_type VARCHAR(50) NOT NULL, -- 'started', 'progress', 'completed', 'failed', 'retry'
    event_data JSONB DEFAULT '{}',
    message TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_batch_jobs_tenant ON batch_jobs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON batch_jobs(status);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_model ON batch_jobs(model_id);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_created ON batch_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_correlation ON batch_jobs(correlation_id) WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_predictions_tenant ON predictions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_predictions_batch ON predictions(batch_job_id) WHERE batch_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_predictions_model ON predictions(model_id);
CREATE INDEX IF NOT EXISTS idx_predictions_input_ref ON predictions(input_ref);
CREATE INDEX IF NOT EXISTS idx_predictions_created ON predictions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_correlation ON predictions(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_predictions_session ON predictions(session_id) WHERE session_id IS NOT NULL;

-- Write-time optimized indexes for real-time predictions
CREATE INDEX IF NOT EXISTS idx_predictions_write_time ON predictions(predicted_at DESC, tenant_id);

CREATE INDEX IF NOT EXISTS idx_prediction_cache_lookup ON prediction_cache(tenant_id, model_id, model_version, input_hash);
CREATE INDEX IF NOT EXISTS idx_prediction_cache_expires ON prediction_cache(expires_at) WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_batch_job_events_job ON batch_job_events(batch_job_id);
CREATE INDEX IF NOT EXISTS idx_batch_job_events_created ON batch_job_events(created_at DESC);

-- Row Level Security
ALTER TABLE batch_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_job_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY batch_jobs_tenant_isolation ON batch_jobs
    FOR ALL USING (tenant_id = current_setting('app.tenant', true));

CREATE POLICY predictions_tenant_isolation ON predictions
    FOR ALL USING (tenant_id = current_setting('app.tenant', true));

CREATE POLICY prediction_cache_tenant_isolation ON prediction_cache
    FOR ALL USING (tenant_id = current_setting('app.tenant', true));

CREATE POLICY batch_job_events_tenant_isolation ON batch_job_events
    FOR ALL USING (
        batch_job_id IN (
            SELECT id FROM batch_jobs 
            WHERE tenant_id = current_setting('app.tenant', true)
        )
    );

-- Comments
COMMENT ON TABLE batch_jobs IS 'Batch prediction job tracking and orchestration';
COMMENT ON TABLE predictions IS 'Individual predictions from both real-time and batch inference';
COMMENT ON TABLE prediction_cache IS 'Cache for deterministic model predictions to reduce latency';
COMMENT ON TABLE batch_job_events IS 'Event log for batch job lifecycle tracking';

COMMENT ON COLUMN predictions.input_hash IS 'SHA256 hash of input_data for deduplication and caching';
COMMENT ON COLUMN predictions.prediction_vector IS 'Array representation for multi-dimensional predictions';
COMMENT ON COLUMN prediction_cache.input_hash IS 'SHA256 hash of input for cache key';

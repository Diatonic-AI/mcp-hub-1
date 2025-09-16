-- MCP Hub ML/DL Pipeline Database Setup
-- This script creates all required tables for the training pipeline

-- Create schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS fabric;

-- Set search path
SET search_path TO public, fabric;

-- Create enums for status tracking
DO $$ BEGIN
    CREATE TYPE training_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE batch_job_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Training runs table
CREATE TABLE IF NOT EXISTS training_runs (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    run_name VARCHAR(255) NOT NULL,
    model_name VARCHAR(255) NOT NULL,
    status training_status NOT NULL DEFAULT 'queued',
    config JSONB,
    dataset_info JSONB,
    metrics JSONB,
    hyperparameters JSONB,
    model_artifact_uri TEXT,
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT training_runs_tenant_name_unique UNIQUE (tenant_id, run_name)
);

-- Training events table - Note: using 'timestamp' column name as per code requirement
CREATE TABLE IF NOT EXISTS training_events (
    id SERIAL PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES training_runs(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    event_data JSONB,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),  -- Using 'timestamp' instead of 'created_at'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()  -- Also keeping created_at for compatibility
);

-- Model registry table
CREATE TABLE IF NOT EXISTS models (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    model_name VARCHAR(255) NOT NULL,
    model_version VARCHAR(50),
    model_type VARCHAR(100),
    framework VARCHAR(50),
    status VARCHAR(50) DEFAULT 'active',
    description TEXT,
    config JSONB,
    metrics JSONB,
    tags JSONB,
    artifact_uri TEXT,
    training_run_id INTEGER REFERENCES training_runs(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT models_tenant_name_version_unique UNIQUE (tenant_id, model_name, model_version)
);

-- Evaluation metrics table
CREATE TABLE IF NOT EXISTS evaluation_metrics (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    model_id INTEGER REFERENCES models(id) ON DELETE CASCADE,
    metrics JSONB NOT NULL,
    accuracy DECIMAL(5,4),
    precision_score DECIMAL(5,4),
    recall DECIMAL(5,4),
    f1_score DECIMAL(5,4),
    auc_roc DECIMAL(5,4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Confusion matrices table
CREATE TABLE IF NOT EXISTS confusion_matrices (
    id SERIAL PRIMARY KEY,
    evaluation_id INTEGER NOT NULL REFERENCES evaluation_metrics(id) ON DELETE CASCADE,
    matrix JSONB NOT NULL,
    labels JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Batch jobs table
CREATE TABLE IF NOT EXISTS batch_jobs (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    job_name VARCHAR(255),
    model_id INTEGER REFERENCES models(id),
    status batch_job_status NOT NULL DEFAULT 'pending',
    input_config JSONB,
    output_config JSONB,
    predictions_count INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Predictions table
CREATE TABLE IF NOT EXISTS predictions (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    batch_job_id INTEGER REFERENCES batch_jobs(id) ON DELETE CASCADE,
    model_id INTEGER REFERENCES models(id),
    input_ref VARCHAR(255),
    input_data JSONB,
    prediction JSONB NOT NULL,
    confidence DECIMAL(5,4),
    latency_ms INTEGER,
    predicted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Feature store table
CREATE TABLE IF NOT EXISTS features (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    feature_group VARCHAR(255) NOT NULL,
    feature_name VARCHAR(255) NOT NULL,
    feature_type VARCHAR(50),
    description TEXT,
    schema JSONB,
    statistics JSONB,
    version INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT features_unique UNIQUE (tenant_id, feature_group, feature_name, version)
);

-- Feature values table (for materialized features)
CREATE TABLE IF NOT EXISTS feature_values (
    id SERIAL PRIMARY KEY,
    feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    entity_id VARCHAR(255) NOT NULL,
    value JSONB NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    INDEX idx_feature_values_lookup (feature_id, entity_id, timestamp DESC)
);

-- Experiments table (for A/B testing)
CREATE TABLE IF NOT EXISTS experiments (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    experiment_name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'draft',
    config JSONB,
    variants JSONB,
    metrics_config JSONB,
    started_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT experiments_unique UNIQUE (tenant_id, experiment_name)
);

-- Experiment results table
CREATE TABLE IF NOT EXISTS experiment_results (
    id SERIAL PRIMARY KEY,
    experiment_id INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    variant_id VARCHAR(100) NOT NULL,
    metric_name VARCHAR(255) NOT NULL,
    metric_value DECIMAL,
    sample_size INTEGER,
    confidence_level DECIMAL(5,4),
    p_value DECIMAL(10,9),
    is_significant BOOLEAN,
    measured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Model drift monitoring table
CREATE TABLE IF NOT EXISTS model_drift_metrics (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    metric_type VARCHAR(100) NOT NULL, -- 'data_drift', 'prediction_drift', 'performance_drift'
    metric_name VARCHAR(255) NOT NULL,
    baseline_value DECIMAL,
    current_value DECIMAL,
    drift_score DECIMAL,
    threshold DECIMAL,
    is_drifted BOOLEAN DEFAULT false,
    alert_sent BOOLEAN DEFAULT false,
    measured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Training datasets metadata
CREATE TABLE IF NOT EXISTS datasets (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    dataset_name VARCHAR(255) NOT NULL,
    dataset_type VARCHAR(50), -- 'training', 'validation', 'test'
    version VARCHAR(50),
    description TEXT,
    source_uri TEXT,
    format VARCHAR(50),
    size_bytes BIGINT,
    row_count INTEGER,
    column_count INTEGER,
    schema JSONB,
    statistics JSONB,
    splits JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT datasets_unique UNIQUE (tenant_id, dataset_name, version)
);

-- Hyperparameter optimization runs
CREATE TABLE IF NOT EXISTS hpo_runs (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    study_name VARCHAR(255) NOT NULL,
    algorithm VARCHAR(50), -- 'grid_search', 'random_search', 'bayesian', 'hyperband'
    objective_metric VARCHAR(100),
    objective_direction VARCHAR(10), -- 'minimize' or 'maximize'
    search_space JSONB,
    best_params JSONB,
    best_value DECIMAL,
    n_trials INTEGER,
    status VARCHAR(50) DEFAULT 'running',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- HPO trials
CREATE TABLE IF NOT EXISTS hpo_trials (
    id SERIAL PRIMARY KEY,
    hpo_run_id INTEGER NOT NULL REFERENCES hpo_runs(id) ON DELETE CASCADE,
    trial_number INTEGER NOT NULL,
    params JSONB NOT NULL,
    objective_value DECIMAL,
    intermediate_values JSONB,
    state VARCHAR(50), -- 'running', 'completed', 'pruned', 'failed'
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_training_runs_tenant ON training_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_training_runs_status ON training_runs(status);
CREATE INDEX IF NOT EXISTS idx_training_runs_created ON training_runs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_training_events_run ON training_events(run_id);
CREATE INDEX IF NOT EXISTS idx_training_events_type ON training_events(event_type);
CREATE INDEX IF NOT EXISTS idx_training_events_timestamp ON training_events(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_models_tenant ON models(tenant_id);
CREATE INDEX IF NOT EXISTS idx_models_name ON models(model_name);
CREATE INDEX IF NOT EXISTS idx_models_status ON models(status);

CREATE INDEX IF NOT EXISTS idx_evaluation_metrics_model ON evaluation_metrics(model_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_metrics_tenant ON evaluation_metrics(tenant_id);

CREATE INDEX IF NOT EXISTS idx_batch_jobs_tenant ON batch_jobs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON batch_jobs(status);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_model ON batch_jobs(model_id);

CREATE INDEX IF NOT EXISTS idx_predictions_batch ON predictions(batch_job_id);
CREATE INDEX IF NOT EXISTS idx_predictions_model ON predictions(model_id);
CREATE INDEX IF NOT EXISTS idx_predictions_tenant ON predictions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_predictions_time ON predictions(predicted_at DESC);

CREATE INDEX IF NOT EXISTS idx_features_lookup ON features(tenant_id, feature_group, feature_name);
CREATE INDEX IF NOT EXISTS idx_features_active ON features(is_active);

CREATE INDEX IF NOT EXISTS idx_experiments_tenant ON experiments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status);

CREATE INDEX IF NOT EXISTS idx_drift_model ON model_drift_metrics(model_id);
CREATE INDEX IF NOT EXISTS idx_drift_type ON model_drift_metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_drift_alert ON model_drift_metrics(is_drifted, alert_sent);

CREATE INDEX IF NOT EXISTS idx_datasets_tenant ON datasets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_datasets_name ON datasets(dataset_name);

CREATE INDEX IF NOT EXISTS idx_hpo_runs_tenant ON hpo_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_hpo_runs_study ON hpo_runs(study_name);
CREATE INDEX IF NOT EXISTS idx_hpo_trials_run ON hpo_trials(hpo_run_id);

-- Create update trigger for updated_at columns
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update trigger to tables with updated_at column
DROP TRIGGER IF EXISTS update_training_runs_updated_at ON training_runs;
CREATE TRIGGER update_training_runs_updated_at BEFORE UPDATE ON training_runs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_models_updated_at ON models;
CREATE TRIGGER update_models_updated_at BEFORE UPDATE ON models
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_batch_jobs_updated_at ON batch_jobs;
CREATE TRIGGER update_batch_jobs_updated_at BEFORE UPDATE ON batch_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_features_updated_at ON features;
CREATE TRIGGER update_features_updated_at BEFORE UPDATE ON features
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_experiments_updated_at ON experiments;
CREATE TRIGGER update_experiments_updated_at BEFORE UPDATE ON experiments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_datasets_updated_at ON datasets;
CREATE TRIGGER update_datasets_updated_at BEFORE UPDATE ON datasets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions to mcp_hub user
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO mcp_hub;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO mcp_hub;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO mcp_hub;
GRANT ALL PRIVILEGES ON SCHEMA fabric TO mcp_hub;

-- Add comment to tables
COMMENT ON TABLE training_runs IS 'Stores ML model training run metadata and results';
COMMENT ON TABLE training_events IS 'Event log for training runs with timestamp column for code compatibility';
COMMENT ON TABLE models IS 'Model registry for versioned ML models';
COMMENT ON TABLE evaluation_metrics IS 'Model evaluation metrics and scores';
COMMENT ON TABLE batch_jobs IS 'Batch prediction job tracking';
COMMENT ON TABLE predictions IS 'Individual predictions from batch jobs';
COMMENT ON TABLE features IS 'Feature store metadata';
COMMENT ON TABLE feature_values IS 'Materialized feature values';
COMMENT ON TABLE experiments IS 'A/B testing experiment configurations';
COMMENT ON TABLE experiment_results IS 'A/B testing experiment results';
COMMENT ON TABLE model_drift_metrics IS 'Model drift monitoring metrics';
COMMENT ON TABLE datasets IS 'Training dataset metadata';
COMMENT ON TABLE hpo_runs IS 'Hyperparameter optimization study runs';
COMMENT ON TABLE hpo_trials IS 'Individual trials within HPO runs';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'ML/DL Pipeline tables created successfully!';
    RAISE NOTICE 'Note: training_events table uses "timestamp" column as required by the code';
END $$;

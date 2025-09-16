-- Migration 006: Training Runs Tables
-- Purpose: Track training jobs, experiments, and artifacts

-- Create enum for training status
DO $$ BEGIN
    CREATE TYPE training_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Training runs main table
CREATE TABLE IF NOT EXISTS training_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    run_name VARCHAR(255) NOT NULL,
    experiment_id VARCHAR(255),
    
    -- Model information
    model_name VARCHAR(255) NOT NULL,
    model_version VARCHAR(50),
    framework VARCHAR(50),
    
    -- Status tracking
    status training_status DEFAULT 'queued',
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    
    -- Configuration
    config JSONB DEFAULT '{}', -- Training configuration
    hyperparameters JSONB DEFAULT '{}',
    dataset_info JSONB DEFAULT '{}', -- Dataset metadata
    
    -- Resources
    resources JSONB DEFAULT '{}', -- GPU, memory, etc.
    distributed BOOLEAN DEFAULT FALSE,
    worker_count INTEGER DEFAULT 1,
    
    -- Results
    metrics JSONB DEFAULT '{}', -- Training metrics
    evaluation_metrics JSONB DEFAULT '{}', -- Validation metrics
    best_checkpoint VARCHAR(255),
    
    -- Storage
    artifacts_uri TEXT, -- Base path for artifacts
    logs_uri TEXT, -- Training logs location
    checkpoints JSONB DEFAULT '[]', -- List of checkpoint paths
    
    -- Error handling
    error_message TEXT,
    error_details JSONB,
    retry_count INTEGER DEFAULT 0,
    
    -- Lineage
    parent_run_id UUID REFERENCES training_runs(id),
    child_runs JSONB DEFAULT '[]', -- For HPO trials
    
    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Training artifacts table
CREATE TABLE IF NOT EXISTS training_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES training_runs(id) ON DELETE CASCADE,
    artifact_type VARCHAR(50) NOT NULL, -- 'model', 'checkpoint', 'logs', 'visualization'
    artifact_name VARCHAR(255) NOT NULL,
    artifact_uri TEXT NOT NULL,
    size_bytes BIGINT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_run_artifact UNIQUE (run_id, artifact_name)
);

-- Training events/logs table for detailed tracking
CREATE TABLE IF NOT EXISTS training_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES training_runs(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL, -- 'epoch', 'checkpoint', 'validation', 'error'
    event_data JSONB NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    sequence_number INTEGER NOT NULL
);

-- Hyperparameter studies for organized experiments
CREATE TABLE IF NOT EXISTS hpo_studies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    study_name VARCHAR(255) NOT NULL,
    algorithm VARCHAR(50), -- 'grid', 'random', 'bayesian', 'optuna'
    objective VARCHAR(50), -- 'minimize', 'maximize'
    metric_name VARCHAR(255),
    
    -- Configuration
    search_space JSONB NOT NULL,
    max_trials INTEGER,
    parallel_trials INTEGER DEFAULT 1,
    
    -- Status
    status training_status DEFAULT 'queued',
    trials_completed INTEGER DEFAULT 0,
    best_trial_id UUID,
    best_value DOUBLE PRECISION,
    
    -- Timing
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    
    CONSTRAINT unique_study_name UNIQUE (tenant_id, study_name)
);

-- Link training runs to HPO studies
ALTER TABLE training_runs 
    ADD COLUMN IF NOT EXISTS hpo_study_id UUID REFERENCES hpo_studies(id),
    ADD COLUMN IF NOT EXISTS trial_number INTEGER;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_training_runs_tenant ON training_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_training_runs_model ON training_runs(model_name);
CREATE INDEX IF NOT EXISTS idx_training_runs_status ON training_runs(status);
CREATE INDEX IF NOT EXISTS idx_training_runs_created ON training_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_training_runs_experiment ON training_runs(experiment_id);
CREATE INDEX IF NOT EXISTS idx_training_runs_hpo ON training_runs(hpo_study_id);
CREATE INDEX IF NOT EXISTS idx_training_artifacts_run ON training_artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_training_events_run ON training_events(run_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_hpo_studies_tenant ON hpo_studies(tenant_id);

-- Row Level Security
ALTER TABLE training_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hpo_studies ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY training_runs_tenant_isolation ON training_runs
    FOR ALL USING (tenant_id = current_setting('app.tenant', true));

CREATE POLICY training_artifacts_tenant_isolation ON training_artifacts
    FOR ALL USING (
        run_id IN (
            SELECT id FROM training_runs 
            WHERE tenant_id = current_setting('app.tenant', true)
        )
    );

CREATE POLICY training_events_tenant_isolation ON training_events
    FOR ALL USING (
        run_id IN (
            SELECT id FROM training_runs 
            WHERE tenant_id = current_setting('app.tenant', true)
        )
    );

CREATE POLICY hpo_studies_tenant_isolation ON hpo_studies
    FOR ALL USING (tenant_id = current_setting('app.tenant', true));

-- Update trigger for training_runs
CREATE TRIGGER update_training_runs_updated_at 
    BEFORE UPDATE ON training_runs 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE training_runs IS 'Tracks ML model training runs with full lineage and metrics';
COMMENT ON TABLE training_artifacts IS 'Stores references to training artifacts in object storage';
COMMENT ON TABLE training_events IS 'Detailed event log for training runs';
COMMENT ON TABLE hpo_studies IS 'Hyperparameter optimization study management';

-- Migration 005: Model Registry Tables
-- Purpose: Create model registry for versioning, lifecycle management, and metadata storage

-- Create enum for model stages
DO $$ BEGIN
    CREATE TYPE model_stage AS ENUM ('development', 'staging', 'production', 'archived');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Create enum for model frameworks
DO $$ BEGIN
    CREATE TYPE model_framework AS ENUM ('tensorflow', 'pytorch', 'scikit-learn', 'xgboost', 'lightgbm', 'custom');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Model registry main table
CREATE TABLE IF NOT EXISTS model_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL,
    stage model_stage DEFAULT 'development',
    framework model_framework,
    description TEXT,
    
    -- Model metadata
    params JSONB DEFAULT '{}',
    metrics JSONB DEFAULT '{}',
    tags JSONB DEFAULT '[]',
    
    -- Storage references
    artifact_uri TEXT, -- GridFS reference: gridfs://db/bucket/objectId
    model_size_bytes BIGINT,
    
    -- Lineage
    parent_model_id UUID REFERENCES model_registry(id),
    training_run_id UUID, -- Will reference training_runs table
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    
    -- Constraints
    CONSTRAINT unique_model_version UNIQUE (tenant_id, name, version)
);

-- Model tags table for flexible tagging
CREATE TABLE IF NOT EXISTS model_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id UUID NOT NULL REFERENCES model_registry(id) ON DELETE CASCADE,
    tag_key VARCHAR(255) NOT NULL,
    tag_value TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_model_tag UNIQUE (model_id, tag_key)
);

-- Model aliases for easy reference (e.g., "latest", "champion")
CREATE TABLE IF NOT EXISTS model_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    alias VARCHAR(255) NOT NULL,
    model_id UUID NOT NULL REFERENCES model_registry(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    
    CONSTRAINT unique_alias UNIQUE (tenant_id, alias)
);

-- Model stage transitions for audit trail
CREATE TABLE IF NOT EXISTS model_stage_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id UUID NOT NULL REFERENCES model_registry(id) ON DELETE CASCADE,
    from_stage model_stage,
    to_stage model_stage NOT NULL,
    reason TEXT,
    transitioned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    transitioned_by VARCHAR(255)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_model_registry_tenant ON model_registry(tenant_id);
CREATE INDEX IF NOT EXISTS idx_model_registry_name ON model_registry(name);
CREATE INDEX IF NOT EXISTS idx_model_registry_stage ON model_registry(stage);
CREATE INDEX IF NOT EXISTS idx_model_registry_created ON model_registry(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_registry_parent ON model_registry(parent_model_id);
CREATE INDEX IF NOT EXISTS idx_model_tags_model ON model_tags(model_id);
CREATE INDEX IF NOT EXISTS idx_model_aliases_tenant ON model_aliases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_model_transitions_model ON model_stage_transitions(model_id);

-- Row Level Security
ALTER TABLE model_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_stage_transitions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY model_registry_tenant_isolation ON model_registry
    FOR ALL USING (tenant_id = current_setting('app.tenant', true));

CREATE POLICY model_tags_tenant_isolation ON model_tags
    FOR ALL USING (
        model_id IN (
            SELECT id FROM model_registry 
            WHERE tenant_id = current_setting('app.tenant', true)
        )
    );

CREATE POLICY model_aliases_tenant_isolation ON model_aliases
    FOR ALL USING (tenant_id = current_setting('app.tenant', true));

CREATE POLICY model_transitions_tenant_isolation ON model_stage_transitions
    FOR ALL USING (
        model_id IN (
            SELECT id FROM model_registry 
            WHERE tenant_id = current_setting('app.tenant', true)
        )
    );

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_model_registry_updated_at 
    BEFORE UPDATE ON model_registry 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE model_registry IS 'Central registry for ML models with versioning and lifecycle management';
COMMENT ON COLUMN model_registry.stage IS 'Model lifecycle stage: development, staging, production, archived';
COMMENT ON COLUMN model_registry.artifact_uri IS 'GridFS reference for model artifacts stored in MongoDB';
COMMENT ON COLUMN model_registry.params IS 'Model hyperparameters and configuration';
COMMENT ON COLUMN model_registry.metrics IS 'Model evaluation metrics';

-- ML/DL Pipeline Schema Setup for MCP Hub
-- Creates the ML-specific schemas if they don't exist

-- Create ML Operations schema
CREATE SCHEMA IF NOT EXISTS ml_ops;

-- Create ML Models schema  
CREATE SCHEMA IF NOT EXISTS ml_models;

-- Create ML Training schema
CREATE SCHEMA IF NOT EXISTS ml_training;

-- Create ML Features schema
CREATE SCHEMA IF NOT EXISTS ml_features;

-- Grant permissions
GRANT ALL ON SCHEMA ml_ops TO mcp_hub_app;
GRANT ALL ON SCHEMA ml_models TO mcp_hub_app;
GRANT ALL ON SCHEMA ml_training TO mcp_hub_app;
GRANT ALL ON SCHEMA ml_features TO mcp_hub_app;

-- Create basic ML tables in ml_ops schema
SET search_path TO ml_ops;

-- Model Registry table
CREATE TABLE IF NOT EXISTS model_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL,
    framework VARCHAR(100),
    model_type VARCHAR(100),
    description TEXT,
    metadata JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    UNIQUE(name, version)
);

-- Training Runs table
CREATE TABLE IF NOT EXISTS training_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id UUID REFERENCES model_registry(id),
    experiment_name VARCHAR(255),
    status VARCHAR(50) DEFAULT 'pending',
    hyperparameters JSONB DEFAULT '{}',
    metrics JSONB DEFAULT '{}',
    artifacts JSONB DEFAULT '{}',
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255)
);

-- Feature Registry table
CREATE TABLE IF NOT EXISTS feature_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    feature_type VARCHAR(100),
    source_table VARCHAR(255),
    transformation TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Models table
CREATE TABLE IF NOT EXISTS models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL,
    model_type VARCHAR(100),
    framework VARCHAR(100),
    file_path TEXT,
    metadata JSONB DEFAULT '{}',
    performance_metrics JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, version)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_model_registry_name ON model_registry(name);
CREATE INDEX IF NOT EXISTS idx_model_registry_status ON model_registry(status);
CREATE INDEX IF NOT EXISTS idx_training_runs_model ON training_runs(model_id);
CREATE INDEX IF NOT EXISTS idx_training_runs_status ON training_runs(status);
CREATE INDEX IF NOT EXISTS idx_feature_registry_name ON feature_registry(name);

-- Reset search path
RESET search_path;

-- Verify schemas were created
SELECT schema_name 
FROM information_schema.schemata 
WHERE schema_name LIKE 'ml_%' 
ORDER BY schema_name;
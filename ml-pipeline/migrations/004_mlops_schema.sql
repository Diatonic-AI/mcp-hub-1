-- Migration: Create MLOps Schema and Feature Registry
-- Version: 004
-- Description: Feature engineering pipeline with registry, materialization tracking, and lineage

BEGIN;

-- =====================================================
-- SCHEMAS
-- =====================================================

-- Create mlops schema for ML pipeline operations
CREATE SCHEMA IF NOT EXISTS mlops;

-- =====================================================
-- FEATURE REGISTRY TABLES
-- =====================================================

-- Feature set definitions with versioning
CREATE TABLE IF NOT EXISTS mlops.feature_set (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    
    -- Identity and versioning
    name VARCHAR(255) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    description TEXT,
    
    -- Feature specification (declarative YAML/JSON)
    spec JSONB NOT NULL,
    
    -- Metadata
    owner VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'deprecated', 'archived')),
    
    -- Lineage
    parent_version_id UUID REFERENCES mlops.feature_set(id),
    source_tables TEXT[], -- telemetry tables used
    
    -- Quality metrics
    validation_rules JSONB DEFAULT '{}',
    quality_score FLOAT,
    
    -- Unique constraint per tenant
    UNIQUE(tenant_id, name, version)
);

-- Feature materialization tracking
CREATE TABLE IF NOT EXISTS mlops.feature_materialization (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    
    feature_set_id UUID NOT NULL REFERENCES mlops.feature_set(id) ON DELETE CASCADE,
    
    -- Materialization configuration
    mode VARCHAR(20) NOT NULL CHECK (mode IN ('offline', 'online', 'both')),
    schedule VARCHAR(100), -- cron expression or 'realtime'
    
    -- Execution tracking
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    duration_ms INTEGER,
    
    -- Status tracking
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    error_message TEXT,
    
    -- Statistics
    rows_processed BIGINT,
    rows_failed BIGINT,
    
    -- Details and configuration
    details JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Feature statistics and profiling
CREATE TABLE IF NOT EXISTS mlops.feature_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    
    feature_set_id UUID NOT NULL REFERENCES mlops.feature_set(id) ON DELETE CASCADE,
    
    -- Temporal dimension
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    window_start TIMESTAMPTZ,
    window_end TIMESTAMPTZ,
    
    -- Statistics per feature
    stats JSONB NOT NULL, -- {feature_name: {mean, std, min, max, nulls, unique, distribution}}
    
    -- Data quality metrics
    completeness FLOAT, -- % non-null
    consistency FLOAT,  -- % passing validation
    timeliness FLOAT,   -- % within freshness SLA
    
    -- Drift detection
    drift_detected BOOLEAN DEFAULT false,
    drift_metrics JSONB,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Feature lineage tracking
CREATE TABLE IF NOT EXISTS mlops.feature_lineage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    
    feature_set_id UUID NOT NULL REFERENCES mlops.feature_set(id) ON DELETE CASCADE,
    
    -- Upstream dependencies
    upstream_table VARCHAR(255) NOT NULL,
    upstream_columns TEXT[],
    
    -- Downstream features
    downstream_feature VARCHAR(255) NOT NULL,
    
    -- Transformation details
    transformation_type VARCHAR(100), -- aggregate, derive, encode, normalize
    transformation_spec JSONB,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Feature cache metadata (for online serving)
CREATE TABLE IF NOT EXISTS mlops.feature_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    
    feature_set_id UUID NOT NULL REFERENCES mlops.feature_set(id) ON DELETE CASCADE,
    entity_id VARCHAR(255) NOT NULL,
    
    -- Cache management
    feature_vector JSONB NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ,
    
    -- Version tracking
    feature_version INTEGER NOT NULL,
    
    -- Performance metrics
    computation_time_ms INTEGER,
    cache_hits INTEGER DEFAULT 0,
    last_accessed_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique per entity and feature set
    UNIQUE(tenant_id, feature_set_id, entity_id)
);

-- =====================================================
-- MATERIALIZED VIEWS MANAGEMENT
-- =====================================================

-- Track materialized views created for features
CREATE TABLE IF NOT EXISTS mlops.feature_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    
    feature_set_id UUID NOT NULL REFERENCES mlops.feature_set(id) ON DELETE CASCADE,
    
    -- View metadata
    view_name VARCHAR(255) NOT NULL,
    view_type VARCHAR(20) CHECK (view_type IN ('view', 'materialized_view', 'table')),
    
    -- SQL definition
    view_sql TEXT NOT NULL,
    
    -- Refresh configuration
    refresh_method VARCHAR(20) CHECK (refresh_method IN ('complete', 'incremental', 'append')),
    last_refreshed_at TIMESTAMPTZ,
    refresh_duration_ms INTEGER,
    
    -- Storage statistics
    size_bytes BIGINT,
    row_count BIGINT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    dropped_at TIMESTAMPTZ,
    
    UNIQUE(tenant_id, view_name)
);

-- =====================================================
-- INDEXES
-- =====================================================

-- Feature set indexes
CREATE INDEX idx_feature_set_tenant_name ON mlops.feature_set(tenant_id, name, version DESC);
CREATE INDEX idx_feature_set_status ON mlops.feature_set(status) WHERE status = 'active';
CREATE INDEX idx_feature_set_owner ON mlops.feature_set(owner);

-- Materialization indexes
CREATE INDEX idx_feature_mat_tenant_set ON mlops.feature_materialization(tenant_id, feature_set_id);
CREATE INDEX idx_feature_mat_status ON mlops.feature_materialization(status) WHERE status IN ('running', 'failed');
CREATE INDEX idx_feature_mat_schedule ON mlops.feature_materialization(next_run_at) WHERE next_run_at IS NOT NULL;

-- Stats indexes
CREATE INDEX idx_feature_stats_tenant_set ON mlops.feature_stats(tenant_id, feature_set_id, snapshot_at DESC);
CREATE INDEX idx_feature_stats_drift ON mlops.feature_stats(drift_detected) WHERE drift_detected = true;

-- Cache indexes
CREATE INDEX idx_feature_cache_tenant_entity ON mlops.feature_cache(tenant_id, entity_id);
CREATE INDEX idx_feature_cache_expires ON mlops.feature_cache(expires_at) WHERE expires_at IS NOT NULL;

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE mlops.feature_set ENABLE ROW LEVEL SECURITY;
ALTER TABLE mlops.feature_materialization ENABLE ROW LEVEL SECURITY;
ALTER TABLE mlops.feature_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE mlops.feature_lineage ENABLE ROW LEVEL SECURITY;
ALTER TABLE mlops.feature_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE mlops.feature_views ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for tenant isolation
DO $$
DECLARE
    table_name TEXT;
    tables TEXT[] := ARRAY[
        'feature_set',
        'feature_materialization',
        'feature_stats',
        'feature_lineage',
        'feature_cache',
        'feature_views'
    ];
BEGIN
    FOREACH table_name IN ARRAY tables
    LOOP
        -- Select policy
        EXECUTE format('
            CREATE POLICY %I ON mlops.%I
            FOR SELECT
            USING (tenant_id = current_setting(''app.tenant'', true))',
            'tenant_select_' || table_name, table_name
        );
        
        -- Insert policy
        EXECUTE format('
            CREATE POLICY %I ON mlops.%I
            FOR INSERT
            WITH CHECK (tenant_id = current_setting(''app.tenant'', true))',
            'tenant_insert_' || table_name, table_name
        );
        
        -- Update policy
        EXECUTE format('
            CREATE POLICY %I ON mlops.%I
            FOR UPDATE
            USING (tenant_id = current_setting(''app.tenant'', true))
            WITH CHECK (tenant_id = current_setting(''app.tenant'', true))',
            'tenant_update_' || table_name, table_name
        );
        
        -- Delete policy
        EXECUTE format('
            CREATE POLICY %I ON mlops.%I
            FOR DELETE
            USING (tenant_id = current_setting(''app.tenant'', true))',
            'tenant_delete_' || table_name, table_name
        );
    END LOOP;
END $$;

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to compile feature spec to SQL
CREATE OR REPLACE FUNCTION mlops.compile_feature_spec(spec JSONB)
RETURNS TEXT AS $$
DECLARE
    compiled_sql TEXT;
    feature_name TEXT;
    source_table TEXT;
    aggregations JSONB;
BEGIN
    -- Extract base configuration
    feature_name := spec->>'name';
    source_table := spec->>'source';
    aggregations := spec->'aggregations';
    
    -- Start building SQL
    compiled_sql := format('CREATE MATERIALIZED VIEW IF NOT EXISTS mlops.features_%s AS ', feature_name);
    compiled_sql := compiled_sql || format('SELECT tenant_id, entity_id, ');
    
    -- Add aggregations
    IF aggregations IS NOT NULL THEN
        -- Add each aggregation
        FOR agg IN SELECT * FROM jsonb_array_elements(aggregations)
        LOOP
            compiled_sql := compiled_sql || format('%s(%s) AS %s, ',
                agg->>'function',
                agg->>'column',
                agg->>'alias'
            );
        END LOOP;
    END IF;
    
    -- Complete SQL
    compiled_sql := rtrim(compiled_sql, ', ');
    compiled_sql := compiled_sql || format(' FROM %s GROUP BY tenant_id, entity_id', source_table);
    
    RETURN compiled_sql;
END;
$$ LANGUAGE plpgsql;

-- Function to refresh feature materialization
CREATE OR REPLACE FUNCTION mlops.refresh_feature_materialization(mat_id UUID)
RETURNS VOID AS $$
DECLARE
    mat_record RECORD;
    view_name TEXT;
    start_time TIMESTAMPTZ;
    duration_ms INTEGER;
BEGIN
    start_time := clock_timestamp();
    
    -- Get materialization details
    SELECT fm.*, fs.name, fs.version
    INTO mat_record
    FROM mlops.feature_materialization fm
    JOIN mlops.feature_set fs ON fm.feature_set_id = fs.id
    WHERE fm.id = mat_id;
    
    -- Update status to running
    UPDATE mlops.feature_materialization
    SET status = 'running', last_run_at = NOW()
    WHERE id = mat_id;
    
    -- Build view name
    view_name := format('features_%s_v%s', mat_record.name, mat_record.version);
    
    -- Refresh the materialized view
    EXECUTE format('REFRESH MATERIALIZED VIEW mlops.%I', view_name);
    
    -- Calculate duration
    duration_ms := EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time));
    
    -- Update status to completed
    UPDATE mlops.feature_materialization
    SET status = 'completed',
        duration_ms = duration_ms,
        rows_processed = (
            SELECT COUNT(*) 
            FROM mlops.feature_cache 
            WHERE feature_set_id = mat_record.feature_set_id
        )
    WHERE id = mat_id;
    
EXCEPTION WHEN OTHERS THEN
    -- Update status to failed
    UPDATE mlops.feature_materialization
    SET status = 'failed',
        error_message = SQLERRM
    WHERE id = mat_id;
    RAISE;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update timestamps
CREATE OR REPLACE FUNCTION mlops.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update triggers
CREATE TRIGGER update_feature_set_updated_at 
    BEFORE UPDATE ON mlops.feature_set 
    FOR EACH ROW EXECUTE FUNCTION mlops.update_updated_at();

CREATE TRIGGER update_feature_mat_updated_at 
    BEFORE UPDATE ON mlops.feature_materialization 
    FOR EACH ROW EXECUTE FUNCTION mlops.update_updated_at();

-- =====================================================
-- GRANTS
-- =====================================================

-- Grant usage on schema
GRANT USAGE ON SCHEMA mlops TO PUBLIC;

-- Grant appropriate permissions
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA mlops TO PUBLIC;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA mlops TO PUBLIC;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON SCHEMA mlops IS 'ML Operations schema for feature engineering and model lifecycle';
COMMENT ON TABLE mlops.feature_set IS 'Feature set definitions with versioning and specifications';
COMMENT ON TABLE mlops.feature_materialization IS 'Feature materialization jobs and schedules';
COMMENT ON TABLE mlops.feature_stats IS 'Feature statistics and data quality metrics';
COMMENT ON TABLE mlops.feature_lineage IS 'Feature lineage and transformation tracking';
COMMENT ON TABLE mlops.feature_cache IS 'Online feature cache for low-latency serving';
COMMENT ON TABLE mlops.feature_views IS 'Materialized views created for feature sets';

COMMIT;

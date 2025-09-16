-- Migration 009: Experiments and A/B Testing
-- Purpose: Store experiments, assignments, exposures, outcomes, and analysis support

-- Experiments catalog
CREATE TABLE IF NOT EXISTS ab_experiments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Experiment configuration
    seed BIGINT NOT NULL DEFAULT 12345,
    unit_type VARCHAR(50) NOT NULL DEFAULT 'user', -- 'user', 'session', 'account'
    namespace VARCHAR(100), -- Optional namespace for hashing isolation
    variants JSONB NOT NULL, -- [{name:"A", weight:0.5}, {name:"B", weight:0.5}]
    traffic_allocation DOUBLE PRECISION DEFAULT 1.0, -- 0..1
    
    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'draft', -- 'draft','running','paused','stopped','completed','archived'
    start_at TIMESTAMP WITH TIME ZONE,
    end_at TIMESTAMP WITH TIME ZONE,
    
    -- Metrics configuration
    primary_metric VARCHAR(255),
    secondary_metrics JSONB DEFAULT '[]',
    minimum_sample_size INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Assignments: deterministic hashing by unit id and seed
CREATE TABLE IF NOT EXISTS ab_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    experiment_id UUID NOT NULL REFERENCES ab_experiments(id) ON DELETE CASCADE,
    
    unit_id VARCHAR(255) NOT NULL, -- userId/accountId/etc
    variant VARCHAR(100) NOT NULL,
    
    -- Deterministic hash keys
    assignment_hash VARCHAR(64) NOT NULL,
    
    -- Metadata
    context JSONB DEFAULT '{}',
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, experiment_id, unit_id)
);

-- Exposures: when a unit is exposed to a variant (impressions)
CREATE TABLE IF NOT EXISTS ab_exposures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    experiment_id UUID NOT NULL REFERENCES ab_experiments(id) ON DELETE CASCADE,
    unit_id VARCHAR(255) NOT NULL,
    variant VARCHAR(100) NOT NULL,
    
    exposure_context JSONB DEFAULT '{}',
    occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Outcomes: actions attributable to experiment exposure (conversions, revenue, etc.)
CREATE TABLE IF NOT EXISTS ab_outcomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    experiment_id UUID NOT NULL REFERENCES ab_experiments(id) ON DELETE CASCADE,
    unit_id VARCHAR(255) NOT NULL,
    variant VARCHAR(100) NOT NULL,
    
    metric VARCHAR(255) NOT NULL, -- e.g., 'conversion', 'revenue'
    value DOUBLE PRECISION NOT NULL DEFAULT 0,
    
    outcome_context JSONB DEFAULT '{}',
    occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Analysis snapshots (optional)
CREATE TABLE IF NOT EXISTS ab_analysis_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    experiment_id UUID NOT NULL REFERENCES ab_experiments(id) ON DELETE CASCADE,
    
    snapshot_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    summary JSONB NOT NULL, -- precomputed stats (lift, intervals, winners)
    details JSONB DEFAULT '{}'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ab_experiments_tenant ON ab_experiments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ab_experiments_status ON ab_experiments(status);
CREATE INDEX IF NOT EXISTS idx_ab_experiments_dates ON ab_experiments(start_at, end_at);

CREATE INDEX IF NOT EXISTS idx_ab_assignments_tenant ON ab_assignments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ab_assignments_experiment ON ab_assignments(experiment_id);
CREATE INDEX IF NOT EXISTS idx_ab_assignments_unit ON ab_assignments(unit_id);

CREATE INDEX IF NOT EXISTS idx_ab_exposures_tenant ON ab_exposures(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ab_exposures_experiment ON ab_exposures(experiment_id);
CREATE INDEX IF NOT EXISTS idx_ab_exposures_unit ON ab_exposures(unit_id);
CREATE INDEX IF NOT EXISTS idx_ab_exposures_variant ON ab_exposures(variant);

CREATE INDEX IF NOT EXISTS idx_ab_outcomes_tenant ON ab_outcomes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ab_outcomes_experiment ON ab_outcomes(experiment_id);
CREATE INDEX IF NOT EXISTS idx_ab_outcomes_metric ON ab_outcomes(metric);

CREATE INDEX IF NOT EXISTS idx_ab_analysis_snapshots_experiment ON ab_analysis_snapshots(experiment_id);

-- Row Level Security
ALTER TABLE ab_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ab_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ab_exposures ENABLE ROW LEVEL SECURITY;
ALTER TABLE ab_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ab_analysis_snapshots ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY ab_experiments_tenant_isolation ON ab_experiments
    FOR ALL USING (tenant_id = current_setting('app.tenant', true));

CREATE POLICY ab_assignments_tenant_isolation ON ab_assignments
    FOR ALL USING (tenant_id = current_setting('app.tenant', true));

CREATE POLICY ab_exposures_tenant_isolation ON ab_exposures
    FOR ALL USING (tenant_id = current_setting('app.tenant', true));

CREATE POLICY ab_outcomes_tenant_isolation ON ab_outcomes
    FOR ALL USING (tenant_id = current_setting('app.tenant', true));

CREATE POLICY ab_analysis_snapshots_tenant_isolation ON ab_analysis_snapshots
    FOR ALL USING (tenant_id = current_setting('app.tenant', true));

-- Comments
COMMENT ON TABLE ab_experiments IS 'A/B experiment catalog with variant configuration and lifecycle';
COMMENT ON TABLE ab_assignments IS 'Deterministic variant assignments by unit and seed';
COMMENT ON TABLE ab_exposures IS 'Exposure events when a unit sees a variant';
COMMENT ON TABLE ab_outcomes IS 'Outcome events attributable to variants (metrics)';
COMMENT ON TABLE ab_analysis_snapshots IS 'Precomputed analysis snapshots for experiment performance';


-- Migration 010: Monitoring, Drift Detection, and Alerts
-- Purpose: Store data drift, performance drift, alerts, and monitoring rollups

-- Data drift monitoring
CREATE TABLE IF NOT EXISTS data_drift (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    model_id UUID REFERENCES model_registry(id) ON DELETE CASCADE,
    
    -- Drift metrics
    drift_type VARCHAR(50) NOT NULL, -- 'feature', 'prediction', 'label'
    metric_name VARCHAR(100) NOT NULL, -- 'psi', 'kl_divergence', 'wasserstein', 'jensen_shannon'
    metric_value DOUBLE PRECISION NOT NULL,
    
    -- Reference and comparison windows
    reference_window_start TIMESTAMP WITH TIME ZONE,
    reference_window_end TIMESTAMP WITH TIME ZONE,
    comparison_window_start TIMESTAMP WITH TIME ZONE,
    comparison_window_end TIMESTAMP WITH TIME ZONE,
    
    -- Feature-specific drift
    feature_name VARCHAR(255), -- NULL for overall drift
    feature_statistics JSONB DEFAULT '{}', -- Mean, std, min, max, quartiles
    
    -- Distribution data
    reference_distribution JSONB, -- Histogram or density
    comparison_distribution JSONB,
    
    -- Thresholds and alerting
    threshold_value DOUBLE PRECISION,
    is_drifted BOOLEAN DEFAULT false,
    severity VARCHAR(20), -- 'low', 'medium', 'high', 'critical'
    
    -- Metadata
    sample_size_reference INTEGER,
    sample_size_comparison INTEGER,
    
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Performance drift monitoring
CREATE TABLE IF NOT EXISTS performance_drift (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    model_id UUID REFERENCES model_registry(id) ON DELETE CASCADE,
    
    -- Performance metrics
    metric_name VARCHAR(100) NOT NULL, -- 'accuracy', 'precision', 'recall', 'f1', 'auc', 'mse', 'mae'
    baseline_value DOUBLE PRECISION NOT NULL,
    current_value DOUBLE PRECISION NOT NULL,
    drift_value DOUBLE PRECISION NOT NULL, -- Difference or ratio
    
    -- Time windows
    baseline_window_start TIMESTAMP WITH TIME ZONE,
    baseline_window_end TIMESTAMP WITH TIME ZONE,
    current_window_start TIMESTAMP WITH TIME ZONE,
    current_window_end TIMESTAMP WITH TIME ZONE,
    
    -- Statistical significance
    p_value DOUBLE PRECISION,
    confidence_interval_lower DOUBLE PRECISION,
    confidence_interval_upper DOUBLE PRECISION,
    is_significant BOOLEAN DEFAULT false,
    
    -- Thresholds and alerting
    threshold_value DOUBLE PRECISION,
    is_degraded BOOLEAN DEFAULT false,
    severity VARCHAR(20), -- 'low', 'medium', 'high', 'critical'
    
    -- Metadata
    sample_size_baseline INTEGER,
    sample_size_current INTEGER,
    
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Alerts and notifications
CREATE TABLE IF NOT EXISTS monitoring_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    
    -- Alert source
    alert_type VARCHAR(50) NOT NULL, -- 'data_drift', 'performance_drift', 'latency', 'error_rate', 'availability'
    source_id UUID, -- Reference to drift table or other source
    model_id UUID REFERENCES model_registry(id) ON DELETE CASCADE,
    
    -- Alert details
    alert_name VARCHAR(255) NOT NULL,
    alert_message TEXT NOT NULL,
    severity VARCHAR(20) NOT NULL, -- 'info', 'warning', 'error', 'critical'
    
    -- Alert status
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'acknowledged', 'resolved', 'suppressed'
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    acknowledged_by VARCHAR(255),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by VARCHAR(255),
    
    -- Alert metadata
    alert_data JSONB DEFAULT '{}',
    recommended_actions JSONB DEFAULT '[]',
    
    -- Notification tracking
    notifications_sent JSONB DEFAULT '[]', -- Array of notification channels and timestamps
    
    triggered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Daily monitoring rollups
CREATE TABLE IF NOT EXISTS monitoring_daily_rollups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    model_id UUID REFERENCES model_registry(id) ON DELETE CASCADE,
    rollup_date DATE NOT NULL,
    
    -- Aggregated metrics
    total_predictions INTEGER DEFAULT 0,
    total_errors INTEGER DEFAULT 0,
    error_rate DOUBLE PRECISION,
    
    -- Latency statistics
    latency_p50 INTEGER, -- milliseconds
    latency_p95 INTEGER,
    latency_p99 INTEGER,
    latency_mean DOUBLE PRECISION,
    
    -- Performance metrics
    accuracy DOUBLE PRECISION,
    precision_score DOUBLE PRECISION,
    recall DOUBLE PRECISION,
    f1_score DOUBLE PRECISION,
    
    -- Cache statistics
    cache_hits INTEGER DEFAULT 0,
    cache_misses INTEGER DEFAULT 0,
    cache_hit_rate DOUBLE PRECISION,
    
    -- Data quality
    missing_features_count INTEGER DEFAULT 0,
    invalid_inputs_count INTEGER DEFAULT 0,
    
    -- Resource usage
    cpu_usage_percent DOUBLE PRECISION,
    memory_usage_mb INTEGER,
    
    -- Detailed metrics
    hourly_metrics JSONB DEFAULT '{}', -- Hour-by-hour breakdown
    feature_statistics JSONB DEFAULT '{}', -- Per-feature stats
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint for one rollup per model per day
    UNIQUE(tenant_id, model_id, rollup_date)
);

-- Alert rules configuration
CREATE TABLE IF NOT EXISTS alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    rule_name VARCHAR(255) NOT NULL,
    
    -- Rule configuration
    is_enabled BOOLEAN DEFAULT true,
    alert_type VARCHAR(50) NOT NULL,
    model_id UUID REFERENCES model_registry(id) ON DELETE CASCADE,
    
    -- Conditions
    metric_name VARCHAR(100) NOT NULL,
    operator VARCHAR(20) NOT NULL, -- 'gt', 'gte', 'lt', 'lte', 'eq', 'neq'
    threshold_value DOUBLE PRECISION NOT NULL,
    
    -- Time window
    window_size_minutes INTEGER DEFAULT 60,
    evaluation_frequency_minutes INTEGER DEFAULT 5,
    
    -- Alert configuration
    severity VARCHAR(20) NOT NULL DEFAULT 'warning',
    notification_channels JSONB DEFAULT '[]', -- ['email', 'slack', 'webhook']
    
    -- Cooldown to prevent alert fatigue
    cooldown_minutes INTEGER DEFAULT 30,
    last_triggered_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_data_drift_tenant ON data_drift(tenant_id);
CREATE INDEX IF NOT EXISTS idx_data_drift_model ON data_drift(model_id);
CREATE INDEX IF NOT EXISTS idx_data_drift_detected ON data_drift(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_drift_severity ON data_drift(severity) WHERE is_drifted = true;

CREATE INDEX IF NOT EXISTS idx_performance_drift_tenant ON performance_drift(tenant_id);
CREATE INDEX IF NOT EXISTS idx_performance_drift_model ON performance_drift(model_id);
CREATE INDEX IF NOT EXISTS idx_performance_drift_detected ON performance_drift(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_performance_drift_severity ON performance_drift(severity) WHERE is_degraded = true;

CREATE INDEX IF NOT EXISTS idx_monitoring_alerts_tenant ON monitoring_alerts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_alerts_model ON monitoring_alerts(model_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_alerts_status ON monitoring_alerts(status);
CREATE INDEX IF NOT EXISTS idx_monitoring_alerts_triggered ON monitoring_alerts(triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitoring_alerts_severity ON monitoring_alerts(severity) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_monitoring_daily_rollups_tenant ON monitoring_daily_rollups(tenant_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_daily_rollups_model ON monitoring_daily_rollups(model_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_daily_rollups_date ON monitoring_daily_rollups(rollup_date DESC);

CREATE INDEX IF NOT EXISTS idx_alert_rules_tenant ON alert_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_model ON alert_rules(model_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(is_enabled) WHERE is_enabled = true;

-- Row Level Security
ALTER TABLE data_drift ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_drift ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitoring_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitoring_daily_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY data_drift_tenant_isolation ON data_drift
    FOR ALL USING (tenant_id = current_setting('app.tenant', true));

CREATE POLICY performance_drift_tenant_isolation ON performance_drift
    FOR ALL USING (tenant_id = current_setting('app.tenant', true));

CREATE POLICY monitoring_alerts_tenant_isolation ON monitoring_alerts
    FOR ALL USING (tenant_id = current_setting('app.tenant', true));

CREATE POLICY monitoring_daily_rollups_tenant_isolation ON monitoring_daily_rollups
    FOR ALL USING (tenant_id = current_setting('app.tenant', true));

CREATE POLICY alert_rules_tenant_isolation ON alert_rules
    FOR ALL USING (tenant_id = current_setting('app.tenant', true));

-- Comments
COMMENT ON TABLE data_drift IS 'Feature and prediction distribution drift monitoring';
COMMENT ON TABLE performance_drift IS 'Model performance degradation monitoring';
COMMENT ON TABLE monitoring_alerts IS 'System-generated alerts for drift and performance issues';
COMMENT ON TABLE monitoring_daily_rollups IS 'Daily aggregated monitoring metrics for models';
COMMENT ON TABLE alert_rules IS 'Configurable alert rules for automatic monitoring';

COMMENT ON COLUMN data_drift.metric_name IS 'PSI: Population Stability Index, KL: Kullback-Leibler divergence, etc.';
COMMENT ON COLUMN performance_drift.p_value IS 'Statistical significance of performance change';
COMMENT ON COLUMN monitoring_daily_rollups.rollup_date IS 'Date of the rollup (UTC)';

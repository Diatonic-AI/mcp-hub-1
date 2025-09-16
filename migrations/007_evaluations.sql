-- Migration 007: Evaluation Metrics Tables
-- Purpose: Store model evaluation results, confusion matrices, and performance metrics

-- Evaluation metrics main table
CREATE TABLE IF NOT EXISTS evaluation_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    model_id UUID REFERENCES model_registry(id) ON DELETE CASCADE,
    run_id UUID REFERENCES training_runs(id) ON DELETE CASCADE,
    
    -- Evaluation context
    evaluation_name VARCHAR(255),
    evaluation_type VARCHAR(50), -- 'validation', 'test', 'cross_validation', 'holdout'
    dataset_name VARCHAR(255),
    dataset_version VARCHAR(50),
    
    -- Core metrics
    metrics JSONB NOT NULL DEFAULT '{}', -- Flexible metric storage
    
    -- Classification metrics
    accuracy DOUBLE PRECISION,
    precision_score DOUBLE PRECISION,
    recall DOUBLE PRECISION,
    f1_score DOUBLE PRECISION,
    auc_roc DOUBLE PRECISION,
    auc_pr DOUBLE PRECISION,
    log_loss DOUBLE PRECISION,
    
    -- Regression metrics
    mse DOUBLE PRECISION,
    rmse DOUBLE PRECISION,
    mae DOUBLE PRECISION,
    r2_score DOUBLE PRECISION,
    mape DOUBLE PRECISION,
    
    -- Additional metrics
    custom_metrics JSONB DEFAULT '{}',
    
    -- Metadata
    evaluation_config JSONB DEFAULT '{}',
    sample_count INTEGER,
    evaluation_duration_seconds INTEGER,
    
    -- Timestamps
    evaluated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Confusion matrices for classification models
CREATE TABLE IF NOT EXISTS confusion_matrices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evaluation_id UUID NOT NULL REFERENCES evaluation_metrics(id) ON DELETE CASCADE,
    
    -- Matrix data
    matrix JSONB NOT NULL, -- 2D array of confusion matrix
    labels JSONB NOT NULL, -- Class labels
    
    -- Derived metrics per class
    per_class_metrics JSONB DEFAULT '{}', -- Precision, recall, F1 per class
    
    -- Visualization
    normalized_matrix JSONB, -- Normalized confusion matrix
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Threshold analysis for binary classification
CREATE TABLE IF NOT EXISTS threshold_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evaluation_id UUID NOT NULL REFERENCES evaluation_metrics(id) ON DELETE CASCADE,
    
    -- Threshold data
    thresholds JSONB NOT NULL, -- Array of thresholds
    precision_values JSONB NOT NULL, -- Precision at each threshold
    recall_values JSONB NOT NULL, -- Recall at each threshold
    f1_values JSONB NOT NULL, -- F1 at each threshold
    
    -- Optimal thresholds
    optimal_threshold_f1 DOUBLE PRECISION,
    optimal_threshold_balanced DOUBLE PRECISION,
    optimal_threshold_precision DOUBLE PRECISION,
    optimal_threshold_recall DOUBLE PRECISION,
    
    -- ROC and PR curve data
    fpr JSONB, -- False positive rates
    tpr JSONB, -- True positive rates
    pr_precision JSONB, -- Precision values for PR curve
    pr_recall JSONB, -- Recall values for PR curve
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Feature importance tracking
CREATE TABLE IF NOT EXISTS feature_importance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evaluation_id UUID NOT NULL REFERENCES evaluation_metrics(id) ON DELETE CASCADE,
    
    -- Feature importance data
    feature_names JSONB NOT NULL,
    importance_values JSONB NOT NULL,
    importance_type VARCHAR(50), -- 'gain', 'weight', 'cover', 'shap', 'permutation'
    
    -- Top features
    top_features JSONB DEFAULT '[]', -- Top N important features
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Model comparison table
CREATE TABLE IF NOT EXISTS model_comparisons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    comparison_name VARCHAR(255) NOT NULL,
    
    -- Models being compared
    model_ids JSONB NOT NULL, -- Array of model IDs
    evaluation_ids JSONB NOT NULL, -- Array of evaluation IDs
    
    -- Comparison results
    winner_model_id UUID,
    comparison_metrics JSONB NOT NULL,
    statistical_tests JSONB DEFAULT '{}', -- T-tests, etc.
    
    -- Metadata
    comparison_config JSONB DEFAULT '{}',
    notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_evaluation_metrics_tenant ON evaluation_metrics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_metrics_model ON evaluation_metrics(model_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_metrics_run ON evaluation_metrics(run_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_metrics_created ON evaluation_metrics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_confusion_matrices_eval ON confusion_matrices(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_threshold_analysis_eval ON threshold_analysis(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_feature_importance_eval ON feature_importance(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_model_comparisons_tenant ON model_comparisons(tenant_id);

-- Row Level Security
ALTER TABLE evaluation_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE confusion_matrices ENABLE ROW LEVEL SECURITY;
ALTER TABLE threshold_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_importance ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_comparisons ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY evaluation_metrics_tenant_isolation ON evaluation_metrics
    FOR ALL USING (tenant_id = current_setting('app.tenant', true));

CREATE POLICY confusion_matrices_tenant_isolation ON confusion_matrices
    FOR ALL USING (
        evaluation_id IN (
            SELECT id FROM evaluation_metrics 
            WHERE tenant_id = current_setting('app.tenant', true)
        )
    );

CREATE POLICY threshold_analysis_tenant_isolation ON threshold_analysis
    FOR ALL USING (
        evaluation_id IN (
            SELECT id FROM evaluation_metrics 
            WHERE tenant_id = current_setting('app.tenant', true)
        )
    );

CREATE POLICY feature_importance_tenant_isolation ON feature_importance
    FOR ALL USING (
        evaluation_id IN (
            SELECT id FROM evaluation_metrics 
            WHERE tenant_id = current_setting('app.tenant', true)
        )
    );

CREATE POLICY model_comparisons_tenant_isolation ON model_comparisons
    FOR ALL USING (tenant_id = current_setting('app.tenant', true));

-- Comments
COMMENT ON TABLE evaluation_metrics IS 'Stores model evaluation results and performance metrics';
COMMENT ON TABLE confusion_matrices IS 'Confusion matrices for classification model evaluations';
COMMENT ON TABLE threshold_analysis IS 'Threshold analysis for binary classification optimization';
COMMENT ON TABLE feature_importance IS 'Feature importance scores from model evaluations';
COMMENT ON TABLE model_comparisons IS 'Comparative analysis between multiple models';

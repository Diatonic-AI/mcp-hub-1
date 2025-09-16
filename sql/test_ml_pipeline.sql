-- Test ML/DL Pipeline Functionality
-- ===================================

\echo '🧪 Testing ML/DL Pipeline Database Setup'
\echo '========================================'
\echo ''

-- Test 1: Create a test training run
\echo '📊 Test 1: Creating a training run...'
INSERT INTO training_runs (
    id,
    tenant_id,
    model_name,
    model_version,
    framework,
    status,
    parameters,
    hyperparameters,
    created_at,
    started_at
) VALUES (
    gen_random_uuid(),
    'test-tenant',
    'test-model',
    '1.0.0',
    'pytorch',
    'running',
    '{"batch_size": 32, "epochs": 100}'::jsonb,
    '{"learning_rate": 0.001, "optimizer": "adam"}'::jsonb,
    NOW(),
    NOW()
) RETURNING id, model_name, status;

\echo ''

-- Test 2: Add training events
\echo '📈 Test 2: Adding training events...'
WITH run AS (
    SELECT id FROM training_runs 
    WHERE model_name = 'test-model' 
    ORDER BY created_at DESC 
    LIMIT 1
)
INSERT INTO training_events (
    id,
    training_run_id,
    epoch,
    batch,
    metrics,
    timestamp
) 
SELECT 
    gen_random_uuid(),
    run.id,
    epoch_num,
    1,
    jsonb_build_object(
        'loss', 0.5 - (epoch_num * 0.01),
        'accuracy', 0.6 + (epoch_num * 0.01),
        'val_loss', 0.45 - (epoch_num * 0.008),
        'val_accuracy', 0.65 + (epoch_num * 0.008)
    ),
    NOW() + (epoch_num || ' seconds')::interval
FROM run, generate_series(1, 5) AS epoch_num
RETURNING epoch, (metrics->>'loss')::float as loss, (metrics->>'accuracy')::float as accuracy;

\echo ''

-- Test 3: Create a dataset entry
\echo '💾 Test 3: Creating dataset entry...'
INSERT INTO datasets (
    id,
    tenant_id,
    name,
    version,
    description,
    format,
    location,
    size_bytes,
    row_count,
    feature_count,
    metadata,
    created_at
) VALUES (
    gen_random_uuid(),
    'test-tenant',
    'test-dataset',
    '1.0.0',
    'Test dataset for ML pipeline validation',
    'parquet',
    's3://ml-datasets/test-dataset-v1.parquet',
    1048576,
    10000,
    50,
    '{"source": "synthetic", "split": {"train": 0.8, "val": 0.1, "test": 0.1}}'::jsonb,
    NOW()
) RETURNING id, name, row_count, feature_count;

\echo ''

-- Test 4: Create an experiment
\echo '🔬 Test 4: Creating experiment...'
INSERT INTO experiments (
    id,
    tenant_id,
    name,
    description,
    hypothesis,
    status,
    config,
    tags,
    created_at
) VALUES (
    gen_random_uuid(),
    'test-tenant',
    'baseline-experiment',
    'Baseline model performance test',
    'Default hyperparameters should achieve >80% accuracy',
    'running',
    '{"model_type": "neural_network", "layers": 3}'::jsonb,
    ARRAY['baseline', 'test', 'neural-network'],
    NOW()
) RETURNING id, name, status;

\echo ''

-- Test 5: Add evaluation metrics
\echo '📏 Test 5: Adding evaluation metrics...'
WITH run AS (
    SELECT id FROM training_runs 
    WHERE model_name = 'test-model' 
    ORDER BY created_at DESC 
    LIMIT 1
)
INSERT INTO evaluation_metrics (
    id,
    model_id,
    tenant_id,
    dataset_name,
    accuracy,
    precision_score,
    recall,
    f1_score,
    auc_roc,
    metrics,
    evaluated_at
) VALUES (
    gen_random_uuid(),
    (SELECT id FROM run),
    'test-tenant',
    'test-dataset',
    0.85,
    0.83,
    0.87,
    0.85,
    0.92,
    '{"confusion_matrix": [[850, 150], [130, 870]], "threshold": 0.5}'::jsonb,
    NOW()
) RETURNING accuracy, precision_score, recall, f1_score, auc_roc;

\echo ''

-- Test 6: Create a batch prediction job
\echo '🔮 Test 6: Creating batch prediction job...'
INSERT INTO batch_jobs (
    id,
    tenant_id,
    job_type,
    model_id,
    status,
    input_location,
    output_location,
    total_items,
    processed_items,
    created_at,
    started_at
) VALUES (
    gen_random_uuid(),
    'test-tenant',
    'batch_prediction',
    (SELECT id FROM training_runs WHERE model_name = 'test-model' LIMIT 1),
    'running',
    's3://ml-data/input/batch-001.parquet',
    's3://ml-data/output/predictions-001.parquet',
    1000,
    500,
    NOW(),
    NOW()
) RETURNING id, job_type, status, processed_items || '/' || total_items as progress;

\echo ''

-- Test 7: Add feature definitions
\echo '🎯 Test 7: Adding feature definitions...'
INSERT INTO features (
    id,
    tenant_id,
    name,
    feature_type,
    data_type,
    description,
    importance,
    statistics,
    is_active,
    created_at
) VALUES 
    (gen_random_uuid(), 'test-tenant', 'age', 'numerical', 'integer', 'User age in years', 0.75, 
     '{"mean": 35, "std": 12, "min": 18, "max": 80}'::jsonb, true, NOW()),
    (gen_random_uuid(), 'test-tenant', 'income', 'numerical', 'float', 'Annual income in USD', 0.82,
     '{"mean": 75000, "std": 25000, "min": 20000, "max": 500000}'::jsonb, true, NOW()),
    (gen_random_uuid(), 'test-tenant', 'category', 'categorical', 'string', 'User category', 0.65,
     '{"unique_values": 5, "most_common": "A"}'::jsonb, true, NOW())
RETURNING name, feature_type, importance;

\echo ''

-- Test 8: Create HPO run
\echo '🔧 Test 8: Creating hyperparameter optimization run...'
INSERT INTO hpo_runs (
    id,
    tenant_id,
    study_name,
    algorithm,
    objective_metric,
    optimization_direction,
    status,
    search_space,
    best_params,
    best_value,
    created_at
) VALUES (
    gen_random_uuid(),
    'test-tenant',
    'test-hpo-study',
    'optuna-tpe',
    'validation_accuracy',
    'maximize',
    'running',
    '{"learning_rate": [0.0001, 0.1], "batch_size": [16, 128], "dropout": [0.1, 0.5]}'::jsonb,
    '{"learning_rate": 0.001, "batch_size": 32, "dropout": 0.2}'::jsonb,
    0.89,
    NOW()
) RETURNING id, study_name, algorithm, best_value;

\echo ''

-- Test 9: Verify table counts and relationships
\echo '📊 Test 9: Verifying data integrity...'
SELECT 
    'training_runs' as table_name, COUNT(*) as count FROM training_runs
UNION ALL
SELECT 'training_events', COUNT(*) FROM training_events
UNION ALL
SELECT 'datasets', COUNT(*) FROM datasets
UNION ALL
SELECT 'experiments', COUNT(*) FROM experiments
UNION ALL
SELECT 'evaluation_metrics', COUNT(*) FROM evaluation_metrics
UNION ALL
SELECT 'batch_jobs', COUNT(*) FROM batch_jobs
UNION ALL
SELECT 'features', COUNT(*) FROM features
UNION ALL
SELECT 'hpo_runs', COUNT(*) FROM hpo_runs
ORDER BY table_name;

\echo ''

-- Test 10: Test complex query with joins
\echo '🔍 Test 10: Testing complex query with joins...'
SELECT 
    tr.model_name,
    tr.model_version,
    tr.status as training_status,
    COUNT(DISTINCT te.id) as event_count,
    AVG((te.metrics->>'loss')::float) as avg_loss,
    MAX((te.metrics->>'accuracy')::float) as max_accuracy
FROM training_runs tr
LEFT JOIN training_events te ON tr.id = te.training_run_id
WHERE tr.tenant_id = 'test-tenant'
GROUP BY tr.id, tr.model_name, tr.model_version, tr.status;

\echo ''
\echo '✅ ML/DL Pipeline test completed successfully!'

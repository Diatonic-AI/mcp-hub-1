-- Test ML/DL Pipeline Functionality (Fixed)
-- ==========================================

\echo '🧪 Testing ML/DL Pipeline Database Setup'
\echo '========================================'
\echo ''

-- Test 1: Create a test training run
\echo '📊 Test 1: Creating a training run...'
INSERT INTO training_runs (
    id,
    tenant_id,
    run_name,
    model_name,
    model_version,
    framework,
    status,
    config,
    hyperparameters,
    started_at
) VALUES (
    gen_random_uuid(),
    'test-tenant',
    'test-run-001',
    'test-model',
    '1.0.0',
    'pytorch',
    'running',
    '{"batch_size": 32, "epochs": 100}'::jsonb,
    '{"learning_rate": 0.001, "optimizer": "adam"}'::jsonb,
    NOW()
) RETURNING id, model_name, status;

\echo ''

-- Test 2: Add training events  
\echo '📈 Test 2: Adding training events...'
WITH run AS (
    SELECT id FROM training_runs 
    WHERE model_name = 'test-model' 
    ORDER BY started_at DESC 
    LIMIT 1
)
INSERT INTO training_events (
    id,
    run_id,
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

-- Test 3: Create an experiment
\echo '🔬 Test 3: Creating experiment...'
INSERT INTO experiments (
    id,
    tenant_id,
    experiment_name,
    description,
    status,
    config,
    created_at
) VALUES (
    gen_random_uuid(),
    'test-tenant',
    'baseline-experiment',
    'Baseline model performance test',
    'active',
    '{"model_type": "neural_network", "layers": 3}'::jsonb,
    NOW()
) RETURNING id, experiment_name, status;

\echo ''

-- Test 4: Add evaluation metrics
\echo '📏 Test 4: Adding evaluation metrics...'
WITH run AS (
    SELECT id FROM training_runs 
    WHERE model_name = 'test-model' 
    ORDER BY started_at DESC 
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

-- Test 5: Create a batch prediction job
\echo '🔮 Test 5: Creating batch prediction job...'
INSERT INTO batch_jobs (
    id,
    tenant_id,
    model_id,
    status,
    input_uri,
    output_uri,
    created_at,
    started_at
) VALUES (
    gen_random_uuid(),
    'test-tenant',
    (SELECT id FROM training_runs WHERE model_name = 'test-model' LIMIT 1),
    'running',
    's3://ml-data/input/batch-001.parquet',
    's3://ml-data/output/predictions-001.parquet',
    NOW(),
    NOW()
) RETURNING id, status, input_uri;

\echo ''

-- Test 6: Add predictions
\echo '🎯 Test 6: Adding sample predictions...'
WITH batch AS (
    SELECT id FROM batch_jobs 
    ORDER BY created_at DESC 
    LIMIT 1
)
INSERT INTO predictions (
    id,
    batch_job_id,
    model_id,
    tenant_id,
    input_data,
    prediction,
    probability,
    predicted_at
) 
SELECT 
    gen_random_uuid(),
    batch.id,
    (SELECT id FROM training_runs WHERE model_name = 'test-model' LIMIT 1),
    'test-tenant',
    jsonb_build_object('feature1', random(), 'feature2', random()),
    CASE WHEN random() > 0.5 THEN 'class_a' ELSE 'class_b' END,
    random(),
    NOW() + (i || ' milliseconds')::interval
FROM batch, generate_series(1, 5) AS i
RETURNING prediction, probability;

\echo ''

-- Test 7: Verify table counts and relationships
\echo '📊 Test 7: Verifying data integrity...'
SELECT 
    'training_runs' as table_name, COUNT(*) as count FROM training_runs
UNION ALL
SELECT 'training_events', COUNT(*) FROM training_events
UNION ALL
SELECT 'experiments', COUNT(*) FROM experiments
UNION ALL
SELECT 'evaluation_metrics', COUNT(*) FROM evaluation_metrics
UNION ALL
SELECT 'batch_jobs', COUNT(*) FROM batch_jobs
UNION ALL
SELECT 'predictions', COUNT(*) FROM predictions
ORDER BY table_name;

\echo ''

-- Test 8: Test complex query with joins
\echo '🔍 Test 8: Testing complex query with joins...'
SELECT 
    tr.model_name,
    tr.model_version,
    tr.status as training_status,
    COUNT(DISTINCT te.id) as event_count,
    AVG((te.metrics->>'loss')::float) as avg_loss,
    MAX((te.metrics->>'accuracy')::float) as max_accuracy
FROM training_runs tr
LEFT JOIN training_events te ON tr.id = te.run_id
WHERE tr.tenant_id = 'test-tenant'
GROUP BY tr.id, tr.model_name, tr.model_version, tr.status;

\echo ''

-- Test 9: Check latest metrics
\echo '📈 Test 9: Checking latest training metrics...'
SELECT 
    te.epoch,
    te.metrics->>'loss' as loss,
    te.metrics->>'accuracy' as accuracy,
    te.metrics->>'val_loss' as val_loss,
    te.metrics->>'val_accuracy' as val_accuracy
FROM training_events te
JOIN training_runs tr ON tr.id = te.run_id
WHERE tr.model_name = 'test-model'
ORDER BY te.epoch DESC
LIMIT 3;

\echo ''

-- Test 10: Cleanup test data
\echo '🧹 Test 10: Cleaning up test data...'
DELETE FROM predictions WHERE tenant_id = 'test-tenant';
DELETE FROM evaluation_metrics WHERE tenant_id = 'test-tenant';
DELETE FROM batch_jobs WHERE tenant_id = 'test-tenant';
DELETE FROM training_events WHERE run_id IN (SELECT id FROM training_runs WHERE tenant_id = 'test-tenant');
DELETE FROM experiments WHERE tenant_id = 'test-tenant';
DELETE FROM training_runs WHERE tenant_id = 'test-tenant';

SELECT 'Cleanup complete - test data removed' as status;

\echo ''
\echo '✅ ML/DL Pipeline test completed successfully!'

# PostgreSQL Migrations for MCP Hub ML/DL Pipeline

## Overview

This directory contains PostgreSQL database migrations for the MCP Hub ML/DL pipeline infrastructure. All migrations follow a numbered sequence and include tenant isolation via Row Level Security (RLS).

## Migration Files

### Core Infrastructure (001-004)
- **001_initial_schema.sql** - Base tables and structures
- **003_ml_telemetry_aggregates.sql** - Telemetry and metrics aggregation

### ML/DL Pipeline Schema (005-010)
- **005_model_registry.sql** - Model registry, versions, stages, and aliases
- **006_training_runs.sql** - Training job tracking, artifacts, and hyperparameter studies
- **007_evaluations.sql** - Evaluation metrics, confusion matrices, and model comparisons
- **008_predictions.sql** - Real-time predictions, batch jobs, and prediction caching
- **009_experiments.sql** - A/B testing framework with deterministic assignment
- **010_monitoring.sql** - Drift detection, performance monitoring, and alerting

## Running Migrations

### Prerequisites

1. PostgreSQL database connection configured in `.env`:
```bash
POSTGRES_URL=postgresql://user:pass@host:5432/database
DEFAULT_TENANT=your_tenant_id
```

2. Ensure database connectors are set up:
```bash
npm install  # Install dependencies including pg
```

### Migration Commands

#### Run all migrations
```bash
node scripts/run-migrations.js
```

#### Dry run (preview without applying)
```bash
node scripts/run-migrations.js --dry-run
```

#### Run specific range of migrations
```bash
# Run migrations 005 through 010
node scripts/run-migrations.js --from=005 --to=010
```

#### Manual execution (development only)
```bash
# Connect to database
psql $POSTGRES_URL

# Set tenant context (required for RLS)
SET app.tenant = 'your_tenant_id';

# Execute migration
\i migrations/005_model_registry.sql
```

## Tenant Isolation

All tables use Row Level Security (RLS) for multi-tenant isolation:

1. **Set tenant context** before any operations:
```sql
SET app.tenant = 'tenant_123';
```

2. **RLS policies** automatically filter data by tenant:
- Direct tenant_id columns filter by `current_setting('app.tenant')`
- Related tables use subqueries to maintain isolation
- No cross-tenant data access is possible

## Schema Overview

### Model Registry (005)
- **model_registry** - Core model metadata and versioning
- **model_tags** - Flexible tagging system
- **model_aliases** - Named references (e.g., 'production')
- **model_stage_transitions** - Stage change audit log

### Training Infrastructure (006)
- **training_runs** - Job execution tracking
- **training_artifacts** - Output files and metrics
- **training_events** - Lifecycle event log
- **hyperparameter_studies** - HPO sweep management

### Evaluation System (007)
- **evaluation_metrics** - Core performance metrics
- **confusion_matrices** - Classification analysis
- **threshold_analysis** - Binary classification optimization
- **feature_importance** - Model interpretability
- **model_comparisons** - A/B model testing

### Prediction Pipeline (008)
- **batch_jobs** - Batch prediction orchestration
- **predictions** - Individual prediction records
- **prediction_cache** - Memoization for deterministic models
- **batch_job_events** - Job lifecycle tracking

### Experimentation (009)
- **ab_experiments** - Experiment configuration
- **ab_assignments** - Deterministic variant assignment
- **ab_exposures** - Impression tracking
- **ab_outcomes** - Conversion/metric tracking
- **ab_analysis_snapshots** - Precomputed statistics

### Monitoring (010)
- **data_drift** - Feature distribution monitoring
- **performance_drift** - Model degradation detection
- **monitoring_alerts** - Alert generation and tracking
- **monitoring_daily_rollups** - Aggregated metrics
- **alert_rules** - Configurable alert conditions

## Best Practices

1. **Always use transactions** when running migrations manually
2. **Test migrations** in development before production
3. **Backup database** before major schema changes
4. **Monitor migration history** table for applied migrations
5. **Use tenant context** consistently in application code

## Rollback Procedures

If a migration needs to be rolled back:

1. Create a rollback migration with next number
2. Include DROP statements in reverse order
3. Update migration_history to mark as rolled back
4. Test thoroughly in development first

Example rollback:
```sql
-- Migration 011_rollback_monitoring.sql
DROP TABLE IF EXISTS alert_rules CASCADE;
DROP TABLE IF EXISTS monitoring_daily_rollups CASCADE;
DROP TABLE IF EXISTS monitoring_alerts CASCADE;
DROP TABLE IF EXISTS performance_drift CASCADE;
DROP TABLE IF EXISTS data_drift CASCADE;

-- Mark as rolled back
UPDATE migration_history 
SET migration_name = migration_name || '_rolled_back'
WHERE migration_name = '010_monitoring.sql';
```

## Validation

After running migrations, validate the schema:

```bash
# Check all tables exist
psql $POSTGRES_URL -c "\dt"

# Check RLS is enabled
psql $POSTGRES_URL -c "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE '%model%' OR tablename LIKE '%training%';"

# Test tenant isolation
psql $POSTGRES_URL << EOF
SET app.tenant = 'test_tenant_1';
INSERT INTO model_registry (tenant_id, name, version) VALUES ('test_tenant_1', 'test_model', 'v1');

SET app.tenant = 'test_tenant_2';
SELECT COUNT(*) FROM model_registry; -- Should be 0

SET app.tenant = 'test_tenant_1';
SELECT COUNT(*) FROM model_registry; -- Should be 1
EOF
```

## Troubleshooting

### Common Issues

1. **Permission denied**: Ensure database user has CREATE TABLE permissions
2. **RLS not working**: Check `app.tenant` is set correctly
3. **Migration already applied**: Check migration_history table
4. **Foreign key violations**: Run migrations in numerical order

### Debug Commands

```bash
# Check migration history
psql $POSTGRES_URL -c "SELECT * FROM migration_history ORDER BY executed_at DESC;"

# Check table structure
psql $POSTGRES_URL -c "\d+ model_registry"

# Check indexes
psql $POSTGRES_URL -c "\di"

# Check RLS policies
psql $POSTGRES_URL -c "\dp"
```

## Contact

For issues or questions about migrations:
1. Check this README first
2. Review WARP.md for project guidelines
3. Consult CONTRIBUTING-ML.md for ML-specific guidance

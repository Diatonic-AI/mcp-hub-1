# Contributing to MCP Hub ML/DL Pipeline

## Overview
This document provides guidelines for contributing to the Machine Learning and Deep Learning pipeline components of MCP Hub. All contributions must adhere to the WARP rulebook and maintain backward compatibility.

## Guardrails

### 1. Directory Structure
All ML components MUST be placed under `src/` per WARP rules:
- `src/data/` - Database connectors (PostgreSQL, MongoDB, Redis)
- `src/feature_engineering/` - Feature registry and materialization
- `src/training/` - Training orchestration and HPO
- `src/services/` - Model registry, inference, experiments
- `src/batch/` - Batch prediction system
- `src/monitoring/` - Drift detection and alerts
- `src/observability/` - Metrics and structured logging

### 2. Code Standards
- **NO** `console.*` statements - use `src/utils/logger.js` exclusively
- Structured errors via `src/utils/errors.js` - never raw exceptions
- All async operations must have timeout and cleanup handlers
- Database connections must use pooling with proper release

### 3. Meta-Tools Naming
All ML meta-tools MUST:
- Begin with `hub__` prefix
- Return `{ content: [...], isError?: boolean }`
- Validate inputs and throw `McpError` for invalid params
- Be registered in `src/mcp/toolset-registry.js`

### 4. Database Usage
- **PostgreSQL**: ML metadata (model registry, training runs, evaluations)
- **MongoDB**: Model artifacts via GridFS
- **Redis**: Feature cache, inference memoization, job queues

### 5. Security Requirements
- **NEVER** commit real credentials - use placeholders in `.env.sample`
- Redact PII and sensitive data before logging
- Enforce tenant isolation via PostgreSQL RLS
- Encrypt model artifacts at rest

### 6. Testing Requirements
For each new feature, provide:
- Success case tests
- Failure case tests
- Boundary condition tests
- Network tests (skipped by default, enabled via CI)

Update `WARP.md` Section 15 with new test count after adding tests.

### 7. SSE Events
When adding new events:
1. Add enum value to `src/utils/sse-manager.js`
2. Emit from correct lifecycle point
3. Update README Events table
4. Add test for event emission
5. Bump minor version

### 8. Error Handling
ML-specific error classes:
- `TrainingError` - Training pipeline failures
- `ModelRegistryError` - Model versioning issues
- `InferenceError` - Prediction service failures
- `FeatureEngineeringError` - Feature computation errors

All extend `McpError` and map to HTTP status codes centrally.

## Development Workflow

### 1. Before Starting
- Read WARP.md thoroughly
- Check existing patterns in `src/`
- Verify no breaking changes to existing APIs

### 2. Implementation
- Follow existing code patterns
- Use logger for all output
- Implement proper cleanup in error paths
- Add comprehensive JSDoc comments

### 3. Testing
```bash
# Run tests
npm test

# Run specific ML tests
npm test -- tests/training/
npm test -- tests/inference/

# Run with network tests (requires configured databases)
ENABLE_NETWORK_TESTS=1 npm test
```

### 4. Documentation
- Update README.md with new routes/tools
- Append to WARP.md (never rewrite)
- Add examples to `examples/`
- Update pipeline status JSON

## Pipeline Components Status

| Component | Status | Directory | Key Files |
|-----------|--------|-----------|-----------|
| Database Connectors | In Progress | `src/data/` | postgres.js, mongo.js, redis.js |
| Feature Engineering | Completed | `src/feature_engineering/` | registry.js, stream_worker.js |
| Training Orchestration | Pending | `src/training/` | orchestrator.js, queue.js |
| Model Registry | Pending | `src/services/model-registry/` | ModelRegistry.js |
| Inference Service | Pending | `src/services/inference/` | InferenceService.js |
| Batch Prediction | Pending | `src/batch/` | BatchPredictor.js |
| Monitoring | Pending | `src/monitoring/` | drift_detector.js |
| A/B Testing | Pending | `src/services/experiment/` | ExperimentService.js |
| AutoML | Pending | `src/training/` | automl.js |
| Explainability | Pending | `src/services/explainability/` | ExplainService.js |

## Environment Variables

Required for ML pipeline (add to `.env`):
```env
# PostgreSQL (ML metadata)
POSTGRES_HOST=10.10.10.11
POSTGRES_PORT=5432
POSTGRES_DB=mcp_hub
POSTGRES_USER=mcp_hub_app
POSTGRES_PASSWORD=<your-password>

# MongoDB (artifacts)
MONGODB_URI=mongodb://10.10.10.13:27017/mcp_hub_ml
MONGODB_DB=mcp_hub_ml

# Redis (cache & queues)
REDIS_HOST=10.10.10.14
REDIS_PORT=6379
REDIS_DB=0

# ML Pipeline
ENABLE_ML_TELEMETRY=true
ENABLE_ML_FEATURE_STORE=true
ML_TELEMETRY_BATCH_SIZE=100
ML_TELEMETRY_FLUSH_INTERVAL_MS=5000
```

## Contact

For ML pipeline questions, refer to:
- WARP.md Section 19 (ML/DL Pipeline Architecture)
- GitHub Issues with `ml-pipeline` label
- Pipeline status: `ml-pipeline/pipeline_status.json`

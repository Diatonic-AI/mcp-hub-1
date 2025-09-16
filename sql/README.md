# MCP Hub Database Setup

This directory contains SQL scripts and setup utilities for the MCP Hub ML/DL pipeline database.

## Prerequisites

- PostgreSQL server running on LXC container at `10.10.10.11`
- PostgreSQL client tools installed on the host machine
- SSH access to the PostgreSQL server container

## Quick Setup (Recommended)

For a complete one-step setup, simply run:

```bash
cd /home/daclab-ai/dev/mcp-hub/sql
./setup_database.sh
```

This will automatically:
1. Configure the PostgreSQL server on the LXC container
2. Apply the database schema
3. Verify the installation

## Manual Setup Instructions

### Step 1: Configure PostgreSQL Server

First, you need to configure the PostgreSQL server to accept connections from the host machine. 

SSH into your PostgreSQL LXC container and run the configuration script:

```bash
# Copy the script to the PostgreSQL server
scp configure_postgres_server.sh root@10.10.10.11:/tmp/

# SSH into the container and run the script
ssh root@10.10.10.11
cd /tmp
bash configure_postgres_server.sh
```

**What this script does:**
- Backs up existing PostgreSQL configuration files
- Adds pg_hba.conf entries to allow connections from:
  - `10.10.10.1` (host's dbnet0 bridge interface)
  - `10.0.0.219` (host's main IP address)
- Configures PostgreSQL to listen on all interfaces
- Creates the `mcp_hub` database and user if they don't exist
- Grants necessary permissions

### Step 2: Apply Database Schema

Once the PostgreSQL server is configured, run the schema application script from the host machine:

```bash
# From the host machine (not in the container)
cd /home/daclab-ai/dev/mcp-hub/sql
./apply_schema.sh
```

This will create all the necessary tables for the ML/DL pipeline.

## Database Schema Overview

The schema includes the following tables:

### Core Training Tables
- **training_runs** - Stores ML model training run metadata and results
- **training_events** - Event log for training runs (uses `timestamp` column for code compatibility)
- **models** - Model registry for versioned ML models
- **evaluation_metrics** - Model evaluation metrics and scores
- **confusion_matrices** - Confusion matrices for model evaluations

### Batch Processing Tables
- **batch_jobs** - Batch prediction job tracking
- **predictions** - Individual predictions from batch jobs

### Feature Store Tables
- **features** - Feature store metadata
- **feature_values** - Materialized feature values

### Experiment Tables
- **experiments** - A/B testing experiment configurations
- **experiment_results** - A/B testing experiment results

### Monitoring Tables
- **model_drift_metrics** - Model drift monitoring metrics

### Dataset Management
- **datasets** - Training dataset metadata

### Hyperparameter Optimization
- **hpo_runs** - Hyperparameter optimization study runs
- **hpo_trials** - Individual trials within HPO runs

## Important Notes

1. **Column Naming**: The `training_events` table uses a `timestamp` column (instead of `created_at`) to match the existing code requirements. It also has a `created_at` column for compatibility.

2. **Connection Details**:
   - Host: `10.10.10.11`
   - Port: `5432`
   - Database: `mcp_hub`
   - User: `mcp_hub`
   - Password: `McpHub2024!@#`

3. **Network Configuration**:
   - The host machine connects via its `dbnet0` interface (10.10.10.1)
   - The LXC container has IP 10.10.10.11 on the same network

## Testing the Connection

After setup, you can test the connection:

```bash
PGPASSWORD='McpHub2024!@#' psql -h 10.10.10.11 -U mcp_hub -d mcp_hub -c "SELECT version();"
```

## Troubleshooting

### Connection Refused
If you get a connection refused error:
1. Check that PostgreSQL is running: `systemctl status postgresql`
2. Verify PostgreSQL is listening on the correct interface
3. Check firewall rules on the LXC container

### Authentication Failed
If you get an authentication error:
1. Verify the pg_hba.conf entries are correct
2. Make sure PostgreSQL was reloaded after configuration changes
3. Check that the password is correct

### Permission Denied
If you get permission denied errors when creating tables:
1. Ensure the mcp_hub user has the necessary privileges
2. Run: `GRANT ALL PRIVILEGES ON DATABASE mcp_hub TO mcp_hub;`

## Files in this Directory

- **setup_ml_tables.sql** - Main schema definition with all tables, indexes, and triggers
- **configure_postgres_server.sh** - Script to configure PostgreSQL server (run on the LXC container)
- **apply_schema.sh** - Script to apply the schema (run from the host)
- **README.md** - This file

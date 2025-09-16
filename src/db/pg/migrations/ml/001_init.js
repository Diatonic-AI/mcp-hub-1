// PostgreSQL ML Schema Initial Migration (idempotent)
// Guidelines: WARP 4.4 lifecycle, RLS enforcement, additive-only schema

export default {
  id: '20250909_001_ml_init',
  description: 'Initial ML telemetry schema: models, runs, metrics, evaluations, artifacts, events, RLS policies',
  up: async (client, logger) => {
    // Wrap everything in a transaction
    await client.query('BEGIN');
    try {
      // Enable required extensions
      await client.query(`
        CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
        CREATE EXTENSION IF NOT EXISTS pgcrypto;
      `);

      // Helper function to create enum safely
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ml_run_status') THEN
            CREATE TYPE ml_run_status AS ENUM ('PENDING','RUNNING','COMPLETED','FAILED','CANCELED');
          END IF;
        END$$;
      `);

      // Tenant helper: ensure function exists to set tenant context
      await client.query(`
        CREATE OR REPLACE FUNCTION set_tenant(p_tenant text)
        RETURNS void AS $$
        BEGIN
          PERFORM set_config('app.tenant', p_tenant, true);
        END;
        $$ LANGUAGE plpgsql SECURITY DEFINER;
      `);

      // Schema version table for ML
      await client.query(`
        CREATE TABLE IF NOT EXISTS ml_schema_version (
          id serial PRIMARY KEY,
          version_key text UNIQUE NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now(),
          description text
        );
      `);

      // Models
      await client.query(`
        CREATE TABLE IF NOT EXISTS ml_model_versions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id text NOT NULL,
          model_name text NOT NULL,
          version text NOT NULL,
          source text,
          registry_uri text,
          tags jsonb NOT NULL DEFAULT '[]'::jsonb,
          classification text NOT NULL DEFAULT 'internal',
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (tenant_id, model_name, version)
        );
      `);

      // Training runs
      await client.query(`
        CREATE TABLE IF NOT EXISTS ml_training_runs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id text NOT NULL,
          model_version_id uuid REFERENCES ml_model_versions(id) ON DELETE CASCADE,
          run_name text,
          status ml_run_status NOT NULL DEFAULT 'PENDING',
          parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
          summary_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
          tags jsonb NOT NULL DEFAULT '[]'::jsonb,
          classification text NOT NULL DEFAULT 'internal',
          started_at timestamptz NOT NULL DEFAULT now(),
          completed_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);

      // Metrics (wide support: numeric, text, json)
      await client.query(`
        CREATE TABLE IF NOT EXISTS ml_metrics (
          id bigserial PRIMARY KEY,
          tenant_id text NOT NULL,
          run_id uuid REFERENCES ml_training_runs(id) ON DELETE CASCADE,
          key text NOT NULL,
          value_numeric double precision,
          value_text text,
          value_json jsonb,
          step integer,
          ts timestamptz NOT NULL DEFAULT now()
        );
      `);

      // Evaluations
      await client.query(`
        CREATE TABLE IF NOT EXISTS ml_evaluations (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id text NOT NULL,
          model_version_id uuid REFERENCES ml_model_versions(id) ON DELETE CASCADE,
          run_id uuid REFERENCES ml_training_runs(id) ON DELETE SET NULL,
          metric_name text NOT NULL,
          value double precision NOT NULL,
          threshold double precision,
          passed boolean,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);

      // Artifact references (actual blobs in Mongo/GridFS; reference here)
      await client.query(`
        CREATE TABLE IF NOT EXISTS ml_artifact_refs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id text NOT NULL,
          model_version_id uuid REFERENCES ml_model_versions(id) ON DELETE CASCADE,
          run_id uuid REFERENCES ml_training_runs(id) ON DELETE SET NULL,
          artifact_type text NOT NULL,
          filename text,
          content_type text,
          size_bytes bigint,
          sha256 text,
          mongo_file_id text,
          classification text NOT NULL DEFAULT 'internal',
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);

      // Raw ML events for telemetry
      await client.query(`
        CREATE TABLE IF NOT EXISTS ml_events (
          id bigserial PRIMARY KEY,
          tenant_id text NOT NULL,
          event_type text NOT NULL,
          tool_id text,
          server_name text,
          run_id uuid,
          model_version_id uuid,
          timings jsonb NOT NULL DEFAULT '{}'::jsonb,
          sizes jsonb NOT NULL DEFAULT '{}'::jsonb,
          outcome text,
          error_code text,
          payload jsonb,
          ts timestamptz NOT NULL DEFAULT now()
        );
      `);

      // Indexes
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_ml_model_versions_tenant ON ml_model_versions(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_ml_model_versions_name ON ml_model_versions(model_name);
        CREATE INDEX IF NOT EXISTS idx_ml_training_runs_tenant ON ml_training_runs(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_ml_training_runs_status ON ml_training_runs(status);
        CREATE INDEX IF NOT EXISTS idx_ml_training_runs_model ON ml_training_runs(model_version_id);
        CREATE INDEX IF NOT EXISTS idx_ml_metrics_run_ts ON ml_metrics(run_id, ts DESC);
        CREATE INDEX IF NOT EXISTS idx_ml_metrics_tenant_key ON ml_metrics(tenant_id, key);
        CREATE INDEX IF NOT EXISTS idx_ml_evaluations_tenant ON ml_evaluations(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_ml_artifact_refs_tenant ON ml_artifact_refs(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_ml_events_tenant_ts ON ml_events(tenant_id, ts DESC);
        CREATE INDEX IF NOT EXISTS idx_ml_events_type ON ml_events(event_type);
        CREATE INDEX IF NOT EXISTS idx_ml_jsonb_tags ON ml_model_versions USING GIN (tags);
        CREATE INDEX IF NOT EXISTS idx_ml_jsonb_params ON ml_training_runs USING GIN (parameters);
        CREATE INDEX IF NOT EXISTS idx_ml_jsonb_summary ON ml_training_runs USING GIN (summary_metrics);
      `);

      // RLS policies for tenant isolation
      await client.query(`
        ALTER TABLE ml_model_versions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ml_training_runs ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ml_metrics ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ml_evaluations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ml_artifact_refs ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ml_events ENABLE ROW LEVEL SECURITY;

        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ml_model_versions') THEN
            CREATE POLICY tenant_isolation_ml_model_versions ON ml_model_versions
              USING (tenant_id = current_setting('app.tenant', true));
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ml_training_runs') THEN
            CREATE POLICY tenant_isolation_ml_training_runs ON ml_training_runs
              USING (tenant_id = current_setting('app.tenant', true));
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ml_metrics') THEN
            CREATE POLICY tenant_isolation_ml_metrics ON ml_metrics
              USING (tenant_id = current_setting('app.tenant', true));
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ml_evaluations') THEN
            CREATE POLICY tenant_isolation_ml_evaluations ON ml_evaluations
              USING (tenant_id = current_setting('app.tenant', true));
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ml_artifact_refs') THEN
            CREATE POLICY tenant_isolation_ml_artifact_refs ON ml_artifact_refs
              USING (tenant_id = current_setting('app.tenant', true));
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ml_events') THEN
            CREATE POLICY tenant_isolation_ml_events ON ml_events
              USING (tenant_id = current_setting('app.tenant', true));
          END IF;
        END$$;
      `);

      // Record migration
      await client.query(
        `INSERT INTO ml_schema_version(version_key, description) VALUES($1, $2) ON CONFLICT (version_key) DO NOTHING`,
        ['20250909_001_ml_init', 'Initial ML schema installed']
      );

      await client.query('COMMIT');
      if (logger) logger.info('ML schema migration applied');
    } catch (err) {
      await client.query('ROLLBACK');
      if (logger) logger.error('PG_MIGRATION_ERROR', 'ML schema migration failed', { error: err.message }, false);
      throw err;
    }
  }
};


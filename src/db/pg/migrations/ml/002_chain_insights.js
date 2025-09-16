// PostgreSQL ML Chain Insights Migration (idempotent)
// Adds tables for dashboard-ready insights and self-evolving fix tracking

export default {
  id: '20250909_002_ml_chain_insights',
  description: 'Add ml_chain_insights and ml_fix_signatures for dashboard & self-evolution',
  up: async (client, logger) => {
    await client.query('BEGIN');
    try {
      // Insights table: captures how/why/when/what/where recommendations and predictions
      await client.query(`
        CREATE TABLE IF NOT EXISTS ml_chain_insights (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id text NOT NULL,
          pattern_signature text NOT NULL, -- hash of tool chain pattern
          chain_tools text[] NOT NULL,     -- ordered list of tools in chain
          how jsonb NOT NULL DEFAULT '{}'::jsonb,
          why jsonb NOT NULL DEFAULT '{}'::jsonb,
          when jsonb NOT NULL DEFAULT '{}'::jsonb,
          what jsonb NOT NULL DEFAULT '{}'::jsonb,
          where jsonb NOT NULL DEFAULT '{}'::jsonb,
          recommendation jsonb NOT NULL DEFAULT '{}'::jsonb,
          prediction jsonb NOT NULL DEFAULT '{}'::jsonb,
          method_type text,                -- supervised | unsupervised | semi_supervised | reinforcement
          model_type text,                 -- FF | RNN | LSTM | CNN | GAN | classical
          inefficiency_score double precision, -- 0..1 (1 = worst)
          confidence_score double precision,   -- 0..1
          times_observed integer NOT NULL DEFAULT 0,
          times_applied integer NOT NULL DEFAULT 0,
          times_successful integer NOT NULL DEFAULT 0,
          status text NOT NULL DEFAULT 'suggested', -- suggested | validated | auto_promoted | deprecated
          fix_signature text,             -- hash of the recommended change
          last_seen_at timestamptz NOT NULL DEFAULT now(),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
      `);

      // Fix signatures: track repetition of same fixes across patterns to enable self-evolution
      await client.query(`
        CREATE TABLE IF NOT EXISTS ml_fix_signatures (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id text NOT NULL,
          fix_signature text NOT NULL,
          description text,
          example_change jsonb NOT NULL DEFAULT '{}'::jsonb,
          total_occurrences integer NOT NULL DEFAULT 0,
          successful_applications integer NOT NULL DEFAULT 0,
          last_applied_at timestamptz,
          auto_promote boolean NOT NULL DEFAULT false,
          promote_threshold integer NOT NULL DEFAULT 3, -- promote when successful applications >= threshold
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (tenant_id, fix_signature)
        );
      `);

      // Indexes
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_ml_chain_insights_tenant ON ml_chain_insights(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_ml_chain_insights_signature ON ml_chain_insights(pattern_signature);
        CREATE INDEX IF NOT EXISTS idx_ml_chain_insights_status ON ml_chain_insights(status);
        CREATE INDEX IF NOT EXISTS idx_ml_fix_signatures_tenant ON ml_fix_signatures(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_ml_fix_signatures_signature ON ml_fix_signatures(fix_signature);
      `);

      // RLS enable and policies
      await client.query(`
        ALTER TABLE ml_chain_insights ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ml_fix_signatures ENABLE ROW LEVEL SECURITY;
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ml_chain_insights') THEN
            CREATE POLICY tenant_isolation_ml_chain_insights ON ml_chain_insights
              USING (tenant_id = current_setting('app.tenant', true))
              WITH CHECK (tenant_id = current_setting('app.tenant', true));
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ml_fix_signatures') THEN
            CREATE POLICY tenant_isolation_ml_fix_signatures ON ml_fix_signatures
              USING (tenant_id = current_setting('app.tenant', true))
              WITH CHECK (tenant_id = current_setting('app.tenant', true));
          END IF;
        END$$;
      `);

      // Touch schema version
      await client.query(
        `INSERT INTO ml_schema_version(version_key, description) VALUES($1, $2) ON CONFLICT (version_key) DO NOTHING`,
        ['20250909_002_ml_chain_insights', 'Add chain insights and fix signatures tables']
      );

      await client.query('COMMIT');
      if (logger) logger.info('ML chain insights migration applied');
    } catch (err) {
      await client.query('ROLLBACK');
      if (logger) logger.error('PG_MIGRATION_ERROR', 'Chain insights migration failed', { error: err.message }, false);
      throw err;
    }
  }
};

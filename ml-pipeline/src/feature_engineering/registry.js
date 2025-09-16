/**
 * Feature Registry Service
 * Manages feature set definitions, versioning, and lineage tracking
 */

import { getDatabase } from '../../../src/utils/database.js';
import { PostgresTenantHelper } from '../../../src/utils/tenant-context.js';
import { ValidationError, ServerError } from '../../../src/utils/errors.js';
import logger from '../../../src/utils/logger.js';
import { generateUUID } from '../../../src/utils/id.js';
import yaml from 'js-yaml';

export class FeatureRegistryService {
  constructor() {
    this.db = getDatabase();
  }

  /**
   * Register a new feature set
   */
  async registerFeatureSet(tenant, spec, owner) {
    const client = await this.db.connect();

    try {
      await PostgresTenantHelper.setTenantContext(client, tenant);
      
      // Parse spec if it's YAML
      const parsedSpec = typeof spec === 'string' ? 
        (spec.trim().startsWith('{') ? JSON.parse(spec) : yaml.load(spec)) :
        spec;

      // Validate spec structure
      this.validateFeatureSpec(parsedSpec);

      // Check for existing feature set with same name
      const existingResult = await client.query(
        `SELECT id, version, status FROM mlops.feature_set 
         WHERE tenant_id = $1 AND name = $2 
         ORDER BY version DESC LIMIT 1`,
        [tenant, parsedSpec.name]
      );

      let version = 1;
      let parentVersionId = null;

      if (existingResult.rows.length > 0) {
        const existing = existingResult.rows[0];
        version = existing.version + 1;
        parentVersionId = existing.id;
        
        logger.info('feature_set_version_increment', {
          name: parsedSpec.name,
          oldVersion: existing.version,
          newVersion: version
        });
      }

      // Extract source tables from spec
      const sourceTables = this.extractSourceTables(parsedSpec);

      // Insert new feature set
      const insertResult = await client.query(
        `INSERT INTO mlops.feature_set (
          tenant_id, name, version, description, spec, owner, 
          parent_version_id, source_tables, status, validation_rules
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`,
        [
          tenant,
          parsedSpec.name,
          version,
          parsedSpec.description || null,
          parsedSpec,
          owner,
          parentVersionId,
          sourceTables,
          'draft',
          parsedSpec.validation || {}
        ]
      );

      const featureSet = insertResult.rows[0];

      // Create lineage entries
      await this.createLineageEntries(client, tenant, featureSet.id, parsedSpec);

      // Emit event to ML Chain Insights
      await this.emitFeatureRegistrationEvent(tenant, featureSet);

      logger.info('feature_set_registered', {
        id: featureSet.id,
        name: featureSet.name,
        version: featureSet.version,
        owner: owner
      });

      return featureSet;

    } catch (error) {
      logger.error('feature_set_registration_failed', { error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Materialize features offline (create materialized view)
   */
  async materializeOffline(tenant, featureSetId) {
    const client = await this.db.connect();

    try {
      await PostgresTenantHelper.setTenantContext(client, tenant);

      // Get feature set
      const fsResult = await client.query(
        `SELECT * FROM mlops.feature_set WHERE id = $1 AND tenant_id = $2`,
        [featureSetId, tenant]
      );

      if (fsResult.rows.length === 0) {
        throw new ValidationError('Feature set not found');
      }

      const featureSet = fsResult.rows[0];

      // Check if already materialized
      const matResult = await client.query(
        `SELECT id FROM mlops.feature_materialization 
         WHERE feature_set_id = $1 AND mode IN ('offline', 'both')
         AND status != 'failed'`,
        [featureSetId]
      );

      if (matResult.rows.length > 0) {
        throw new ValidationError('Feature set already has offline materialization');
      }

      // Compile spec to SQL
      const viewSql = await this.compileFeatureSpec(featureSet.spec);
      const viewName = `features_${featureSet.name}_v${featureSet.version}`;

      // Create materialized view
      await client.query(viewSql);

      // Record materialization
      const matId = generateUUID();
      await client.query(
        `INSERT INTO mlops.feature_materialization (
          id, tenant_id, feature_set_id, mode, schedule, 
          status, last_run_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING *`,
        [matId, tenant, featureSetId, 'offline', '0 */6 * * *', 'completed']
      );

      // Record view metadata
      await client.query(
        `INSERT INTO mlops.feature_views (
          tenant_id, feature_set_id, view_name, view_type, 
          view_sql, refresh_method, last_refreshed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [tenant, featureSetId, viewName, 'materialized_view', viewSql, 'complete']
      );

      // Update feature set status
      await client.query(
        `UPDATE mlops.feature_set SET status = 'active' 
         WHERE id = $1`,
        [featureSetId]
      );

      // Emit materialization event
      await this.emitMaterializationEvent(tenant, featureSetId, 'offline', 'completed');

      logger.info('feature_set_materialized_offline', {
        featureSetId,
        viewName,
        mode: 'offline'
      });

      return { 
        success: true, 
        viewName, 
        materializationId: matId 
      };

    } catch (error) {
      logger.error('offline_materialization_failed', { 
        error: error.message,
        featureSetId 
      });
      
      // Record failure
      await client.query(
        `INSERT INTO mlops.feature_materialization (
          tenant_id, feature_set_id, mode, status, error_message
        ) VALUES ($1, $2, $3, $4, $5)`,
        [tenant, featureSetId, 'offline', 'failed', error.message]
      );

      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get feature vector for an entity
   */
  async getFeatureVector(tenant, featureSetName, version, entityId) {
    const client = await this.db.connect();

    try {
      await PostgresTenantHelper.setTenantContext(client, tenant);

      // Get feature set
      const fsResult = await client.query(
        `SELECT id, name, version FROM mlops.feature_set 
         WHERE tenant_id = $1 AND name = $2 AND version = $3
         AND status = 'active'`,
        [tenant, featureSetName, version]
      );

      if (fsResult.rows.length === 0) {
        throw new ValidationError('Active feature set not found');
      }

      const featureSet = fsResult.rows[0];

      // Check cache first
      const cacheResult = await client.query(
        `SELECT feature_vector, computed_at 
         FROM mlops.feature_cache
         WHERE tenant_id = $1 AND feature_set_id = $2 AND entity_id = $3
         AND expires_at > NOW()`,
        [tenant, featureSet.id, entityId]
      );

      if (cacheResult.rows.length > 0) {
        // Update cache hits
        await client.query(
          `UPDATE mlops.feature_cache 
           SET cache_hits = cache_hits + 1,
               last_accessed_at = NOW()
           WHERE tenant_id = $1 AND feature_set_id = $2 AND entity_id = $3`,
          [tenant, featureSet.id, entityId]
        );

        logger.debug('feature_vector_cache_hit', {
          featureSetName,
          version,
          entityId
        });

        return {
          features: cacheResult.rows[0].feature_vector,
          computed_at: cacheResult.rows[0].computed_at,
          cache_hit: true
        };
      }

      // Compute from materialized view
      const viewName = `features_${featureSet.name}_v${featureSet.version}`;
      const vectorResult = await client.query(
        `SELECT * FROM mlops.${viewName} WHERE entity_id = $1`,
        [entityId]
      );

      if (vectorResult.rows.length === 0) {
        return {
          features: {},
          computed_at: new Date(),
          cache_hit: false,
          missing: true
        };
      }

      const featureVector = vectorResult.rows[0];
      delete featureVector.entity_id;
      delete featureVector.tenant_id;

      // Cache the result
      await client.query(
        `INSERT INTO mlops.feature_cache (
          tenant_id, feature_set_id, entity_id, feature_vector,
          computed_at, expires_at, feature_version
        ) VALUES ($1, $2, $3, $4, NOW(), NOW() + INTERVAL '1 hour', $5)
        ON CONFLICT (tenant_id, feature_set_id, entity_id)
        DO UPDATE SET 
          feature_vector = EXCLUDED.feature_vector,
          computed_at = EXCLUDED.computed_at,
          expires_at = EXCLUDED.expires_at,
          feature_version = EXCLUDED.feature_version`,
        [tenant, featureSet.id, entityId, featureVector, version]
      );

      return {
        features: featureVector,
        computed_at: new Date(),
        cache_hit: false
      };

    } finally {
      client.release();
    }
  }

  /**
   * Validate feature specification structure
   */
  validateFeatureSpec(spec) {
    if (!spec.name) {
      throw new ValidationError('Feature spec must have a name');
    }

    if (!spec.features || !Array.isArray(spec.features)) {
      throw new ValidationError('Feature spec must have features array');
    }

    if (!spec.source) {
      throw new ValidationError('Feature spec must specify source table');
    }

    // Validate each feature definition
    for (const feature of spec.features) {
      if (!feature.name) {
        throw new ValidationError('Each feature must have a name');
      }
      
      if (!feature.type) {
        throw new ValidationError(`Feature ${feature.name} must have a type`);
      }

      if (feature.aggregation && !feature.window) {
        throw new ValidationError(`Feature ${feature.name} with aggregation must specify window`);
      }
    }
  }

  /**
   * Extract source tables from specification
   */
  extractSourceTables(spec) {
    const tables = new Set();
    
    // Main source
    if (spec.source) {
      tables.add(spec.source);
    }

    // Additional sources from features
    if (spec.features) {
      for (const feature of spec.features) {
        if (feature.source) {
          tables.add(feature.source);
        }
      }
    }

    // Join sources
    if (spec.joins) {
      for (const join of spec.joins) {
        if (join.table) {
          tables.add(join.table);
        }
      }
    }

    return Array.from(tables);
  }

  /**
   * Create lineage entries for features
   */
  async createLineageEntries(client, tenant, featureSetId, spec) {
    for (const feature of spec.features) {
      await client.query(
        `INSERT INTO mlops.feature_lineage (
          tenant_id, feature_set_id, upstream_table, 
          upstream_columns, downstream_feature,
          transformation_type, transformation_spec
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          tenant,
          featureSetId,
          feature.source || spec.source,
          feature.columns || [feature.column],
          feature.name,
          feature.aggregation || feature.transformation || 'direct',
          feature
        ]
      );
    }
  }

  /**
   * Compile feature specification to SQL
   */
  async compileFeatureSpec(spec) {
    const viewName = `features_${spec.name}_v${spec.version || 1}`;
    let sql = `CREATE MATERIALIZED VIEW IF NOT EXISTS mlops.${viewName} AS\n`;
    
    // Build SELECT clause
    sql += 'SELECT\n';
    sql += '  tenant_id,\n';
    sql += '  entity_id,\n';

    // Add each feature
    for (const feature of spec.features) {
      if (feature.aggregation) {
        sql += `  ${feature.aggregation}(${feature.column}) AS ${feature.name},\n`;
      } else if (feature.expression) {
        sql += `  ${feature.expression} AS ${feature.name},\n`;
      } else {
        sql += `  ${feature.column} AS ${feature.name},\n`;
      }
    }

    sql = sql.slice(0, -2) + '\n'; // Remove last comma

    // FROM clause
    sql += `FROM ${spec.source}\n`;

    // JOIN clauses
    if (spec.joins) {
      for (const join of spec.joins) {
        sql += `${join.type || 'LEFT'} JOIN ${join.table} ON ${join.condition}\n`;
      }
    }

    // WHERE clause
    if (spec.filter) {
      sql += `WHERE ${spec.filter}\n`;
    }

    // GROUP BY clause (if aggregations)
    const hasAggregations = spec.features.some(f => f.aggregation);
    if (hasAggregations) {
      sql += 'GROUP BY tenant_id, entity_id\n';
    }

    return sql;
  }

  /**
   * Emit feature registration event
   */
  async emitFeatureRegistrationEvent(tenant, featureSet) {
    // Integration with ML Chain Insights Service would go here
    logger.info('ml_chain_event', {
      type: 'feature_set_registered',
      tenant,
      featureSetId: featureSet.id,
      name: featureSet.name,
      version: featureSet.version
    });
  }

  /**
   * Emit materialization event
   */
  async emitMaterializationEvent(tenant, featureSetId, mode, status) {
    logger.info('ml_chain_event', {
      type: 'feature_materialization_completed',
      tenant,
      featureSetId,
      mode,
      status
    });
  }
}

// Export singleton instance
export default new FeatureRegistryService();

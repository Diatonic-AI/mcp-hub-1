/**
 * Online Feature Stream Worker
 * Processes telemetry events in real-time to compute and cache features
 */

import Redis from 'ioredis';
import { getDatabase } from '../../../src/utils/database.js';
import { PostgresTenantHelper } from '../../../src/utils/tenant-context.js';
import logger from '../../../src/utils/logger.js';
import { generateUUID } from '../../../src/utils/id.js';

export class OnlineFeatureWorker {
  constructor(config = {}) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      db: process.env.REDIS_DB || 0,
      retryStrategy: (times) => Math.min(times * 50, 2000)
    });

    this.db = getDatabase();
    this.consumerGroup = config.consumerGroup || 'feature-workers';
    this.consumerId = config.consumerId || `worker-${generateUUID().substring(0, 8)}`;
    this.streamKey = config.streamKey || 'telemetry:events:*';
    this.batchSize = config.batchSize || 10;
    this.isRunning = false;
    this.activeFeatureSets = new Map(); // tenant -> feature sets
  }

  /**
   * Start the stream worker
   */
  async start() {
    if (this.isRunning) {
      logger.warn('online_feature_worker_already_running');
      return;
    }

    this.isRunning = true;
    logger.info('online_feature_worker_started', {
      consumerId: this.consumerId,
      consumerGroup: this.consumerGroup
    });

    // Load active feature sets
    await this.loadActiveFeatureSets();

    // Create consumer group if it doesn't exist
    await this.ensureConsumerGroup();

    // Start processing loop
    this.processLoop();
  }

  /**
   * Stop the stream worker
   */
  async stop() {
    this.isRunning = false;
    await this.redis.quit();
    logger.info('online_feature_worker_stopped', {
      consumerId: this.consumerId
    });
  }

  /**
   * Main processing loop
   */
  async processLoop() {
    while (this.isRunning) {
      try {
        // Read from stream
        const streams = await this.redis.xreadgroup(
          'GROUP', this.consumerGroup, this.consumerId,
          'COUNT', this.batchSize,
          'BLOCK', 1000, // Block for 1 second
          'STREAMS', this.streamKey, '>'
        );

        if (streams && streams.length > 0) {
          for (const [streamKey, messages] of streams) {
            await this.processMessages(streamKey, messages);
          }
        }

        // Reload feature sets periodically (every 100 iterations)
        if (Math.random() < 0.01) {
          await this.loadActiveFeatureSets();
        }

      } catch (error) {
        logger.error('online_feature_worker_error', {
          error: error.message,
          consumerId: this.consumerId
        });
        await this.sleep(5000); // Wait 5 seconds on error
      }
    }
  }

  /**
   * Process a batch of messages
   */
  async processMessages(streamKey, messages) {
    const startTime = Date.now();
    let processed = 0;
    let failed = 0;

    for (const [messageId, data] of messages) {
      try {
        const event = this.parseEvent(data);
        
        // Extract tenant from stream key or event
        const tenant = this.extractTenant(streamKey, event);
        
        if (!tenant) {
          logger.warn('online_feature_no_tenant', { messageId });
          await this.acknowledgeMessage(streamKey, messageId);
          continue;
        }

        // Get active feature sets for tenant
        const featureSets = this.activeFeatureSets.get(tenant) || [];
        
        if (featureSets.length === 0) {
          // No feature sets to process, just acknowledge
          await this.acknowledgeMessage(streamKey, messageId);
          continue;
        }

        // Process event for each applicable feature set
        for (const featureSet of featureSets) {
          if (this.isApplicable(event, featureSet)) {
            await this.computeOnlineFeatures(tenant, event, featureSet);
          }
        }

        // Acknowledge message
        await this.acknowledgeMessage(streamKey, messageId);
        processed++;

      } catch (error) {
        logger.error('online_feature_message_error', {
          error: error.message,
          messageId
        });
        failed++;
        
        // Optionally: Add to dead letter queue
        await this.addToDeadLetter(streamKey, messageId, data, error.message);
      }
    }

    const duration = Date.now() - startTime;
    
    logger.info('online_feature_batch_processed', {
      processed,
      failed,
      duration,
      throughput: processed / (duration / 1000)
    });
  }

  /**
   * Compute online features for an event
   */
  async computeOnlineFeatures(tenant, event, featureSet) {
    const entityId = event.entityId || event.toolId || event.modelId;
    
    if (!entityId) {
      return; // Cannot compute features without entity ID
    }

    // Build feature vector based on spec
    const featureVector = {};
    
    for (const feature of featureSet.spec.features) {
      const value = await this.computeFeature(tenant, entityId, event, feature);
      if (value !== null && value !== undefined) {
        featureVector[feature.name] = value;
      }
    }

    // Cache feature vector in Redis
    const cacheKey = `feature:${tenant}:${entityId}:${featureSet.id}`;
    const ttl = featureSet.spec.cacheTtl || 3600; // Default 1 hour

    await this.redis.hset(cacheKey, {
      vector: JSON.stringify(featureVector),
      computed_at: new Date().toISOString(),
      event_id: event.id || generateUUID(),
      feature_set_version: featureSet.version
    });

    await this.redis.expire(cacheKey, ttl);

    // Also update PostgreSQL cache for consistency
    await this.updatePostgresCache(tenant, featureSet.id, entityId, featureVector);

    // Publish feature update event
    await this.publishFeatureUpdate(tenant, featureSet.id, entityId);

    logger.debug('online_features_computed', {
      tenant,
      entityId,
      featureSetId: featureSet.id,
      featureCount: Object.keys(featureVector).length
    });
  }

  /**
   * Compute a single feature value
   */
  async computeFeature(tenant, entityId, event, featureSpec) {
    const { type, aggregation, window, column, expression } = featureSpec;

    if (type === 'direct') {
      // Direct mapping from event
      return event[column];
    }

    if (type === 'aggregation' && aggregation) {
      // Get historical data for aggregation
      const windowMs = this.parseWindow(window || '1h');
      const historicalData = await this.getHistoricalData(
        tenant, 
        entityId, 
        column, 
        windowMs
      );

      switch (aggregation) {
        case 'count':
          return historicalData.length;
        case 'sum':
          return historicalData.reduce((sum, val) => sum + (val || 0), 0);
        case 'avg':
          return historicalData.length > 0 ? 
            historicalData.reduce((sum, val) => sum + (val || 0), 0) / historicalData.length : 
            0;
        case 'max':
          return Math.max(...historicalData.filter(v => v !== null));
        case 'min':
          return Math.min(...historicalData.filter(v => v !== null));
        case 'stddev':
          return this.calculateStdDev(historicalData);
        default:
          logger.warn('unknown_aggregation', { aggregation });
          return null;
      }
    }

    if (type === 'expression' && expression) {
      // Evaluate expression (simplified - in production use safe eval)
      try {
        // This is a simplified version - use a proper expression evaluator
        return this.evaluateExpression(expression, event);
      } catch (error) {
        logger.error('expression_evaluation_failed', { 
          expression, 
          error: error.message 
        });
        return null;
      }
    }

    return null;
  }

  /**
   * Get historical data for aggregations
   */
  async getHistoricalData(tenant, entityId, column, windowMs) {
    const client = await this.db.connect();
    
    try {
      await PostgresTenantHelper.setTenantContext(client, tenant);
      
      const result = await client.query(
        `SELECT ${column} as value
         FROM telemetry.aggregates
         WHERE tenant_id = $1 
           AND (model_id = $2 OR tool_id = $2 OR chain_id = $2)
           AND timestamp > NOW() - INTERVAL '${windowMs} milliseconds'
         ORDER BY timestamp DESC`,
        [tenant, entityId]
      );

      return result.rows.map(r => r.value);
      
    } finally {
      client.release();
    }
  }

  /**
   * Update PostgreSQL cache
   */
  async updatePostgresCache(tenant, featureSetId, entityId, featureVector) {
    const client = await this.db.connect();
    
    try {
      await PostgresTenantHelper.setTenantContext(client, tenant);
      
      await client.query(
        `INSERT INTO mlops.feature_cache (
          tenant_id, feature_set_id, entity_id, feature_vector,
          computed_at, expires_at, feature_version, computation_time_ms
        ) VALUES ($1, $2, $3, $4, NOW(), NOW() + INTERVAL '1 hour', 
                  (SELECT version FROM mlops.feature_set WHERE id = $2), $5)
        ON CONFLICT (tenant_id, feature_set_id, entity_id)
        DO UPDATE SET 
          feature_vector = EXCLUDED.feature_vector,
          computed_at = EXCLUDED.computed_at,
          expires_at = EXCLUDED.expires_at`,
        [
          tenant, 
          featureSetId, 
          entityId, 
          JSON.stringify(featureVector),
          Date.now() - startTime
        ]
      );
      
    } catch (error) {
      logger.error('postgres_cache_update_failed', { 
        error: error.message,
        tenant,
        entityId 
      });
    } finally {
      client.release();
    }
  }

  /**
   * Load active feature sets from database
   */
  async loadActiveFeatureSets() {
    const client = await this.db.connect();
    
    try {
      const result = await client.query(
        `SELECT DISTINCT fs.*, fm.mode
         FROM mlops.feature_set fs
         JOIN mlops.feature_materialization fm ON fs.id = fm.feature_set_id
         WHERE fs.status = 'active' 
           AND fm.mode IN ('online', 'both')
           AND fm.status != 'failed'`
      );

      // Group by tenant
      this.activeFeatureSets.clear();
      
      for (const row of result.rows) {
        if (!this.activeFeatureSets.has(row.tenant_id)) {
          this.activeFeatureSets.set(row.tenant_id, []);
        }
        this.activeFeatureSets.get(row.tenant_id).push(row);
      }

      logger.info('active_feature_sets_loaded', {
        tenantCount: this.activeFeatureSets.size,
        totalSets: result.rows.length
      });
      
    } finally {
      client.release();
    }
  }

  /**
   * Ensure consumer group exists
   */
  async ensureConsumerGroup() {
    try {
      await this.redis.xgroup('CREATE', this.streamKey, this.consumerGroup, '$', 'MKSTREAM');
    } catch (error) {
      if (!error.message.includes('BUSYGROUP')) {
        throw error;
      }
      // Group already exists, which is fine
    }
  }

  /**
   * Parse event from Redis stream data
   */
  parseEvent(data) {
    const event = {};
    
    // Redis stream data comes as array of [key, value, key, value, ...]
    for (let i = 0; i < data.length; i += 2) {
      const key = data[i];
      const value = data[i + 1];
      
      try {
        // Try to parse JSON values
        event[key] = JSON.parse(value);
      } catch {
        // Keep as string if not JSON
        event[key] = value;
      }
    }
    
    return event;
  }

  /**
   * Extract tenant from stream key or event
   */
  extractTenant(streamKey, event) {
    // Try to extract from stream key pattern: telemetry:events:tenant:*
    const parts = streamKey.split(':');
    if (parts.length >= 4) {
      return parts[2];
    }
    
    // Fallback to event data
    return event.tenant || event.tenant_id;
  }

  /**
   * Check if event is applicable to feature set
   */
  isApplicable(event, featureSet) {
    // Check event filters in feature set spec
    const filters = featureSet.spec.eventFilters;
    
    if (!filters || filters.length === 0) {
      return true; // No filters, process all events
    }

    for (const filter of filters) {
      if (filter.type && event.type !== filter.type) {
        continue;
      }
      
      if (filter.source && event.source !== filter.source) {
        continue;
      }
      
      // All conditions matched
      return true;
    }
    
    return false;
  }

  /**
   * Acknowledge message processing
   */
  async acknowledgeMessage(streamKey, messageId) {
    await this.redis.xack(streamKey, this.consumerGroup, messageId);
  }

  /**
   * Add failed message to dead letter queue
   */
  async addToDeadLetter(streamKey, messageId, data, error) {
    const dlqKey = `${streamKey}:dlq`;
    
    await this.redis.xadd(dlqKey, '*',
      'original_id', messageId,
      'error', error,
      'timestamp', new Date().toISOString(),
      'data', JSON.stringify(data)
    );
  }

  /**
   * Publish feature update event
   */
  async publishFeatureUpdate(tenant, featureSetId, entityId) {
    await this.redis.publish('feature:updates', JSON.stringify({
      type: 'feature_computed',
      tenant,
      featureSetId,
      entityId,
      timestamp: new Date().toISOString()
    }));
  }

  /**
   * Parse window specification to milliseconds
   */
  parseWindow(window) {
    const units = {
      's': 1000,
      'm': 60000,
      'h': 3600000,
      'd': 86400000
    };
    
    const match = window.match(/^(\d+)([smhd])$/);
    if (match) {
      return parseInt(match[1]) * units[match[2]];
    }
    
    return 3600000; // Default 1 hour
  }

  /**
   * Calculate standard deviation
   */
  calculateStdDev(values) {
    const n = values.length;
    if (n === 0) return 0;
    
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / n;
    
    return Math.sqrt(variance);
  }

  /**
   * Simple expression evaluator (production should use safe sandbox)
   */
  evaluateExpression(expression, context) {
    // WARNING: This is simplified. Use a proper expression evaluator in production
    // For now, just handle basic property access
    const match = expression.match(/^(\w+)\s*([+\-*/])\s*(\w+)$/);
    
    if (match) {
      const left = context[match[1]] || 0;
      const operator = match[2];
      const right = context[match[3]] || 0;
      
      switch (operator) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/': return right !== 0 ? left / right : 0;
      }
    }
    
    return context[expression] || null;
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export for use as a service
export default OnlineFeatureWorker;

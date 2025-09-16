/**
 * Test Suite for Feature Engineering Pipeline
 * Tests feature registry, materialization, and online/offline features
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FeatureRegistryService } from '../src/feature_engineering/registry.js';
import { OnlineFeatureWorker } from '../src/feature_engineering/stream_worker.js';
import { getDatabase } from '../../src/utils/database.js';
import { PostgresTenantHelper } from '../../src/utils/tenant-context.js';
import Redis from 'ioredis';

describe('Feature Engineering Pipeline', () => {
  let db;
  let redis;
  let featureRegistry;
  let testTenant = 'test-tenant';
  let testOwner = 'test-user';
  
  beforeAll(async () => {
    // Initialize database connection
    db = getDatabase();
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      db: 15 // Use separate DB for tests
    });
    
    // Initialize feature registry
    featureRegistry = new FeatureRegistryService();
    
    // Setup test schema if needed
    const client = await db.connect();
    try {
      await client.query('CREATE SCHEMA IF NOT EXISTS mlops');
      await client.query('CREATE SCHEMA IF NOT EXISTS telemetry');
    } finally {
      client.release();
    }
  });
  
  afterAll(async () => {
    // Cleanup test data
    const client = await db.connect();
    try {
      await client.query(`
        DELETE FROM mlops.feature_set WHERE tenant_id = $1
      `, [testTenant]);
    } finally {
      client.release();
    }
    
    await redis.quit();
  });
  
  describe('Feature Registry', () => {
    it('should register a new feature set', async () => {
      const spec = {
        name: 'test_features',
        description: 'Test feature set',
        source: 'telemetry.aggregates',
        features: [
          {
            name: 'avg_latency',
            type: 'aggregation',
            column: 'avg_value',
            aggregation: 'avg',
            window: '1h'
          },
          {
            name: 'request_count',
            type: 'aggregation',
            column: 'count',
            aggregation: 'sum',
            window: '1h'
          }
        ]
      };
      
      const result = await featureRegistry.registerFeatureSet(
        testTenant,
        spec,
        testOwner
      );
      
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.name).toBe('test_features');
      expect(result.version).toBe(1);
      expect(result.status).toBe('draft');
      expect(result.owner).toBe(testOwner);
    });
    
    it('should increment version for existing feature set', async () => {
      const spec = {
        name: 'test_features',
        description: 'Updated test feature set',
        source: 'telemetry.aggregates',
        features: [
          {
            name: 'avg_latency',
            type: 'aggregation',
            column: 'avg_value',
            aggregation: 'avg',
            window: '1h'
          },
          {
            name: 'request_count',
            type: 'aggregation',
            column: 'count',
            aggregation: 'sum',
            window: '1h'
          },
          {
            name: 'error_rate',
            type: 'expression',
            expression: 'error_count / total_count'
          }
        ]
      };
      
      const result = await featureRegistry.registerFeatureSet(
        testTenant,
        spec,
        testOwner
      );
      
      expect(result.version).toBe(2);
      expect(result.parent_version_id).toBeDefined();
    });
    
    it('should validate feature spec structure', async () => {
      const invalidSpec = {
        // Missing required 'name' field
        source: 'telemetry.aggregates',
        features: []
      };
      
      await expect(
        featureRegistry.registerFeatureSet(testTenant, invalidSpec, testOwner)
      ).rejects.toThrow('Feature spec must have a name');
    });
    
    it('should create lineage entries for features', async () => {
      const client = await db.connect();
      
      try {
        await PostgresTenantHelper.setTenantContext(client, testTenant);
        
        const result = await client.query(`
          SELECT * FROM mlops.feature_lineage
          WHERE tenant_id = $1
          ORDER BY created_at DESC
          LIMIT 5
        `, [testTenant]);
        
        expect(result.rows.length).toBeGreaterThan(0);
        expect(result.rows[0].downstream_feature).toBeDefined();
        expect(result.rows[0].upstream_table).toBeDefined();
      } finally {
        client.release();
      }
    });
  });
  
  describe('Feature Materialization', () => {
    let featureSetId;
    
    beforeEach(async () => {
      // Get the test feature set ID
      const client = await db.connect();
      try {
        await PostgresTenantHelper.setTenantContext(client, testTenant);
        
        const result = await client.query(`
          SELECT id FROM mlops.feature_set
          WHERE tenant_id = $1 AND name = $2
          ORDER BY version DESC
          LIMIT 1
        `, [testTenant, 'test_features']);
        
        if (result.rows.length > 0) {
          featureSetId = result.rows[0].id;
        }
      } finally {
        client.release();
      }
    });
    
    it('should materialize features offline', async () => {
      if (!featureSetId) {
        console.warn('Skipping test - no feature set found');
        return;
      }
      
      const result = await featureRegistry.materializeOffline(
        testTenant,
        featureSetId
      );
      
      expect(result.success).toBe(true);
      expect(result.viewName).toContain('features_test_features');
      expect(result.materializationId).toBeDefined();
    });
    
    it('should prevent duplicate offline materialization', async () => {
      if (!featureSetId) {
        console.warn('Skipping test - no feature set found');
        return;
      }
      
      await expect(
        featureRegistry.materializeOffline(testTenant, featureSetId)
      ).rejects.toThrow('Feature set already has offline materialization');
    });
    
    it('should record materialization metadata', async () => {
      if (!featureSetId) {
        console.warn('Skipping test - no feature set found');
        return;
      }
      
      const client = await db.connect();
      
      try {
        await PostgresTenantHelper.setTenantContext(client, testTenant);
        
        const result = await client.query(`
          SELECT * FROM mlops.feature_materialization
          WHERE feature_set_id = $1
        `, [featureSetId]);
        
        expect(result.rows.length).toBeGreaterThan(0);
        expect(result.rows[0].mode).toBe('offline');
        expect(result.rows[0].status).toBe('completed');
      } finally {
        client.release();
      }
    });
  });
  
  describe('Feature Vector Retrieval', () => {
    it('should get feature vector for entity', async () => {
      const result = await featureRegistry.getFeatureVector(
        testTenant,
        'test_features',
        1,
        'test-entity-1'
      );
      
      expect(result).toBeDefined();
      expect(result.features).toBeDefined();
      expect(result.computed_at).toBeDefined();
      expect(result.cache_hit).toBeDefined();
    });
    
    it('should cache feature vectors', async () => {
      // First call - should compute
      const result1 = await featureRegistry.getFeatureVector(
        testTenant,
        'test_features',
        1,
        'test-entity-2'
      );
      
      expect(result1.cache_hit).toBe(false);
      
      // Second call - should hit cache
      const result2 = await featureRegistry.getFeatureVector(
        testTenant,
        'test_features',
        1,
        'test-entity-2'
      );
      
      expect(result2.cache_hit).toBe(true);
      expect(result2.features).toEqual(result1.features);
    });
    
    it('should handle missing entities gracefully', async () => {
      const result = await featureRegistry.getFeatureVector(
        testTenant,
        'test_features',
        1,
        'non-existent-entity'
      );
      
      expect(result.missing).toBe(true);
      expect(result.features).toEqual({});
    });
  });
  
  describe('Online Feature Worker', () => {
    let worker;
    
    beforeEach(() => {
      worker = new OnlineFeatureWorker({
        consumerId: 'test-worker',
        consumerGroup: 'test-group',
        streamKey: 'test:events:*'
      });
    });
    
    afterEach(async () => {
      await worker.stop();
    });
    
    it('should parse events from Redis stream', () => {
      const streamData = [
        'tenant', 'test-tenant',
        'entityId', 'entity-1',
        'value', '42',
        'metadata', '{"source": "test"}'
      ];
      
      const event = worker.parseEvent(streamData);
      
      expect(event.tenant).toBe('test-tenant');
      expect(event.entityId).toBe('entity-1');
      expect(event.value).toBe('42');
      expect(event.metadata).toEqual({ source: 'test' });
    });
    
    it('should extract tenant from stream key', () => {
      const streamKey = 'telemetry:events:test-tenant:tools';
      const event = { entityId: 'test' };
      
      const tenant = worker.extractTenant(streamKey, event);
      
      expect(tenant).toBe('test-tenant');
    });
    
    it('should parse window specifications', () => {
      expect(worker.parseWindow('1h')).toBe(3600000);
      expect(worker.parseWindow('30m')).toBe(1800000);
      expect(worker.parseWindow('1d')).toBe(86400000);
      expect(worker.parseWindow('invalid')).toBe(3600000); // Default
    });
    
    it('should calculate standard deviation', () => {
      const values = [2, 4, 4, 4, 5, 5, 7, 9];
      const stddev = worker.calculateStdDev(values);
      
      expect(stddev).toBeCloseTo(2, 1);
    });
    
    it('should evaluate simple expressions', () => {
      const context = { a: 10, b: 5 };
      
      expect(worker.evaluateExpression('a + b', context)).toBe(15);
      expect(worker.evaluateExpression('a - b', context)).toBe(5);
      expect(worker.evaluateExpression('a * b', context)).toBe(50);
      expect(worker.evaluateExpression('a / b', context)).toBe(2);
    });
  });
  
  describe('Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      // Temporarily break the connection
      const originalDb = featureRegistry.db;
      featureRegistry.db = {
        connect: () => Promise.reject(new Error('Connection failed'))
      };
      
      await expect(
        featureRegistry.registerFeatureSet(testTenant, {}, testOwner)
      ).rejects.toThrow('Connection failed');
      
      // Restore connection
      featureRegistry.db = originalDb;
    });
    
    it('should handle invalid feature specs', async () => {
      const invalidSpecs = [
        { features: [] }, // Missing name and source
        { name: 'test', source: 'table' }, // Missing features
        { name: 'test', features: [{ type: 'invalid' }], source: 'table' } // Invalid feature
      ];
      
      for (const spec of invalidSpecs) {
        await expect(
          featureRegistry.registerFeatureSet(testTenant, spec, testOwner)
        ).rejects.toThrow();
      }
    });
    
    it('should handle Redis connection errors in online worker', async () => {
      const worker = new OnlineFeatureWorker();
      
      // Mock redis with error
      worker.redis = {
        xreadgroup: () => Promise.reject(new Error('Redis error')),
        quit: () => Promise.resolve()
      };
      
      // Should not throw, just log error
      await expect(worker.processLoop()).resolves.not.toThrow();
    });
  });
  
  describe('Boundary Cases', () => {
    it('should handle empty feature sets', async () => {
      const spec = {
        name: 'empty_features',
        source: 'telemetry.aggregates',
        features: []
      };
      
      await expect(
        featureRegistry.registerFeatureSet(testTenant, spec, testOwner)
      ).rejects.toThrow('Feature spec must have features array');
    });
    
    it('should handle very long feature names', async () => {
      const longName = 'a'.repeat(256);
      const spec = {
        name: longName,
        source: 'telemetry.aggregates',
        features: [
          {
            name: 'feature1',
            type: 'direct',
            column: 'col1'
          }
        ]
      };
      
      // Should truncate or reject based on DB constraints
      await expect(
        featureRegistry.registerFeatureSet(testTenant, spec, testOwner)
      ).rejects.toThrow();
    });
    
    it('should handle concurrent registrations', async () => {
      const spec = {
        name: 'concurrent_test',
        source: 'telemetry.aggregates',
        features: [
          {
            name: 'feature1',
            type: 'direct',
            column: 'col1'
          }
        ]
      };
      
      // Register concurrently
      const promises = Array(5).fill().map(() => 
        featureRegistry.registerFeatureSet(testTenant, spec, testOwner)
      );
      
      const results = await Promise.allSettled(promises);
      const successful = results.filter(r => r.status === 'fulfilled');
      
      // Should have sequential versions
      const versions = successful.map(r => r.value.version);
      expect(versions).toEqual(expect.arrayContaining([1, 2, 3, 4, 5]));
    });
  });
});

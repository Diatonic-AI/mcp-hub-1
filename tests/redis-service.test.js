/**
 * Comprehensive Test Suite for Redis Service
 * Tests all Redis service functionality including ML telemetry features
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import RedisService from '../src/services/redis-service.js';
import { createClient } from 'redis';

describe('Redis Service Integration Tests', () => {
  let redisService;
  let testClient;

  beforeAll(async () => {
    // Initialize Redis service
    redisService = new RedisService({
      host: '10.10.10.14',
      port: 6379,
      keyPrefix: 'test:mcp-hub:',
      enableCache: true,
      enablePubSub: true,
      cacheTTL: 60
    });

    // Connect service
    await redisService.connect();

    // Create separate client for test verification
    testClient = createClient({
      socket: { host: '10.10.10.14', port: 6379 }
    });
    await testClient.connect();
  });

  afterAll(async () => {
    // Cleanup test data
    const keys = await testClient.keys('test:mcp-hub:*');
    if (keys.length > 0) {
      await testClient.del(keys);
    }

    // Disconnect
    await redisService.disconnect();
    await testClient.disconnect();
  });

  beforeEach(async () => {
    // Clear test keys before each test
    const keys = await testClient.keys('test:mcp-hub:*');
    if (keys.length > 0) {
      await testClient.del(keys);
    }
    // Clear telemetry buffer
    redisService.telemetryBuffer = [];
  });

  describe('Connection Management', () => {
    it('should connect successfully', async () => {
      expect(redisService.connected).toBe(true);
      expect(redisService.client).toBeDefined();
    });

    it('should handle health check', async () => {
      const health = await redisService.healthCheck();
      
      expect(health.status).toBe('healthy');
      expect(health.connected).toBe(true);
      expect(health.host).toBe('10.10.10.14');
      expect(health.port).toBe(6379);
      expect(health.version).toBeDefined();
      expect(health.latencyMs).toBeLessThan(100);
    });
  });

  describe('Basic Cache Operations', () => {
    it('should set and get string values', async () => {
      const key = 'test:string';
      const value = 'Hello Redis';
      
      const setResult = await redisService.set(key, value);
      expect(setResult).toBe(true);
      
      const getValue = await redisService.get(key);
      expect(getValue).toBe(value);
    });

    it('should set and get JSON objects', async () => {
      const key = 'test:object';
      const value = {
        id: 'test-123',
        name: 'Test Object',
        data: { nested: true },
        timestamp: new Date().toISOString()
      };
      
      const setResult = await redisService.set(key, value);
      expect(setResult).toBe(true);
      
      const getValue = await redisService.get(key);
      expect(getValue).toEqual(value);
    });

    it('should handle TTL correctly', async () => {
      const key = 'test:ttl';
      const value = 'expires soon';
      
      await redisService.set(key, value, 1); // 1 second TTL
      
      const immediate = await redisService.get(key);
      expect(immediate).toBe(value);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const expired = await redisService.get(key);
      expect(expired).toBeNull();
    });

    it('should check existence correctly', async () => {
      const key = 'test:exists';
      
      const existsBefore = await redisService.exists(key);
      expect(existsBefore).toBe(false);
      
      await redisService.set(key, 'value');
      
      const existsAfter = await redisService.exists(key);
      expect(existsAfter).toBe(true);
    });

    it('should delete keys correctly', async () => {
      const key = 'test:delete';
      
      await redisService.set(key, 'to be deleted');
      const exists = await redisService.exists(key);
      expect(exists).toBe(true);
      
      const deleteResult = await redisService.delete(key);
      expect(deleteResult).toBe(true);
      
      const afterDelete = await redisService.exists(key);
      expect(afterDelete).toBe(false);
    });
  });

  describe('Tool Execution Cache', () => {
    it('should cache and retrieve tool results', async () => {
      const toolId = 'filesystem__read_file';
      const args = { path: '/tmp/test.txt' };
      const result = {
        content: 'File content here',
        size: 1024,
        modified: new Date().toISOString()
      };
      
      await redisService.cacheToolResult(toolId, args, result, 60);
      
      const cached = await redisService.getCachedToolResult(toolId, args);
      expect(cached).toBeDefined();
      expect(cached.toolId).toBe(toolId);
      expect(cached.args).toEqual(args);
      expect(cached.result).toEqual(result);
      expect(cached.cachedAt).toBeDefined();
    });

    it('should handle different args for same tool', async () => {
      const toolId = 'filesystem__read_file';
      const args1 = { path: '/tmp/file1.txt' };
      const args2 = { path: '/tmp/file2.txt' };
      const result1 = { content: 'File 1' };
      const result2 = { content: 'File 2' };
      
      await redisService.cacheToolResult(toolId, args1, result1);
      await redisService.cacheToolResult(toolId, args2, result2);
      
      const cached1 = await redisService.getCachedToolResult(toolId, args1);
      const cached2 = await redisService.getCachedToolResult(toolId, args2);
      
      expect(cached1.result).toEqual(result1);
      expect(cached2.result).toEqual(result2);
    });
  });

  describe('ML Telemetry Features', () => {
    it('should buffer telemetry events', async () => {
      const event = {
        id: 'event-123',
        tenant: 'test-tenant',
        toolId: 'test-tool',
        serverName: 'test-server',
        phase: 'start',
        timestamp: new Date().toISOString()
      };
      
      await redisService.bufferTelemetryEvent(event);
      
      expect(redisService.telemetryBuffer.length).toBe(1);
      expect(redisService.telemetryBuffer[0]).toMatchObject(event);
      expect(redisService.telemetryBuffer[0].bufferedAt).toBeDefined();
    });

    it('should flush telemetry buffer to Redis', async () => {
      // Add multiple events
      const events = Array.from({ length: 5 }, (_, i) => ({
        id: `event-${i}`,
        tenant: 'test-tenant',
        toolId: `tool-${i}`,
        timestamp: new Date().toISOString()
      }));
      
      for (const event of events) {
        await redisService.bufferTelemetryEvent(event);
      }
      
      expect(redisService.telemetryBuffer.length).toBe(5);
      
      // Manually flush
      await redisService.flushTelemetry();
      
      expect(redisService.telemetryBuffer.length).toBe(0);
      
      // Verify events were stored in Redis
      const dateKey = new Date().toISOString().split('T')[0];
      const listKey = `test:mcp-hub:telemetry:events:${dateKey}`;
      const storedCount = await testClient.lLen(listKey);
      expect(storedCount).toBe(5);
    });

    it('should auto-flush when buffer is full', async () => {
      // Set small batch size for testing
      redisService.telemetryMaxBatchSize = 3;
      
      // Add events exceeding batch size
      for (let i = 0; i < 4; i++) {
        await redisService.bufferTelemetryEvent({
          id: `auto-flush-${i}`,
          timestamp: new Date().toISOString()
        });
      }
      
      // Should have auto-flushed at 3, leaving 1 in buffer
      expect(redisService.telemetryBuffer.length).toBe(1);
      
      // Reset batch size
      redisService.telemetryMaxBatchSize = 100;
    });
  });

  describe('ML Feature Store', () => {
    it('should store and retrieve feature vectors', async () => {
      const featureSet = 'embeddings';
      const entityId = 'doc-123';
      const vector = [0.1, 0.2, 0.3, 0.4, 0.5];
      const metadata = {
        model: 'text-embedding-ada-002',
        dimensions: 5
      };
      
      const stored = await redisService.storeFeatureVector(
        featureSet, 
        entityId, 
        vector, 
        metadata
      );
      expect(stored).toBe(true);
      
      const retrieved = await redisService.getFeatureVector(featureSet, entityId);
      expect(retrieved).toBeDefined();
      expect(retrieved.vector).toEqual(vector);
      expect(retrieved.metadata).toEqual(metadata);
      expect(retrieved.timestamp).toBeDefined();
    });

    it('should get recent features', async () => {
      const featureSet = 'test-features';
      
      // Store multiple features with slight delays
      for (let i = 0; i < 5; i++) {
        await redisService.storeFeatureVector(
          featureSet,
          `entity-${i}`,
          [i, i+1, i+2],
          { index: i }
        );
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      const recent = await redisService.getRecentFeatures(featureSet, 3);
      expect(recent).toHaveLength(3);
      
      // Should get the most recent ones
      expect(recent[0].entityId).toBe('entity-2');
      expect(recent[1].entityId).toBe('entity-3');
      expect(recent[2].entityId).toBe('entity-4');
    });
  });

  describe('Session Management', () => {
    it('should create and retrieve sessions', async () => {
      const sessionId = 'session-123';
      const sessionData = {
        userId: 'user-456',
        tenant: 'test-tenant',
        permissions: ['read', 'write']
      };
      
      await redisService.createSession(sessionId, sessionData, 300);
      
      const retrieved = await redisService.getSession(sessionId);
      expect(retrieved).toBeDefined();
      expect(retrieved.userId).toBe(sessionData.userId);
      expect(retrieved.createdAt).toBeDefined();
      expect(retrieved.lastAccessed).toBeDefined();
    });

    it('should update last accessed time', async () => {
      const sessionId = 'session-update';
      await redisService.createSession(sessionId, { test: true });
      
      const initial = await redisService.getSession(sessionId);
      const firstAccessed = initial.lastAccessed;
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const updated = await redisService.getSession(sessionId);
      expect(updated.lastAccessed).not.toBe(firstAccessed);
    });

    it('should delete sessions', async () => {
      const sessionId = 'session-delete';
      await redisService.createSession(sessionId, { test: true });
      
      const exists = await redisService.getSession(sessionId);
      expect(exists).toBeDefined();
      
      await redisService.deleteSession(sessionId);
      
      const deleted = await redisService.getSession(sessionId);
      expect(deleted).toBeNull();
    });
  });

  describe('Rate Limiting', () => {
    it('should track rate limits correctly', async () => {
      const clientId = 'test-client';
      const limit = 5;
      const window = 60;
      
      // First request
      const first = await redisService.checkRateLimit(clientId, limit, window);
      expect(first.allowed).toBe(true);
      expect(first.count).toBe(1);
      expect(first.remaining).toBe(4);
      
      // Multiple requests
      for (let i = 0; i < 3; i++) {
        await redisService.checkRateLimit(clientId, limit, window);
      }
      
      const fifth = await redisService.checkRateLimit(clientId, limit, window);
      expect(fifth.allowed).toBe(true);
      expect(fifth.count).toBe(5);
      expect(fifth.remaining).toBe(0);
      
      // Exceed limit
      const sixth = await redisService.checkRateLimit(clientId, limit, window);
      expect(sixth.allowed).toBe(false);
      expect(sixth.count).toBe(6);
      expect(sixth.remaining).toBe(0);
    });
  });

  describe('Distributed Locks', () => {
    it('should acquire and release locks', async () => {
      const resource = 'test-resource';
      
      const lockId = await redisService.acquireLock(resource, 5000);
      expect(lockId).toBeDefined();
      expect(lockId).not.toBeNull();
      
      // Try to acquire same lock (should fail)
      const secondLock = await redisService.acquireLock(resource, 5000);
      expect(secondLock).toBeNull();
      
      // Release lock
      const released = await redisService.releaseLock(resource, lockId);
      expect(released).toBe(true);
      
      // Now should be able to acquire again
      const newLock = await redisService.acquireLock(resource, 5000);
      expect(newLock).toBeDefined();
      
      // Cleanup
      await redisService.releaseLock(resource, newLock);
    });

    it('should not release lock with wrong ID', async () => {
      const resource = 'secure-resource';
      
      const lockId = await redisService.acquireLock(resource, 5000);
      expect(lockId).toBeDefined();
      
      // Try to release with wrong ID
      const wrongRelease = await redisService.releaseLock(resource, 'wrong-id');
      expect(wrongRelease).toBe(false);
      
      // Verify lock still held
      const tryAcquire = await redisService.acquireLock(resource, 5000);
      expect(tryAcquire).toBeNull();
      
      // Cleanup with correct ID
      await redisService.releaseLock(resource, lockId);
    });

    it('should auto-expire locks', async () => {
      const resource = 'auto-expire';
      
      const lockId = await redisService.acquireLock(resource, 100); // 100ms TTL
      expect(lockId).toBeDefined();
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Should be able to acquire now
      const newLock = await redisService.acquireLock(resource, 5000);
      expect(newLock).toBeDefined();
      
      // Cleanup
      await redisService.releaseLock(resource, newLock);
    });
  });

  describe('Pub/Sub Functionality', () => {
    it('should publish and receive messages', async () => {
      const channel = 'test-channel';
      const testMessage = {
        type: 'test',
        data: 'Hello Pub/Sub',
        timestamp: new Date().toISOString()
      };
      
      let received = null;
      
      // Subscribe
      await redisService.subscribe(channel, (message) => {
        received = message;
      });
      
      // Give subscription time to setup
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Publish
      await redisService.publish(channel, testMessage);
      
      // Wait for message
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(received).toEqual(testMessage);
      
      // Cleanup
      await redisService.unsubscribe(channel);
    });

    it('should handle multiple subscribers', async () => {
      const channel = 'multi-sub';
      const messages = [];
      
      // Create second service instance
      const service2 = new RedisService({
        host: '10.10.10.14',
        port: 6379,
        keyPrefix: 'test:mcp-hub:',
        enablePubSub: true
      });
      await service2.connect();
      
      // Subscribe both
      await redisService.subscribe(channel, (msg) => {
        messages.push({ service: 1, msg });
      });
      
      await service2.subscribe(channel, (msg) => {
        messages.push({ service: 2, msg });
      });
      
      // Wait for subscriptions
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Publish
      await redisService.publish(channel, { test: 'broadcast' });
      
      // Wait for messages
      await new Promise(resolve => setTimeout(resolve, 200));
      
      expect(messages.length).toBe(2);
      expect(messages[0].msg).toEqual({ test: 'broadcast' });
      expect(messages[1].msg).toEqual({ test: 'broadcast' });
      
      // Cleanup
      await redisService.unsubscribe(channel);
      await service2.disconnect();
    });
  });

  describe('Error Handling', () => {
    it('should handle cache misses gracefully', async () => {
      const result = await redisService.get('non-existent-key');
      expect(result).toBeNull();
    });

    it('should handle invalid JSON gracefully', async () => {
      // Directly set a non-JSON string
      await testClient.set('test:mcp-hub:invalid-json', 'not json {]');
      
      const result = await redisService.get('invalid-json');
      expect(result).toBe('not json {]'); // Should return as string
    });

    it('should return safe defaults on rate limit errors', async () => {
      // Temporarily break connection
      const originalClient = redisService.client;
      redisService.client = null;
      
      const result = await redisService.checkRateLimit('test-client');
      expect(result.allowed).toBe(true); // Safe default
      expect(result.count).toBe(0);
      
      // Restore
      redisService.client = originalClient;
    });
  });

  describe('Performance', () => {
    it('should handle high volume operations', async () => {
      const start = Date.now();
      const operations = 100;
      
      const promises = [];
      for (let i = 0; i < operations; i++) {
        promises.push(redisService.set(`perf:${i}`, { index: i }));
      }
      
      await Promise.all(promises);
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(1000); // Should complete 100 ops in < 1 second
      
      // Verify all were set
      const exists = await redisService.exists('perf:50');
      expect(exists).toBe(true);
    });

    it('should handle concurrent reads efficiently', async () => {
      // Pre-populate data
      for (let i = 0; i < 10; i++) {
        await redisService.set(`concurrent:${i}`, { value: i });
      }
      
      const start = Date.now();
      
      // Concurrent reads
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(redisService.get(`concurrent:${i % 10}`));
      }
      
      const results = await Promise.all(promises);
      const duration = Date.now() - start;
      
      expect(results.length).toBe(50);
      expect(duration).toBeLessThan(500); // 50 reads in < 500ms
    });
  });
});

// Export test utilities for other tests
export const createTestRedisService = () => {
  return new RedisService({
    host: '10.10.10.14',
    port: 6379,
    keyPrefix: 'test:',
    enableCache: true,
    enablePubSub: true
  });
};

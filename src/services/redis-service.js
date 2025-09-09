/**
 * Redis Service for MCP Hub
 * Provides caching, pub/sub, rate limiting, and ML telemetry buffering
 */

import { createClient } from 'redis';
import logger from '../utils/logger.js';
import { ConnectionError } from '../utils/errors.js';

export class RedisService {
  constructor(config = {}) {
    this.config = {
      host: process.env.REDIS_HOST || '10.10.10.14',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      db: parseInt(process.env.REDIS_DB) || 0,
      keyPrefix: process.env.REDIS_KEY_PREFIX || 'mcp-hub:',
      enableCache: process.env.REDIS_ENABLE_CACHE === 'true',
      cacheTTL: parseInt(process.env.REDIS_CACHE_TTL) || 300,
      enablePubSub: process.env.REDIS_ENABLE_PUBSUB === 'true',
      maxRetries: parseInt(process.env.REDIS_MAX_RETRIES) || 10,
      retryDelayMs: parseInt(process.env.REDIS_RETRY_DELAY_MS) || 100,
      ...config
    };

    this.client = null;
    this.subscriber = null;
    this.publisher = null;
    this.connected = false;
    this.subscriptions = new Map();
    
    // ML telemetry specific
    this.telemetryBuffer = [];
    this.telemetryFlushInterval = null;
    this.telemetryMaxBatchSize = 100;
    this.telemetryFlushIntervalMs = 5000;
  }

  async connect() {
    if (this.connected) {
      return;
    }

    try {
      // Main client for general operations
      this.client = createClient({
        socket: {
          host: this.config.host,
          port: this.config.port
        },
        database: this.config.db
      });

      this.client.on('error', (err) => {
      logger.error('REDIS_CLIENT_ERROR', 'Redis client error', { error: err.message }, false);
      });

      this.client.on('ready', () => {
        logger.info('Redis client ready', { 
          host: this.config.host, 
          port: this.config.port 
        });
      });

      await this.client.connect();

      // Setup pub/sub if enabled
      if (this.config.enablePubSub) {
        await this.setupPubSub();
      }

      // Start telemetry flush interval
      this.startTelemetryFlush();

      this.connected = true;
      logger.info('Redis service connected successfully', {
        host: this.config.host,
        cacheEnabled: this.config.enableCache,
        pubSubEnabled: this.config.enablePubSub
      });

      // Test connection
      await this.client.ping();
      
    } catch (error) {
      logger.error('REDIS_CONNECTION_ERROR', 'Failed to connect to Redis', { 
        error: error.message,
        host: this.config.host,
        port: this.config.port
      }, false);
      throw new ConnectionError(
        `Redis connection failed: ${error.message}`
      );
    }
  }

  async setupPubSub() {
    // Create dedicated clients for pub/sub
    this.subscriber = this.client.duplicate();
    this.publisher = this.client.duplicate();

    await this.subscriber.connect();
    await this.publisher.connect();

    logger.info('Redis pub/sub clients initialized');
  }

  async disconnect() {
    if (!this.connected) {
      return;
    }

    try {
      // Stop telemetry flush
      if (this.telemetryFlushInterval) {
        clearInterval(this.telemetryFlushInterval);
        await this.flushTelemetry(); // Final flush
      }

      // Disconnect all clients
      if (this.subscriber) await this.subscriber.disconnect();
      if (this.publisher) await this.publisher.disconnect();
      if (this.client) await this.client.disconnect();

      this.connected = false;
      logger.info('Redis service disconnected');
    } catch (error) {
      logger.error('REDIS_DISCONNECT_ERROR', 'Error disconnecting from Redis', { error: error.message }, false);
    }
  }

  // ========== Caching Methods ==========

  async get(key) {
    if (!this.config.enableCache) return null;
    
    try {
      const fullKey = this.config.keyPrefix + key;
      const value = await this.client.get(fullKey);
      
      if (value) {
        try {
          return JSON.parse(value);
        } catch {
          return value; // Return as string if not JSON
        }
      }
      return null;
    } catch (error) {
      logger.warn('Redis get error', { key, error: error.message });
      return null;
    }
  }

  async set(key, value, ttl = null) {
    if (!this.config.enableCache) return false;
    
    try {
      const fullKey = this.config.keyPrefix + key;
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      const options = {};
      
      if (ttl || this.config.cacheTTL) {
        options.EX = ttl || this.config.cacheTTL;
      }
      
      await this.client.set(fullKey, serialized, options);
      return true;
    } catch (error) {
      logger.warn('Redis set error', { key, error: error.message });
      return false;
    }
  }

  async delete(key) {
    try {
      const fullKey = this.config.keyPrefix + key;
      await this.client.del(fullKey);
      return true;
    } catch (error) {
      logger.warn('Redis delete error', { key, error: error.message });
      return false;
    }
  }

  async exists(key) {
    try {
      const fullKey = this.config.keyPrefix + key;
      return await this.client.exists(fullKey) === 1;
    } catch (error) {
      logger.warn('Redis exists error', { key, error: error.message });
      return false;
    }
  }

  // ========== Tool Execution Cache ==========

  async cacheToolResult(toolId, args, result, ttl = 300) {
    const cacheKey = `tool:${toolId}:${this.hashArgs(args)}`;
    return await this.set(cacheKey, {
      toolId,
      args,
      result,
      cachedAt: new Date().toISOString()
    }, ttl);
  }

  async getCachedToolResult(toolId, args) {
    const cacheKey = `tool:${toolId}:${this.hashArgs(args)}`;
    return await this.get(cacheKey);
  }

  hashArgs(args) {
    // Simple hash for cache key generation
    const str = JSON.stringify(args);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  // ========== Pub/Sub Methods ==========

  async publish(channel, data) {
    if (!this.config.enablePubSub || !this.publisher) {
      return false;
    }

    try {
      const fullChannel = this.config.keyPrefix + channel;
      const message = typeof data === 'string' ? data : JSON.stringify(data);
      await this.publisher.publish(fullChannel, message);
      
      logger.debug('Published to Redis channel', { 
        channel: fullChannel,
        dataSize: message.length 
      });
      return true;
    } catch (error) {
      logger.error('REDIS_PUBLISH_ERROR', 'Redis publish error', { channel, error: error.message }, false);
      return false;
    }
  }

  async subscribe(channel, callback) {
    if (!this.config.enablePubSub || !this.subscriber) {
      throw new ConnectionError('Pub/Sub not enabled');
    }

    try {
      const fullChannel = this.config.keyPrefix + channel;
      
      await this.subscriber.subscribe(fullChannel, (message) => {
        try {
          const parsed = JSON.parse(message);
          callback(parsed);
        } catch {
          callback(message);
        }
      });

      this.subscriptions.set(channel, callback);
      logger.info('Subscribed to Redis channel', { channel: fullChannel });
      return true;
    } catch (error) {
      logger.error('REDIS_SUBSCRIBE_ERROR', 'Redis subscribe error', { channel, error: error.message }, false);
      throw new ConnectionError(`Subscribe failed: ${error.message}`);
    }
  }

  async unsubscribe(channel) {
    if (!this.subscriber) return false;

    try {
      const fullChannel = this.config.keyPrefix + channel;
      await this.subscriber.unsubscribe(fullChannel);
      this.subscriptions.delete(channel);
      logger.info('Unsubscribed from Redis channel', { channel: fullChannel });
      return true;
    } catch (error) {
      logger.error('REDIS_UNSUBSCRIBE_ERROR', 'Redis unsubscribe error', { channel, error: error.message }, false);
      return false;
    }
  }

  // ========== Rate Limiting ==========

  async checkRateLimit(clientId, limit = 100, window = 60) {
    const key = `ratelimit:${clientId}`;
    const fullKey = this.config.keyPrefix + key;

    try {
      const multi = this.client.multi();
      multi.incr(fullKey);
      multi.expire(fullKey, window);
      const results = await multi.exec();
      
      const count = results[0];
      return {
        allowed: count <= limit,
        count,
        limit,
        remaining: Math.max(0, limit - count),
        resetIn: window
      };
    } catch (error) {
      logger.error('REDIS_RATE_LIMIT_ERROR', 'Rate limit check error', { clientId, error: error.message }, false);
      return { allowed: true, count: 0, limit, remaining: limit };
    }
  }

  // ========== ML Telemetry Methods ==========

  async bufferTelemetryEvent(event) {
    // Add to in-memory buffer
    this.telemetryBuffer.push({
      ...event,
      bufferedAt: new Date().toISOString()
    });

    // Flush if buffer is full
    if (this.telemetryBuffer.length >= this.telemetryMaxBatchSize) {
      await this.flushTelemetry();
    }
  }

  async flushTelemetry() {
    if (this.telemetryBuffer.length === 0) {
      return;
    }

    const events = [...this.telemetryBuffer];
    this.telemetryBuffer = [];

    try {
      // Store in Redis list for processing
      const key = `telemetry:events:${new Date().toISOString().split('T')[0]}`;
      const fullKey = this.config.keyPrefix + key;
      
      for (const event of events) {
        await this.client.lPush(fullKey, JSON.stringify(event));
      }
      
      // Set TTL on the list (7 days)
      await this.client.expire(fullKey, 7 * 24 * 60 * 60);
      
      // Publish notification about new events
      await this.publish('telemetry:new_events', {
        count: events.length,
        key: fullKey,
        timestamp: new Date().toISOString()
      });

      logger.debug('Flushed telemetry events to Redis', { 
        count: events.length,
        key: fullKey 
      });
    } catch (error) {
      logger.error('REDIS_TELEMETRY_FLUSH_ERROR', 'Failed to flush telemetry', { error: error.message }, false);
      // Put events back in buffer for retry
      this.telemetryBuffer.unshift(...events);
    }
  }

  startTelemetryFlush() {
    this.telemetryFlushInterval = setInterval(
      () => this.flushTelemetry(),
      this.telemetryFlushIntervalMs
    );
  }

  // ========== ML Feature Store Methods ==========

  async storeFeatureVector(featureSet, entityId, vector, metadata = {}) {
    const key = `features:${featureSet}:${entityId}`;
    const fullKey = this.config.keyPrefix + key;
    
    const data = {
      featureSet,
      entityId,
      vector,
      metadata,
      timestamp: new Date().toISOString()
    };

    try {
      await this.client.set(fullKey, JSON.stringify(data), {
        EX: 3600 // 1 hour TTL for feature cache
      });
      
      // Also store in sorted set for range queries
      const scoreKey = `features:${featureSet}:scores`;
      await this.client.zAdd(this.config.keyPrefix + scoreKey, {
        score: Date.now(),
        value: entityId
      });
      
      return true;
    } catch (error) {
      logger.error('REDIS_FEATURE_STORE_ERROR', 'Failed to store feature vector', { 
        featureSet, 
        entityId, 
        error: error.message 
      }, false);
      return false;
    }
  }

  async getFeatureVector(featureSet, entityId) {
    const key = `features:${featureSet}:${entityId}`;
    return await this.get(key);
  }

  async getRecentFeatures(featureSet, limit = 10) {
    const scoreKey = `features:${featureSet}:scores`;
    const fullScoreKey = this.config.keyPrefix + scoreKey;
    
    try {
      // Get most recent entity IDs
      const entityIds = await this.client.zRange(fullScoreKey, -limit, -1);
      
      // Fetch feature vectors
      const features = [];
      for (const entityId of entityIds) {
        const feature = await this.getFeatureVector(featureSet, entityId);
        if (feature) {
          features.push(feature);
        }
      }
      
      return features;
    } catch (error) {
      logger.error('REDIS_FEATURE_GET_ERROR', 'Failed to get recent features', { 
        featureSet, 
        error: error.message 
      }, false);
      return [];
    }
  }

  // ========== Session Management ==========

  async createSession(sessionId, data, ttl = 3600) {
    const key = `sessions:${sessionId}`;
    return await this.set(key, {
      ...data,
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString()
    }, ttl);
  }

  async getSession(sessionId) {
    const key = `sessions:${sessionId}`;
    const session = await this.get(key);
    
    if (session) {
      // Update last accessed time
      session.lastAccessed = new Date().toISOString();
      await this.set(key, session, 3600); // Refresh TTL
    }
    
    return session;
  }

  async deleteSession(sessionId) {
    const key = `sessions:${sessionId}`;
    return await this.delete(key);
  }

  // ========== Distributed Locks ==========

  async acquireLock(resource, ttl = 10000) {
    const lockKey = `locks:${resource}`;
    const fullKey = this.config.keyPrefix + lockKey;
    const lockId = Math.random().toString(36).substring(7);
    
    try {
      const result = await this.client.set(fullKey, lockId, {
        NX: true, // Only set if not exists
        PX: ttl   // TTL in milliseconds
      });
      
      if (result === 'OK') {
        return lockId;
      }
      return null;
    } catch (error) {
      logger.error('REDIS_LOCK_ACQUIRE_ERROR', 'Failed to acquire lock', { resource, error: error.message }, false);
      return null;
    }
  }

  async releaseLock(resource, lockId) {
    const lockKey = `locks:${resource}`;
    const fullKey = this.config.keyPrefix + lockKey;
    
    try {
      const currentLockId = await this.client.get(fullKey);
      if (currentLockId === lockId) {
        await this.client.del(fullKey);
        return true;
      }
      return false;
    } catch (error) {
      logger.error('REDIS_LOCK_RELEASE_ERROR', 'Failed to release lock', { resource, error: error.message }, false);
      return false;
    }
  }

  // ========== Health Check ==========

  async healthCheck() {
    try {
      const start = Date.now();
      await this.client.ping();
      const latency = Date.now() - start;
      
      const info = await this.client.info('server');
      const version = info.match(/redis_version:([^\r\n]+)/)?.[1];
      
      const memInfo = await this.client.info('memory');
      const usedMemory = memInfo.match(/used_memory_human:([^\r\n]+)/)?.[1];
      
      return {
        status: 'healthy',
        latencyMs: latency,
        version,
        usedMemory,
        connected: this.connected,
        host: this.config.host,
        port: this.config.port,
        cacheEnabled: this.config.enableCache,
        pubSubEnabled: this.config.enablePubSub,
        telemetryBufferSize: this.telemetryBuffer.length
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        connected: false
      };
    }
  }
}

// Singleton instance
let redisService = null;

export function getRedisService(config) {
  if (!redisService) {
    redisService = new RedisService(config);
  }
  return redisService;
}

export default RedisService;

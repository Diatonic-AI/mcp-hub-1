/**
 * Redis Streams Infrastructure for MCP Hub Telemetry
 * Manages stream producers, consumer groups, and real-time event processing
 * Implements telemetry.raw, telemetry.features, and telemetry.anomaly streams
 */

import { createClient } from 'redis';
import logger from '../utils/logger.js';
import { ServerError, wrapError } from '../utils/errors.js';
import { telemetryEnvelope } from './envelope.js';

// Default configuration
const DEFAULT_CONFIG = {
  url: process.env.REDIS_URI || 'redis://10.10.10.14:6379/0',
  maxRetries: parseInt(process.env.REDIS_MAX_RETRIES || '5'),
  retryDelay: parseInt(process.env.REDIS_RETRY_DELAY || '1000'),
  maxReconnectDelay: parseInt(process.env.REDIS_MAX_RECONNECT_DELAY || '30000'),
  blockTimeout: parseInt(process.env.REDIS_BLOCK_TIMEOUT || '5000'),
  maxLength: parseInt(process.env.REDIS_STREAM_MAX_LENGTH || '100000'),
  trimStrategy: process.env.REDIS_TRIM_STRATEGY || 'MAXLEN'
};

// Stream names
export const STREAMS = {
  RAW: 'telemetry:raw',
  FEATURES: 'telemetry:features',
  ANOMALY: 'telemetry:anomaly'
};

// Consumer groups
export const CONSUMER_GROUPS = {
  INGESTORS: 'ingestors',
  WRITERS: 'writers',
  DETECTORS: 'detectors'
};

// Hot metrics keys
export const HOT_KEYS = {
  TOOL_STATS: 'telemetry:tool:stats',
  TOP_LATENCY: 'telemetry:top:latency',
  TOP_ERROR_RATE: 'telemetry:top:error_rate',
  RECENT_ANOMALIES: 'telemetry:recent:anomalies'
};

/**
 * Redis Stream Manager
 * Handles all stream operations for telemetry pipeline
 */
export class StreamManager {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.client = null;
    this.isConnected = false;
    this.consumers = new Map();
    this.reconnectTimer = null;
    this.shutdownInProgress = false;
  }

  /**
   * Initialize Redis client and create streams/groups
   */
  async initialize() {
    try {
      logger.info('REDIS_INIT', 'Initializing Redis stream manager', {
        url: this.config.url.replace(/:[^:@]+@/, ':***@') // Redact password
      });

      // Create Redis client
      this.client = createClient({
        url: this.config.url,
        socket: {
          reconnectStrategy: (retries) => {
            if (this.shutdownInProgress) return null;
            
            const delay = Math.min(
              this.config.retryDelay * Math.pow(2, retries),
              this.config.maxReconnectDelay
            );
            
            logger.warn('REDIS_RECONNECT', `Reconnecting to Redis (attempt ${retries})`, {
              delay
            });
            
            return delay;
          }
        }
      });

      // Set up event handlers
      this.client.on('error', (err) => {
        logger.error('REDIS_ERROR', 'Redis client error', { error: err.message });
      });

      this.client.on('connect', () => {
        logger.info('REDIS_CONNECTED', 'Connected to Redis');
        this.isConnected = true;
      });

      this.client.on('ready', () => {
        logger.info('REDIS_READY', 'Redis client ready');
      });

      this.client.on('end', () => {
        logger.info('REDIS_DISCONNECTED', 'Disconnected from Redis');
        this.isConnected = false;
      });

      // Connect to Redis
      await this.client.connect();

      // Initialize streams and consumer groups
      await this.initializeStreams();
      await this.initializeConsumerGroups();

      logger.info('REDIS_INITIALIZED', 'Redis stream manager initialized successfully');
      
      return true;
    } catch (error) {
      throw wrapError(error, 'REDIS_INIT_ERROR', {
        url: this.config.url.replace(/:[^:@]+@/, ':***@')
      });
    }
  }

  /**
   * Initialize streams if they don't exist
   */
  async initializeStreams() {
    for (const [name, streamKey] of Object.entries(STREAMS)) {
      try {
        // Check if stream exists by trying to get info
        const info = await this.client.xInfoStream(streamKey).catch(() => null);
        
        if (!info) {
          // Create stream with initial entry
          await this.client.xAdd(
            streamKey,
            '*',
            { initialized: 'true', timestamp: Date.now().toString() }
          );
          
          logger.info('STREAM_CREATED', `Created stream: ${streamKey}`);
        } else {
          logger.debug('STREAM_EXISTS', `Stream already exists: ${streamKey}`, {
            length: info.length,
            firstEntry: info.firstEntry?.id,
            lastEntry: info.lastEntry?.id
          });
        }
      } catch (error) {
        logger.error('STREAM_INIT_ERROR', `Failed to initialize stream: ${streamKey}`, {
          error: error.message
        });
      }
    }
  }

  /**
   * Initialize consumer groups
   */
  async initializeConsumerGroups() {
    const groupConfig = [
      { stream: STREAMS.RAW, group: CONSUMER_GROUPS.INGESTORS },
      { stream: STREAMS.FEATURES, group: CONSUMER_GROUPS.WRITERS },
      { stream: STREAMS.ANOMALY, group: CONSUMER_GROUPS.DETECTORS }
    ];

    for (const { stream, group } of groupConfig) {
      try {
        // Try to create consumer group
        await this.client.xGroupCreate(stream, group, '0', {
          MKSTREAM: true
        }).catch(err => {
          // Group might already exist, which is fine
          if (!err.message.includes('BUSYGROUP')) {
            throw err;
          }
        });
        
        logger.info('CONSUMER_GROUP_READY', `Consumer group ready: ${group} on ${stream}`);
      } catch (error) {
        logger.error('CONSUMER_GROUP_ERROR', `Failed to create consumer group`, {
          stream,
          group,
          error: error.message
        });
      }
    }
  }

  /**
   * Publish event to stream (non-blocking)
   */
  async publish(streamKey, data, options = {}) {
    if (!this.isConnected) {
      logger.warn('PUBLISH_DROPPED', 'Cannot publish - Redis not connected', {
        stream: streamKey
      });
      return null;
    }

    try {
      // Create envelope if not already wrapped
      const envelope = data.id ? data : telemetryEnvelope.create(data);
      
      // Convert to Redis field-value pairs
      const fields = this.flattenForRedis(envelope);
      
      // Add to stream with auto-generated ID
      const messageId = await this.client.xAdd(
        streamKey,
        '*',
        fields,
        {
          TRIM: {
            strategy: this.config.trimStrategy,
            strategyModifier: '~',
            threshold: this.config.maxLength
          }
        }
      );

      logger.debug('EVENT_PUBLISHED', 'Published event to stream', {
        stream: streamKey,
        messageId,
        eventId: envelope.id
      });

      return messageId;
    } catch (error) {
      // Non-blocking - log and continue
      logger.warn('PUBLISH_ERROR', 'Failed to publish event', {
        stream: streamKey,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Consume from stream with consumer group
   */
  async consume(streamKey, groupName, consumerName, handler, options = {}) {
    const {
      count = 10,
      blockTimeout = this.config.blockTimeout,
      autoAck = true
    } = options;

    const consumerId = `${groupName}:${consumerName}`;
    
    if (this.consumers.has(consumerId)) {
      logger.warn('CONSUMER_EXISTS', `Consumer already running: ${consumerId}`);
      return;
    }

    const consumerState = {
      running: true,
      processed: 0,
      errors: 0
    };

    this.consumers.set(consumerId, consumerState);

    logger.info('CONSUMER_STARTED', `Started consumer: ${consumerId}`, {
      stream: streamKey,
      count,
      blockTimeout
    });

    // Consumer loop
    while (consumerState.running && this.isConnected) {
      try {
        // Read from stream
        const messages = await this.client.xReadGroup(
          groupName,
          consumerName,
          [
            {
              key: streamKey,
              id: '>'
            }
          ],
          {
            COUNT: count,
            BLOCK: blockTimeout
          }
        );

        if (!messages || messages.length === 0) {
          continue;
        }

        // Process each message
        for (const streamData of messages) {
          for (const message of streamData.messages) {
            try {
              // Parse message data
              const data = this.parseRedisMessage(message.message);
              
              // Call handler
              await handler({
                id: message.id,
                stream: streamData.name,
                data,
                ack: async () => {
                  if (autoAck) {
                    await this.ack(streamKey, groupName, message.id);
                  }
                }
              });

              consumerState.processed++;

              // Auto-acknowledge if enabled
              if (autoAck) {
                await this.ack(streamKey, groupName, message.id);
              }
            } catch (error) {
              consumerState.errors++;
              logger.error('CONSUMER_HANDLER_ERROR', 'Error processing message', {
                consumerId,
                messageId: message.id,
                error: error.message
              });
            }
          }
        }
      } catch (error) {
        if (!this.isConnected || this.shutdownInProgress) {
          break;
        }
        
        logger.error('CONSUMER_ERROR', 'Error in consumer loop', {
          consumerId,
          error: error.message
        });
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    this.consumers.delete(consumerId);
    
    logger.info('CONSUMER_STOPPED', `Stopped consumer: ${consumerId}`, {
      processed: consumerState.processed,
      errors: consumerState.errors
    });
  }

  /**
   * Acknowledge message processing
   */
  async ack(streamKey, groupName, messageId) {
    try {
      await this.client.xAck(streamKey, groupName, messageId);
      
      logger.debug('MESSAGE_ACKED', 'Message acknowledged', {
        stream: streamKey,
        group: groupName,
        messageId
      });
    } catch (error) {
      logger.error('ACK_ERROR', 'Failed to acknowledge message', {
        stream: streamKey,
        group: groupName,
        messageId,
        error: error.message
      });
    }
  }

  /**
   * Update hot metrics in Redis
   */
  async updateHotMetrics(server, tool, metrics) {
    if (!this.isConnected) return;

    const toolKey = `${server}__${tool}`;
    const statsKey = `${HOT_KEYS.TOOL_STATS}:${toolKey}`;

    try {
      // Update hash with metrics
      await this.client.hSet(statsKey, {
        lastUpdate: Date.now().toString(),
        calls: (metrics.calls || 0).toString(),
        errors: (metrics.errors || 0).toString(),
        p95Latency: (metrics.p95Latency || 0).toString(),
        avgLatency: (metrics.avgLatency || 0).toString(),
        errorRate: (metrics.errorRate || 0).toString()
      });

      // Set expiry (24 hours)
      await this.client.expire(statsKey, 86400);

      // Update sorted sets for top metrics
      if (metrics.p95Latency) {
        await this.client.zAdd(HOT_KEYS.TOP_LATENCY, {
          score: metrics.p95Latency,
          value: toolKey
        });
      }

      if (metrics.errorRate) {
        await this.client.zAdd(HOT_KEYS.TOP_ERROR_RATE, {
          score: metrics.errorRate,
          value: toolKey
        });
      }

      // Trim sorted sets to top 100
      await this.client.zRemRangeByRank(HOT_KEYS.TOP_LATENCY, 0, -101);
      await this.client.zRemRangeByRank(HOT_KEYS.TOP_ERROR_RATE, 0, -101);

    } catch (error) {
      logger.warn('HOT_METRICS_ERROR', 'Failed to update hot metrics', {
        toolKey,
        error: error.message
      });
    }
  }

  /**
   * Get hot metrics for a tool
   */
  async getHotMetrics(server, tool) {
    if (!this.isConnected) return null;

    const toolKey = `${server}__${tool}`;
    const statsKey = `${HOT_KEYS.TOOL_STATS}:${toolKey}`;

    try {
      const metrics = await this.client.hGetAll(statsKey);
      
      if (!metrics || Object.keys(metrics).length === 0) {
        return null;
      }

      return {
        lastUpdate: parseInt(metrics.lastUpdate),
        calls: parseInt(metrics.calls),
        errors: parseInt(metrics.errors),
        p95Latency: parseFloat(metrics.p95Latency),
        avgLatency: parseFloat(metrics.avgLatency),
        errorRate: parseFloat(metrics.errorRate)
      };
    } catch (error) {
      logger.warn('GET_HOT_METRICS_ERROR', 'Failed to get hot metrics', {
        toolKey,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Get top tools by metric
   */
  async getTopTools(metric = 'latency', limit = 10) {
    if (!this.isConnected) return [];

    const key = metric === 'latency' ? HOT_KEYS.TOP_LATENCY : HOT_KEYS.TOP_ERROR_RATE;

    try {
      const results = await this.client.zRangeWithScores(key, -limit, -1, {
        REV: true
      });

      return results.map(item => ({
        tool: item.value,
        score: item.score
      }));
    } catch (error) {
      logger.warn('GET_TOP_TOOLS_ERROR', 'Failed to get top tools', {
        metric,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Cache recent anomaly
   */
  async cacheAnomaly(anomaly) {
    if (!this.isConnected) return;

    try {
      // Add to list
      await this.client.lPush(
        HOT_KEYS.RECENT_ANOMALIES,
        JSON.stringify(anomaly)
      );

      // Trim to last 100
      await this.client.lTrim(HOT_KEYS.RECENT_ANOMALIES, 0, 99);
      
      // Set expiry (7 days)
      await this.client.expire(HOT_KEYS.RECENT_ANOMALIES, 604800);
    } catch (error) {
      logger.warn('CACHE_ANOMALY_ERROR', 'Failed to cache anomaly', {
        error: error.message
      });
    }
  }

  /**
   * Get recent anomalies
   */
  async getRecentAnomalies(limit = 10) {
    if (!this.isConnected) return [];

    try {
      const anomalies = await this.client.lRange(
        HOT_KEYS.RECENT_ANOMALIES,
        0,
        limit - 1
      );

      return anomalies.map(a => JSON.parse(a));
    } catch (error) {
      logger.warn('GET_ANOMALIES_ERROR', 'Failed to get recent anomalies', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Flatten object for Redis storage
   */
  flattenForRedis(obj, prefix = '') {
    const flattened = {};
    
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      
      if (value === null || value === undefined) {
        flattened[fullKey] = '';
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(flattened, this.flattenForRedis(value, fullKey));
      } else if (Array.isArray(value)) {
        flattened[fullKey] = JSON.stringify(value);
      } else {
        flattened[fullKey] = String(value);
      }
    }
    
    return flattened;
  }

  /**
   * Parse Redis message back to object
   */
  parseRedisMessage(message) {
    const parsed = {};
    
    for (const [key, value] of Object.entries(message)) {
      const keys = key.split('.');
      let current = parsed;
      
      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]]) {
          current[keys[i]] = {};
        }
        current = current[keys[i]];
      }
      
      const lastKey = keys[keys.length - 1];
      
      // Try to parse JSON arrays
      if (value.startsWith('[') && value.endsWith(']')) {
        try {
          current[lastKey] = JSON.parse(value);
        } catch {
          current[lastKey] = value;
        }
      } else if (value === '') {
        current[lastKey] = null;
      } else if (value === 'true') {
        current[lastKey] = true;
      } else if (value === 'false') {
        current[lastKey] = false;
      } else if (!isNaN(value) && value !== '') {
        current[lastKey] = Number(value);
      } else {
        current[lastKey] = value;
      }
    }
    
    return parsed;
  }

  /**
   * Get stream statistics
   */
  async getStreamStats() {
    const stats = {};
    
    for (const [name, streamKey] of Object.entries(STREAMS)) {
      try {
        const info = await this.client.xInfoStream(streamKey);
        stats[name] = {
          length: info.length,
          firstEntry: info.firstEntry?.id,
          lastEntry: info.lastEntry?.id,
          groups: info.groups
        };
      } catch (error) {
        stats[name] = { error: error.message };
      }
    }
    
    return stats;
  }

  /**
   * Stop all consumers
   */
  stopAllConsumers() {
    for (const [consumerId, state] of this.consumers.entries()) {
      state.running = false;
      logger.info('CONSUMER_STOPPING', `Stopping consumer: ${consumerId}`);
    }
  }

  /**
   * Close Redis connection
   */
  async close() {
    this.shutdownInProgress = true;
    this.stopAllConsumers();
    
    // Wait for consumers to stop
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
    }
    
    logger.info('REDIS_CLOSED', 'Redis stream manager closed');
  }
}

// Export singleton instance
export const streamManager = new StreamManager();

// Export for testing
export default StreamManager;

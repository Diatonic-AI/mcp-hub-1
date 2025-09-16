/**
 * Telemetry Ingestion Module for MCP Hub
 * Non-blocking event publishing to Redis streams
 * Entry point for all telemetry data capture
 */

import { v7 as uuidv7 } from 'uuid';
import logger from '../utils/logger.js';
import { telemetryEnvelope } from './envelope.js';
import { streamManager, STREAMS } from './streams.js';

// Default configuration
const DEFAULT_CONFIG = {
  enabled: process.env.TELEMETRY_ENABLED !== 'false',
  dropOnFailure: process.env.TELEMETRY_DROP_ON_FAILURE !== 'false',
  sessionTimeout: parseInt(process.env.TELEMETRY_SESSION_TIMEOUT || '3600000'), // 1 hour
  batchFlushInterval: parseInt(process.env.TELEMETRY_BATCH_FLUSH || '100')
};

/**
 * Session manager for tracking user sessions
 */
class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.sessionTimeout = DEFAULT_CONFIG.sessionTimeout;
  }

  /**
   * Get or create session ID
   */
  getSessionId(context = {}) {
    const key = context.userId || context.ip || 'anonymous';
    
    let session = this.sessions.get(key);
    
    if (!session || Date.now() - session.lastActivity > this.sessionTimeout) {
      session = {
        id: uuidv7(),
        startTime: Date.now(),
        lastActivity: Date.now(),
        calls: 0
      };
      this.sessions.set(key, session);
    } else {
      session.lastActivity = Date.now();
      session.calls++;
    }
    
    return session.id;
  }

  /**
   * Clean up expired sessions
   */
  cleanup() {
    const now = Date.now();
    for (const [key, session] of this.sessions.entries()) {
      if (now - session.lastActivity > this.sessionTimeout) {
        this.sessions.delete(key);
      }
    }
  }
}

/**
 * Telemetry Ingestor
 * Main class for capturing and publishing telemetry events
 */
export class TelemetryIngestor {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionManager = new SessionManager();
    this.isInitialized = false;
    this.eventQueue = [];
    this.flushTimer = null;
    
    // Start session cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.sessionManager.cleanup();
    }, 60000); // Every minute
  }

  /**
   * Initialize the ingestor
   */
  async initialize() {
    if (!this.config.enabled) {
      logger.info('TELEMETRY_DISABLED', 'Telemetry is disabled');
      return false;
    }

    try {
      // Initialize stream manager
      await streamManager.initialize();
      
      this.isInitialized = true;
      
      // Start batch flush timer
      this.startBatchFlush();
      
      logger.info('TELEMETRY_INGESTOR_READY', 'Telemetry ingestor initialized');
      
      return true;
    } catch (error) {
      logger.error('TELEMETRY_INIT_ERROR', 'Failed to initialize telemetry', {
        error: error.message
      });
      
      if (!this.config.dropOnFailure) {
        throw error;
      }
      
      return false;
    }
  }

  /**
   * Capture tool call start event
   */
  captureToolStart(context) {
    if (!this.config.enabled) return null;

    const eventId = uuidv7();
    const sessionId = this.sessionManager.getSessionId(context);
    
    const event = {
      id: eventId,
      type: 'mcp.call.start',
      event: 'start',
      session_id: sessionId,
      tenant: context.tenant || 'default',
      server: context.server,
      tool: context.tool,
      chain_id: context.chainId,
      parent_id: context.parentId,
      user_agent: context.userAgent,
      args: context.args,
      timestamp_ms: Date.now()
    };

    // Publish sparse envelope for real-time tracking
    this.publishEvent(event, { sparse: true });
    
    return eventId;
  }

  /**
   * Capture tool call completion event
   */
  captureToolComplete(eventId, context) {
    if (!this.config.enabled) return;

    const sessionId = this.sessionManager.getSessionId(context);
    
    const event = {
      id: eventId || uuidv7(),
      type: 'mcp.call.complete',
      event: 'complete',
      session_id: sessionId,
      tenant: context.tenant || 'default',
      server: context.server,
      tool: context.tool,
      chain_id: context.chainId,
      parent_id: context.parentId,
      user_agent: context.userAgent,
      status: context.error ? 'error' : 'success',
      latency_ms: context.latency,
      args: context.args,
      output: context.output,
      error: context.error,
      timestamp_ms: Date.now()
    };

    // Publish complete envelope
    this.publishEvent(event);
  }

  /**
   * Capture connection lifecycle event
   */
  captureConnectionEvent(context) {
    if (!this.config.enabled) return;

    const event = {
      id: uuidv7(),
      type: 'mcp.connection',
      tenant: context.tenant || 'default',
      server: context.server,
      connection_state: context.state, // CONNECTING, CONNECTED, DISCONNECTED, ERROR
      reason: context.reason,
      metadata: context.metadata,
      timestamp_ms: Date.now()
    };

    this.publishEvent(event);
  }

  /**
   * Capture server lifecycle event
   */
  captureServerEvent(context) {
    if (!this.config.enabled) return;

    const event = {
      id: uuidv7(),
      type: 'mcp.server',
      tenant: context.tenant || 'default',
      event_type: context.eventType, // servers_updating, servers_updated
      servers: context.servers,
      changes: context.changes,
      metadata: context.metadata,
      timestamp_ms: Date.now()
    };

    this.publishEvent(event);
  }

  /**
   * Capture custom telemetry event
   */
  captureEvent(type, data) {
    if (!this.config.enabled) return;

    const event = {
      id: uuidv7(),
      type,
      ...data,
      timestamp_ms: Date.now()
    };

    this.publishEvent(event);
  }

  /**
   * Publish event to Redis stream (non-blocking)
   */
  async publishEvent(event, options = {}) {
    if (!this.isInitialized && this.config.dropOnFailure) {
      logger.debug('TELEMETRY_DROPPED', 'Telemetry not initialized, dropping event', {
        type: event.type
      });
      return;
    }

    try {
      // Create envelope (sparse or full)
      const envelope = options.sparse 
        ? telemetryEnvelope.createSparse(event)
        : telemetryEnvelope.create(event);

      // Add to queue for batching
      this.eventQueue.push(envelope);

      // Flush if queue is getting large
      if (this.eventQueue.length >= 100) {
        await this.flushEvents();
      }
    } catch (error) {
      // Non-blocking - log and continue
      logger.warn('TELEMETRY_PUBLISH_ERROR', 'Failed to publish telemetry event', {
        type: event.type,
        error: error.message
      });
    }
  }

  /**
   * Start batch flush timer
   */
  startBatchFlush() {
    this.flushTimer = setInterval(async () => {
      if (this.eventQueue.length > 0) {
        await this.flushEvents();
      }
    }, this.config.batchFlushInterval);
  }

  /**
   * Flush queued events to Redis
   */
  async flushEvents() {
    if (this.eventQueue.length === 0) return;

    const events = this.eventQueue.splice(0, this.eventQueue.length);
    
    // Publish all events to Redis stream
    const promises = events.map(event => 
      streamManager.publish(STREAMS.RAW, event)
    );

    try {
      await Promise.all(promises);
      
      logger.debug('TELEMETRY_FLUSH', `Flushed ${events.length} events to stream`);
    } catch (error) {
      logger.warn('TELEMETRY_FLUSH_ERROR', 'Some events failed to flush', {
        error: error.message,
        count: events.length
      });
    }
  }

  /**
   * Create instrumentation wrapper for tool execution
   */
  wrapToolExecution(handler, context) {
    return async (...args) => {
      const startTime = Date.now();
      const eventId = this.captureToolStart({
        ...context,
        args: args[0] // First argument is usually the input
      });

      try {
        const result = await handler(...args);
        
        this.captureToolComplete(eventId, {
          ...context,
          latency: Date.now() - startTime,
          args: args[0],
          output: result
        });

        return result;
      } catch (error) {
        this.captureToolComplete(eventId, {
          ...context,
          latency: Date.now() - startTime,
          args: args[0],
          error: {
            code: error.code,
            message: error.message,
            stack: error.stack
          }
        });

        throw error;
      }
    };
  }

  /**
   * Get telemetry statistics
   */
  getStats() {
    return {
      enabled: this.config.enabled,
      initialized: this.isInitialized,
      queueSize: this.eventQueue.length,
      activeSessions: this.sessionManager.sessions.size,
      streamStats: streamManager.getStreamStats()
    };
  }

  /**
   * Close the ingestor
   */
  async close() {
    // Clear intervals
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    // Flush remaining events
    await this.flushEvents();

    // Close stream manager
    await streamManager.close();

    this.isInitialized = false;
    
    logger.info('TELEMETRY_INGESTOR_CLOSED', 'Telemetry ingestor closed');
  }
}

// Export singleton instance
export const telemetryIngestor = new TelemetryIngestor();

// Helper function for non-blocking telemetry
export function captureToolCall(server, tool, handler) {
  if (!telemetryIngestor.config.enabled) {
    return handler;
  }

  return telemetryIngestor.wrapToolExecution(handler, { server, tool });
}

// Export for testing
export default TelemetryIngestor;

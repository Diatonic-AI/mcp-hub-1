import EventEmitter from 'events';
import logger from './logger.js';
import { v4 as uuidv4 } from 'uuid';

const HEART_BEAT_INTERVAL = 10000;

/**
 * Core event types supported by the SSE system
 */
export const EventTypes = {
  HEARTBEAT: 'heartbeat',
  HUB_STATE: 'hub_state',
  LOG: 'log',
  SUBSCRIPTION_EVENT: 'subscription_event'
};

/**
 * SSE connection states
 */
export const ConnectionState = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ERROR: 'error'
};

export const SubscriptionTypes = {
  CONFIG_CHANGED: 'config_changed',
  SERVERS_UPDATING: "servers_updating",
  SERVERS_UPDATED: 'servers_updated',
  TOOL_LIST_CHANGED: 'tool_list_changed',
  RESOURCE_LIST_CHANGED: 'resource_list_changed',
  PROMPT_LIST_CHANGED: 'prompt_list_changed',
  WORKSPACES_UPDATED: 'workspaces_updated'
}

/**
 * Hub states for UI synchronization
 */
export const HubState = {
  STARTING: 'starting',
  READY: 'ready',
  RESTARTING: 'restarting',
  RESTARTED: 'restarted',
  STOPPED: "stopped",
  STOPPING: 'stopping',
  ERROR: 'error',
};

/**
 * Manages Server-Sent Events (SSE) connections and event broadcasting
 */
export class SSEManager extends EventEmitter {
  /**
   * @param {Object} options Configuration options
   * @param {boolean} options.autoShutdown Whether to shutdown when no clients are connected
   * @param {number} options.shutdownDelay Delay in ms before shutdown
   * @param {number} options.heartbeatInterval Interval in ms for heartbeat events
   */
  constructor(options = {}) {
    super();
    this.connections = new Map();
    this.heartbeatInterval = options.heartbeatInterval || HEART_BEAT_INTERVAL
    this.autoShutdown = options.autoShutdown || false;
    this.shutdownDelay = options.shutdownDelay || 0;
    this.shutdownTimer = null;
    this.heartbeatTimer = null;
    this.workspaceCache = options.workspaceCache || null;
    this.port = options.port || null;

    this.setupHeartbeat();
    this.setupAutoShutdown();
  }

  /**
   * Sets up auto-shutdown behavior when no clients are connected
   * @private
   */
  setupAutoShutdown() {
    if (!this.autoShutdown) {
      logger.log('debug', "Auto shutdown is disabled - connections will not trigger shutdown", {}, null, { skipSSEBroadcast: true });
      return;
    }

    logger.log('debug', "Setting up auto shutting down", {
      autoShutdown: this.autoShutdown,
      shutdownDelay: this.shutdownDelay
    }, null, { skipSSEBroadcast: true });
    
    this.on('connectionClosed', async () => {
      // Update workspace cache with current connection count
      if (this.workspaceCache && this.port) {
        try {
          await this.workspaceCache.updateActiveConnections(this.port, this.connections.size);
        } catch (error) {
          logger.log('debug', `Error updating workspace cache: ${error.message}`, {}, null, { skipSSEBroadcast: true });
        }
      }

      // Double-check autoShutdown is still enabled and we have no connections
      if (this.autoShutdown && this.connections.size === 0) {
        // Clear any existing shutdown timer
        if (this.shutdownTimer) {
          clearTimeout(this.shutdownTimer);
          this.shutdownTimer = null;
        }

        // Mark workspace as shutting down in cache
        if (this.workspaceCache && this.port) {
          try {
            await this.workspaceCache.setShutdownTimer(this.port, this.shutdownDelay);
          } catch (error) {
            logger.log('debug', `Error setting shutdown timer in cache: ${error.message}`, {}, null, { skipSSEBroadcast: true });
          }
        }

        logger.log('debug', `Starting timer for auto shutdown (${this.shutdownDelay}ms)`, {
          connectionsRemaining: this.connections.size,
          shutdownDelay: this.shutdownDelay
        }, null, { skipSSEBroadcast: true });
        
        this.shutdownTimer = setTimeout(() => {
          // Final check before shutdown - ensure no connections were added
          if (this.connections.size === 0) {
            logger.log('info', 'No active SSE connections, initiating shutdown', {
              shutdownDelay: this.shutdownDelay,
              finalConnectionCount: this.connections.size
            }, null, { skipSSEBroadcast: true });
            process.emit('SIGTERM');
          } else {
            logger.log('debug', 'Auto-shutdown cancelled - connections detected', {
              connectionCount: this.connections.size
            }, null, { skipSSEBroadcast: true });
          }
        }, this.shutdownDelay);
      }
    });
  }

  /**
   * Sets up periodic heartbeat events
   * @private
   */
  setupHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      this.broadcast(EventTypes.HEARTBEAT, {
        connections: this.connections.size,
        timestamp: new Date().toISOString()
      });
    }, this.heartbeatInterval);

    // Ensure timer doesn't prevent Node from exiting
    this.heartbeatTimer.unref();
  }

  /**
   * Adds a new SSE connection
   * @param {Request} req Express request object
   * @param {Response} res Express response object
   * @returns {Object} Connection object
   */
  async addConnection(req, res) {
    const id = uuidv4();

    const connection = {
      id,
      res,
      state: ConnectionState.CONNECTED,
      connectedAt: new Date(),
      lastEventAt: new Date(),
      send: (event, data) => {
        if (res.writableEnded || res.destroyed) {
          connection.state = ConnectionState.DISCONNECTED;
          return false;
        }

        try {
          // Check if response is still writable before sending
          if (!res.writable) {
            connection.state = ConnectionState.DISCONNECTED;
            return false;
          }

          const eventData = JSON.stringify({
            ...data,
            timestamp: new Date().toISOString()
          });

          res.write(`event: ${event}\n`);
          res.write(`data: ${eventData}\n\n`);

          connection.lastEventAt = new Date();
          return true;
        } catch (error) {
          logger.log('debug', `SSE send failed for client ${id}: ${error.message}`, {
            clientId: id,
            event,
            errorCode: error.code
          }, null, { skipSSEBroadcast: true });
          connection.state = ConnectionState.ERROR;
          return false;
        }
      }
    };

    // Configure SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Set error handling before adding connection
    req.on('error', (error) => {
      connection.state = ConnectionState.DISCONNECTED;
      this.connections.delete(id);
      logger.log('debug', `SSE_CONNECTION_ERROR: ${error.message}`, {
        error: error.message,
        stack: error.stack,
        clientId: id
      }, null, { skipSSEBroadcast: true });
      
      // Don't emit connectionClosed here - req.on('close') will handle it
      // This prevents double-triggering of shutdown logic
    });

    // Handle client disconnect
    req.on('close', () => {
      // Only handle disconnect if connection still exists (prevent double cleanup)
      if (this.connections.has(id)) {
        connection.state = ConnectionState.DISCONNECTED;
        this.connections.delete(id);
        
        logger.log('debug', 'SSE client disconnected', {
          clientId: id,
          remaining: this.connections.size
        }, null, { skipSSEBroadcast: true });
        
        // Only emit connectionClosed after connection is actually removed
        this.emit('connectionClosed', { id, remaining: this.connections.size });
      }
    });

    // Cancel any pending shutdown
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;

      // Cancel shutdown in workspace cache
      if (this.workspaceCache && this.port) {
        await this.workspaceCache.cancelShutdownTimer(this.port);
      }
    }

    this.connections.set(id, connection);

    // Update workspace cache with new connection count
    if (this.workspaceCache && this.port) {
      await this.workspaceCache.updateActiveConnections(this.port, this.connections.size);
    }

    logger.log('debug', 'SSE client connected', {
      clientId: id,
      totalConnections: this.connections.size
    }, null, { skipSSEBroadcast: true });

    return connection;
  }

  /**
   * Broadcasts an event to all connected clients
   * @param {string} event Event type
   * @param {Object} data Event data
   * @returns {number} Number of clients the event was sent to
   */
  broadcast(event, data) {
    let sentCount = 0;
    const deadConnections = [];

    for (const [id, connection] of this.connections) {
      if (connection.state === ConnectionState.CONNECTED) {
        if (connection.send(event, data)) {
          sentCount++;
        } else {
          // Mark connection for cleanup if send failed
          deadConnections.push(id);
        }
      } else {
        // Mark dead connection for cleanup
        deadConnections.push(id);
      }
    }

    // Clean up dead connections in separate loop to avoid iterator issues
    for (const id of deadConnections) {
      this.connections.delete(id);
      logger.log('debug', `Cleaned up dead SSE connection: ${id}`, {}, null, { skipSSEBroadcast: true });
    }

    return sentCount;
  }

  /**
   * Sends an event to a specific client
   * @param {string} clientId Client identifier
   * @param {string} event Event type
   * @param {Object} data Event data
   * @returns {boolean} Whether the event was sent successfully
   */
  sendToClient(clientId, event, data) {
    const connection = this.connections.get(clientId);
    if (!connection || connection.state !== ConnectionState.CONNECTED) {
      return false;
    }
    return connection.send(event, data);
  }

  /**
   * Gets stats about current connections
   * @returns {Object} Connection statistics
   */
  getStats() {
    return {
      totalConnections: this.connections.size,
      connections: Array.from(this.connections.values()).map(conn => ({
        id: conn.id,
        state: conn.state,
        connectedAt: conn.connectedAt,
        lastEventAt: conn.lastEventAt
      }))
    };
  }

  /**
   * Performs clean shutdown of all SSE connections
   */
  async shutdown() {
    logger.log('info', `Shutting down SSE manager (${this.connections.size} connections)`, {}, null, { skipSSEBroadcast: true });

    // Clear timers
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }

    // Close all connections
    for (const connection of this.connections.values()) {
      if (!connection.res.writableEnded) {
        connection.res.end();
      }
    }

    this.connections.clear();
    this.removeAllListeners();

    logger.log('info', 'SSE manager shutdown complete', {}, null, { skipSSEBroadcast: true });
  }
}

/**
 * Telemetry Module Index for MCP Hub
 * Bootstrap, health checks, and exports for telemetry subsystem
 */

import logger from '../utils/logger.js';
import { telemetryIngestor } from './ingest.js';
import { telemetryPipeline } from './pipeline.js';
import { streamManager } from './streams.js';
import { qdrantClient } from './qdrant.js';
import { embeddingClient as lmStudioClient } from './embeddings.js';
import { telemetryEnvelope } from './envelope.js';

// Configuration
const CONFIG = {
  enabled: process.env.TELEMETRY_ENABLED !== 'false',
  autoStart: process.env.TELEMETRY_AUTO_START !== 'false',
  healthCheckInterval: parseInt(process.env.TELEMETRY_HEALTH_INTERVAL || '60000'),
  qdrantEnabled: process.env.DISABLE_QDRANT !== 'true'
};

/**
 * Telemetry Manager
 * Orchestrates the entire telemetry subsystem
 */
class TelemetryManager {
  constructor() {
    this.isInitialized = false;
    this.isRunning = false;
    this.healthTimer = null;
    this.components = {
      ingestor: telemetryIngestor,
      pipeline: telemetryPipeline,
      streams: streamManager,
      qdrant: qdrantClient,
      lmStudio: lmStudioClient
    };
  }

  /**
   * Initialize telemetry subsystem
   */
  async initialize(options = {}) {
    const config = { ...CONFIG, ...options };
    
    if (!config.enabled) {
      logger.info('TELEMETRY_DISABLED', 'Telemetry is disabled by configuration');
      return false;
    }

    if (this.isInitialized) {
      logger.warn('TELEMETRY_ALREADY_INITIALIZED', 'Telemetry already initialized');
      return true;
    }

    try {
      logger.info('TELEMETRY_INIT_START', 'Initializing telemetry subsystem...');
      
      // Initialize components in order
      await this.components.ingestor.initialize();
      await this.components.pipeline.initialize();
      
      // Start health monitoring
      this.startHealthMonitoring();
      
      this.isInitialized = true;
      
      logger.info('TELEMETRY_INIT_SUCCESS', 'Telemetry subsystem initialized successfully');
      
      // Auto-start if configured
      if (config.autoStart) {
        await this.start();
      }
      
      return true;
    } catch (error) {
      logger.error('TELEMETRY_INIT_FAILED', 'Failed to initialize telemetry', {
        error: error.message,
        stack: error.stack
      });
      
      // Clean up partial initialization
      await this.cleanup();
      
      throw error;
    }
  }

  /**
   * Start telemetry processing
   */
  async start() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isRunning) {
      logger.warn('TELEMETRY_ALREADY_RUNNING', 'Telemetry is already running');
      return;
    }

    try {
      logger.info('TELEMETRY_START', 'Starting telemetry processing...');
      
      // Start pipeline processing
      await this.components.pipeline.start();
      
      this.isRunning = true;
      
      logger.info('TELEMETRY_STARTED', 'Telemetry processing started');
      
      // Emit startup telemetry
      this.components.ingestor.captureEvent('telemetry.startup', {
        version: '1.0.0',
        components: Object.keys(this.components),
        config: {
          enabled: CONFIG.enabled,
          autoStart: CONFIG.autoStart
        }
      });
    } catch (error) {
      logger.error('TELEMETRY_START_FAILED', 'Failed to start telemetry', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Stop telemetry processing
   */
  async stop() {
    if (!this.isRunning) {
      logger.warn('TELEMETRY_NOT_RUNNING', 'Telemetry is not running');
      return;
    }

    try {
      logger.info('TELEMETRY_STOP', 'Stopping telemetry processing...');
      
      // Emit shutdown telemetry
      this.components.ingestor.captureEvent('telemetry.shutdown', {
        uptime: process.uptime(),
        stats: await this.getStats()
      });
      
      // Stop pipeline processing
      await this.components.pipeline.stop();
      
      this.isRunning = false;
      
      logger.info('TELEMETRY_STOPPED', 'Telemetry processing stopped');
    } catch (error) {
      logger.error('TELEMETRY_STOP_FAILED', 'Failed to stop telemetry cleanly', {
        error: error.message
      });
    }
  }

  /**
   * Start health monitoring
   */
  startHealthMonitoring() {
    this.healthTimer = setInterval(async () => {
      try {
        const health = await this.checkHealth();
        
        if (!health.healthy) {
          logger.warn('TELEMETRY_UNHEALTHY', 'Telemetry health check failed', health);
        }
      } catch (error) {
        logger.error('TELEMETRY_HEALTH_ERROR', 'Health check error', {
          error: error.message
        });
      }
    }, CONFIG.healthCheckInterval);
  }

  /**
   * Check telemetry health
   */
  async checkHealth() {
    const health = {
      healthy: true,
      timestamp: new Date().toISOString(),
      components: {},
      errors: []
    };

    // Check ingestor
    try {
      const ingestorStats = this.components.ingestor.getStats();
      health.components.ingestor = {
        status: ingestorStats.initialized ? 'healthy' : 'degraded',
        queueSize: ingestorStats.queueSize,
        activeSessions: ingestorStats.activeSessions
      };
    } catch (error) {
      health.healthy = false;
      health.components.ingestor = { status: 'error', error: error.message };
      health.errors.push(`Ingestor: ${error.message}`);
    }

    // Check pipeline
    try {
      const pipelineStats = this.components.pipeline.getStats();
      health.components.pipeline = {
        status: pipelineStats.isRunning ? 'healthy' : 'stopped',
        eventsProcessed: pipelineStats.eventsProcessed,
        errors: pipelineStats.errors
      };
    } catch (error) {
      health.healthy = false;
      health.components.pipeline = { status: 'error', error: error.message };
      health.errors.push(`Pipeline: ${error.message}`);
    }

    // Check Redis
    try {
      const streamStats = this.components.streams.getStreamStats();
      health.components.redis = {
        status: this.components.streams.isConnected() ? 'healthy' : 'disconnected',
        streamSizes: streamStats
      };
    } catch (error) {
      health.healthy = false;
      health.components.redis = { status: 'error', error: error.message };
      health.errors.push(`Redis: ${error.message}`);
    }

    // Check Qdrant (if enabled)
    if (CONFIG.qdrantEnabled) {
      try {
        const qdrantInfo = await this.components.qdrant.getCollectionInfo();
        health.components.qdrant = {
          status: qdrantInfo ? 'healthy' : 'error',
          pointsCount: qdrantInfo?.points_count || 0,
          vectorsCount: qdrantInfo?.vectors_count || 0
        };
      } catch (error) {
        health.components.qdrant = { status: 'error', error: error.message };
        health.errors.push(`Qdrant: ${error.message}`);
      }
    } else {
      health.components.qdrant = { status: 'disabled' };
    }

    // Check LM Studio
    try {
      const lmStudioStats = this.components.lmStudio.getStats();
      health.components.lmStudio = {
        status: lmStudioStats.isConnected ? 'healthy' : 'disconnected',
        totalEmbeddings: lmStudioStats.totalEmbeddings,
        circuitBreakerState: lmStudioStats.circuitBreakerState
      };
    } catch (error) {
      health.components.lmStudio = { status: 'error', error: error.message };
      health.errors.push(`LM Studio: ${error.message}`);
    }

    // Overall health determination
    const criticalComponents = ['ingestor', 'pipeline', 'redis'];
    for (const component of criticalComponents) {
      if (health.components[component]?.status === 'error') {
        health.healthy = false;
        break;
      }
    }

    return health;
  }

  /**
   * Get comprehensive telemetry statistics
   */
  async getStats() {
    const stats = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      initialized: this.isInitialized,
      running: this.isRunning,
      components: {}
    };

    // Gather stats from all components
    try {
      stats.components.ingestor = this.components.ingestor.getStats();
      stats.components.pipeline = this.components.pipeline.getStats();
      stats.components.streams = this.components.streams.getStreamStats();
      
      // Get collection info as stats (if enabled)
      if (CONFIG.qdrantEnabled) {
        const qdrantInfo = await this.components.qdrant.getCollectionInfo();
        stats.components.qdrant = {
          pointsCount: qdrantInfo?.points_count || 0,
          vectorsCount: qdrantInfo?.vectors_count || 0
        };
      } else {
        stats.components.qdrant = { status: 'disabled' };
      }
      
      stats.components.lmStudio = this.components.lmStudio.getStats();
    } catch (error) {
      logger.warn('TELEMETRY_STATS_ERROR', 'Error gathering component stats', {
        error: error.message
      });
    }

    return stats;
  }

  /**
   * Clean up telemetry resources
   */
  async cleanup() {
    logger.info('TELEMETRY_CLEANUP', 'Cleaning up telemetry resources...');
    
    // Stop health monitoring
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    // Stop processing
    if (this.isRunning) {
      await this.stop();
    }

    // Close all connections
    try {
      await this.components.ingestor.close();
      await this.components.pipeline.close();
      // Other components closed by pipeline
    } catch (error) {
      logger.error('TELEMETRY_CLEANUP_ERROR', 'Error during cleanup', {
        error: error.message
      });
    }

    this.isInitialized = false;
    
    logger.info('TELEMETRY_CLEANUP_COMPLETE', 'Telemetry cleanup complete');
  }

  /**
   * Graceful shutdown handler
   */
  async shutdown() {
    logger.info('TELEMETRY_SHUTDOWN', 'Initiating graceful telemetry shutdown...');
    
    // Capture shutdown event
    this.components.ingestor.captureEvent('telemetry.shutdown', {
      reason: 'graceful',
      stats: await this.getStats()
    });

    // Wait for final flush
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Clean up
    await this.cleanup();
    
    logger.info('TELEMETRY_SHUTDOWN_COMPLETE', 'Telemetry shutdown complete');
  }
}

// Create singleton instance
const telemetryManager = new TelemetryManager();

// Register shutdown handlers
process.on('SIGTERM', async () => {
  await telemetryManager.shutdown();
});

process.on('SIGINT', async () => {
  await telemetryManager.shutdown();
});

// Export components and manager
export {
  telemetryManager,
  telemetryIngestor,
  telemetryPipeline,
  telemetryEnvelope,
  streamManager,
  qdrantClient,
  lmStudioClient
};

// Default export
export default telemetryManager;

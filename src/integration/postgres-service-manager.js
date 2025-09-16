/**
 * Enhanced Service Manager with PostgreSQL Integration
 * 
 * This module extends the existing ServiceManager to include PostgreSQL
 * database integration during MCP Hub initialization.
 */

import logger from '../utils/logger.js';
import { wrapError } from '../utils/errors.js';
import { initializePostgreSQLIntegration } from './postgres-hub-init.js';

/**
 * Enhanced ServiceManager that includes PostgreSQL integration
 */
export function enhanceServiceManagerWithPostgreSQL(ServiceManager) {
  /**
   * Enhanced initializeMCPHub method with PostgreSQL integration
   */
  const originalInitializeMCPHub = ServiceManager.prototype.initializeMCPHub;
  
  ServiceManager.prototype.initializeMCPHub = async function(config = {}) {
    try {
      // Run the original initialization first
      await originalInitializeMCPHub.call(this);

      // Initialize PostgreSQL integration after MCP Hub is ready
      if (config.postgresql !== false && config.enablePostgreSQL !== false) {
        logger.info('Starting PostgreSQL Hub Integration');
        
        try {
          // Extract PostgreSQL configuration
          const postgresConfig = {
            database: config.database || config.postgresql || {
              host: process.env.POSTGRES_HOST || 'localhost',
              port: parseInt(process.env.POSTGRES_PORT) || 5432,
              database: process.env.POSTGRES_DB || 'mcphub',
              user: process.env.POSTGRES_USER || 'mcphub',
              password: process.env.POSTGRES_PASSWORD,
              ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false
            },
            enableDatabaseTracking: config.enableDatabaseTracking !== false,
            enableApiLogging: config.enableApiLogging !== false,
            enableRealTimeSync: config.enableRealTimeSync !== false,
            enableEnhancedMetaTools: config.enableEnhancedMetaTools !== false,
            fallbackOnError: config.postgresqlFallbackOnError !== false,
            ...config.postgresqlIntegration
          };

          // Initialize PostgreSQL integration
          this.postgresIntegration = await initializePostgreSQLIntegration(
            this.mcpHub, 
            postgresConfig
          );

          logger.info('PostgreSQL Hub Integration initialized successfully', {
            adapters: Object.keys(this.postgresIntegration.getIntegrationStats().adapters)
              .filter(k => this.postgresIntegration.getIntegrationStats().adapters[k].available),
            tracking: postgresConfig.enableDatabaseTracking,
            apiLogging: postgresConfig.enableApiLogging
          });

        } catch (error) {
          logger.error('PostgreSQL Hub Integration failed during initialization', {
            error: error.message,
            fallback: config.postgresqlFallbackOnError !== false
          });

          if (config.postgresqlFallbackOnError !== false) {
            logger.warn('Continuing without PostgreSQL features due to integration failure');
            // Fallback integration is created automatically in initializePostgreSQLIntegration
          } else {
            throw wrapError(error, 'POSTGRESQL_INTEGRATION_REQUIRED');
          }
        }
      } else {
        logger.info('PostgreSQL integration disabled in configuration');
      }

    } catch (error) {
      logger.error('Enhanced MCP Hub initialization failed', { error: error.message });
      throw error;
    }
  };

  /**
   * Enhanced shutdown method with PostgreSQL cleanup
   */
  const originalShutdown = ServiceManager.prototype.shutdown;
  
  ServiceManager.prototype.shutdown = async function() {
    logger.info('Starting enhanced shutdown process with PostgreSQL cleanup');

    // Close PostgreSQL integration first
    if (this.postgresIntegration) {
      try {
        logger.info('Closing PostgreSQL integration');
        await this.postgresIntegration.close();
        this.postgresIntegration = null;
      } catch (error) {
        logger.error('Error closing PostgreSQL integration', { error: error.message });
      }
    }

    // Then run original shutdown
    await originalShutdown.call(this);
  };

  /**
   * Enhanced getState method to include PostgreSQL status
   */
  const originalGetState = ServiceManager.prototype.getState;
  
  ServiceManager.prototype.getState = function(extraData = {}) {
    const baseState = originalGetState.call(this, extraData);

    // Add PostgreSQL integration status
    if (this.postgresIntegration) {
      const pgStats = this.postgresIntegration.getIntegrationStats();
      baseState.postgresql = {
        available: !pgStats.fallbackMode,
        initialized: pgStats.initialized,
        adapters: {
          available: Object.values(pgStats.adapters).filter(a => a.available).length,
          connected: Object.values(pgStats.adapters).filter(a => a.connected).length,
          total: Object.keys(pgStats.adapters).length
        },
        statistics: {
          serversTracked: pgStats.statistics.serversTracked,
          toolsTracked: pgStats.statistics.toolsTracked,
          executionsTracked: pgStats.statistics.executionsTracked
        },
        fallbackMode: pgStats.fallbackMode || false
      };
    } else {
      baseState.postgresql = {
        available: false,
        initialized: false,
        reason: 'Integration not initialized'
      };
    }

    return baseState;
  };

  return ServiceManager;
}

/**
 * Factory function to create an enhanced ServiceManager with PostgreSQL integration
 */
export function createEnhancedServiceManager(options = {}) {
  // Import the original ServiceManager (we'll need to import it dynamically to avoid circular deps)
  return import('../server.js').then(({ ServiceManager }) => {
    const EnhancedServiceManager = enhanceServiceManagerWithPostgreSQL(ServiceManager);
    return new EnhancedServiceManager(options);
  });
}

/**
 * Helper to add PostgreSQL endpoints to existing router
 */
export function addPostgreSQLEndpoints(router, registerRoute) {
  // PostgreSQL health check endpoint
  registerRoute(
    'GET',
    '/postgresql/health',
    'Check PostgreSQL integration health',
    async (req, res) => {
      try {
        const integration = req.app.locals.serviceManager?.postgresIntegration;
        
        if (!integration) {
          return res.json({
            status: 'unavailable',
            reason: 'PostgreSQL integration not initialized',
            healthy: false,
            timestamp: new Date().toISOString()
          });
        }

        // Import the health check function
        const { checkPostgreSQLHealth } = await import('./postgres-hub-init.js');
        const health = await checkPostgreSQLHealth(integration);

        res.json({
          ...health,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        logger.error('PostgreSQL health check failed', { error: error.message });
        res.status(500).json({
          status: 'error',
          error: error.message,
          healthy: false,
          timestamp: new Date().toISOString()
        });
      }
    }
  );

  // PostgreSQL metrics endpoint
  registerRoute(
    'GET',
    '/postgresql/metrics',
    'Get PostgreSQL integration metrics',
    async (req, res) => {
      try {
        const integration = req.app.locals.serviceManager?.postgresIntegration;
        
        // Import the metrics function
        const { getPostgreSQLMetrics } = await import('./postgres-hub-init.js');
        const metrics = getPostgreSQLMetrics(integration);

        res.json({
          ...metrics,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        logger.error('PostgreSQL metrics collection failed', { error: error.message });
        res.status(500).json({
          available: false,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }
  );

  // PostgreSQL analytics endpoint (enhanced hub__analytics_advanced via REST)
  registerRoute(
    'GET',
    '/postgresql/analytics',
    'Get advanced analytics from PostgreSQL integration',
    async (req, res) => {
      try {
        const integration = req.app.locals.serviceManager?.postgresIntegration;
        
        if (!integration || integration.fallbackMode) {
          return res.json({
            error: 'PostgreSQL integration not available',
            fallbackMode: true,
            analytics: {}
          });
        }

        const { timeRange = '24 hours' } = req.query;

        // Use the enhanced analytics meta-tool if available
        if (integration.hubInstance?.toolsetRegistry?.tools?.hub__analytics_advanced) {
          const result = await integration.hubInstance.toolsetRegistry.tools.hub__analytics_advanced({
            timeRange,
            includeRealTime: true,
            format: 'detailed'
          });

          res.json({
            analytics: result,
            timeRange,
            timestamp: new Date().toISOString()
          });
        } else {
          // Fallback to basic integration stats
          const stats = integration.getIntegrationStats();
          res.json({
            analytics: {
              content: [{
                type: 'text',
                text: `Basic PostgreSQL Integration Stats:\n- Initialized: ${stats.initialized}\n- Servers Tracked: ${stats.statistics.serversTracked}\n- Tools Tracked: ${stats.statistics.toolsTracked}`
              }]
            },
            timeRange,
            timestamp: new Date().toISOString()
          });
        }

      } catch (error) {
        logger.error('PostgreSQL analytics collection failed', { error: error.message });
        res.status(500).json({
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }
  );

  logger.info('PostgreSQL REST endpoints added to router');
}

export default {
  enhanceServiceManagerWithPostgreSQL,
  createEnhancedServiceManager,
  addPostgreSQLEndpoints
};

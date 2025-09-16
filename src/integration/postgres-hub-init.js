/**
 * PostgreSQL Hub Initialization
 * 
 * This module provides initialization functions to integrate PostgreSQL
 * database adapters with the existing MCP Hub during startup.
 * 
 * It creates a seamless integration that:
 * - Initializes database connections and schema
 * - Sets up database adapters
 * - Integrates with existing MCP Hub components
 * - Provides graceful fallback if database is unavailable
 */

import logger from '../utils/logger.js';
import { wrapError, ErrorCode } from '../utils/errors.js';
import PostgreSQLHubIntegration from './postgres-hub-integration.js';
import { createPostgreSQLSchemaManager } from '../database/postgres-schema.js';

/**
 * Initialize PostgreSQL Integration for MCP Hub
 * 
 * This is the main entry point called during MCP Hub startup
 */
export async function initializePostgreSQLIntegration(hubInstance, config = {}) {
  const startTime = Date.now();
  
  // Extract database configuration
  const dbConfig = config.database || config.postgresql || {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT) || 5432,
    database: process.env.POSTGRES_DB || 'mcphub',
    user: process.env.POSTGRES_USER || 'mcphub',
    password: process.env.POSTGRES_PASSWORD,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: parseInt(process.env.POSTGRES_MAX_CONNECTIONS) || 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  };

  // Integration options
  const integrationOptions = {
    enableDatabaseTracking: config.enableDatabaseTracking !== false,
    enableApiLogging: config.enableApiLogging !== false,
    enableRealTimeSync: config.enableRealTimeSync !== false,
    enableEnhancedMetaTools: config.enableEnhancedMetaTools !== false,
    fallbackOnError: config.fallbackOnError !== false,
    database: dbConfig,
    ...config.integration
  };

  logger.info('Starting PostgreSQL Hub Integration', {
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    options: {
      tracking: integrationOptions.enableDatabaseTracking,
      logging: integrationOptions.enableApiLogging,
      sync: integrationOptions.enableRealTimeSync,
      metaTools: integrationOptions.enableEnhancedMetaTools,
      fallback: integrationOptions.fallbackOnError
    }
  });

  try {
    // Step 1: Initialize database schema
    const schemaManager = await initializeDatabaseSchema(dbConfig, integrationOptions);
    
    // Step 2: Create and initialize integration
    const integration = new PostgreSQLHubIntegration(hubInstance, {
      ...integrationOptions,
      schemaManager
    });

    await integration.initialize();

    // Step 3: Set up graceful shutdown
    setupGracefulShutdown(integration);

    // Step 4: Log success metrics
    const duration = Date.now() - startTime;
    const stats = integration.getIntegrationStats();
    
    logger.info('PostgreSQL Hub Integration completed successfully', {
      duration: `${duration}ms`,
      initialized: stats.initialized,
      adapters: Object.keys(stats.adapters).filter(k => stats.adapters[k].available),
      statistics: stats.statistics
    });

    // Add integration instance to hub for external access
    hubInstance.postgresIntegration = integration;

    return integration;

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('PostgreSQL Hub Integration failed', {
      error: error.message,
      duration: `${duration}ms`,
      fallback: integrationOptions.fallbackOnError
    });

    if (integrationOptions.fallbackOnError) {
      logger.warn('PostgreSQL integration failed, continuing without database features');
      // Create minimal fallback integration
      return createFallbackIntegration(hubInstance);
    } else {
      throw wrapError(error, 'POSTGRESQL_INTEGRATION_FAILED');
    }
  }
}

/**
 * Initialize database schema and ensure tables exist
 */
async function initializeDatabaseSchema(dbConfig, options = {}) {
  logger.info('Initializing PostgreSQL database schema');

  try {
    const schemaManager = createPostgreSQLSchemaManager(dbConfig);
    await schemaManager.initialize();

    // Check if schema initialization is needed
    const schemaStatus = await schemaManager.checkSchemaStatus();
    
    if (!schemaStatus.initialized) {
      logger.info('Database schema not found, initializing...');
      
      // Initialize schema with full table structure
      await schemaManager.initializeSchema({
        createIndexes: true,
        createTriggers: true,
        createFunctions: true,
        seedData: options.seedData !== false
      });

      logger.info('Database schema initialized successfully', {
        tables: schemaStatus.tables?.length || 0,
        indexes: schemaStatus.indexes?.length || 0,
        triggers: schemaStatus.triggers?.length || 0
      });
    } else {
      logger.info('Database schema already exists, validating...', {
        version: schemaStatus.version,
        tables: schemaStatus.tables?.length || 0,
        lastMigration: schemaStatus.lastMigration
      });

      // Run any pending migrations
      await schemaManager.runMigrations();
    }

    return schemaManager;

  } catch (error) {
    logger.error('Database schema initialization failed', { error: error.message });
    throw wrapError(error, 'SCHEMA_INITIALIZATION_FAILED');
  }
}

/**
 * Set up graceful shutdown for database connections
 */
function setupGracefulShutdown(integration) {
  const gracefulShutdown = async (signal) => {
    logger.info(`Received ${signal}, gracefully shutting down PostgreSQL integration`);
    
    try {
      await integration.close();
      logger.info('PostgreSQL integration closed gracefully');
    } catch (error) {
      logger.error('Error during PostgreSQL integration shutdown', { error: error.message });
    }
  };

  // Handle various shutdown signals
  ['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(signal => {
    process.on(signal, () => gracefulShutdown(signal));
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    logger.error('Uncaught exception, shutting down PostgreSQL integration', { error: error.message });
    await gracefulShutdown('uncaughtException');
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason, promise) => {
    logger.error('Unhandled rejection, shutting down PostgreSQL integration', { 
      reason: reason?.message || reason,
      promise: promise?.toString?.() 
    });
    await gracefulShutdown('unhandledRejection');
    process.exit(1);
  });
}

/**
 * Create minimal fallback integration when database is unavailable
 */
function createFallbackIntegration(hubInstance) {
  logger.info('Creating fallback integration (no database features)');

  const fallback = {
    initialized: true,
    fallbackMode: true,
    
    getIntegrationStats() {
      return {
        initialized: true,
        fallbackMode: true,
        options: { fallback: true },
        statistics: {
          serversTracked: 0,
          toolsTracked: 0,
          executionsTracked: 0,
          apiRequestsTracked: 0,
          chainsExecuted: 0
        },
        adapters: {
          toolIndex: { available: false, connected: false },
          toolsetRegistry: { available: false, connected: false },
          apiRequest: { available: false, connected: false }
        }
      };
    },

    async close() {
      logger.info('Fallback integration closed (no-op)');
    }
  };

  // Add fallback meta-tools
  if (hubInstance.toolsetRegistry && hubInstance.toolsetRegistry.tools) {
    hubInstance.toolsetRegistry.tools.hub__database_status = async (params = {}) => {
      return {
        content: [{
          type: 'text',
          text: [
            '# 🛢️ Database Integration Status',
            `**Generated:** ${new Date().toISOString()}\n`,
            '## ⚠️ Fallback Mode',
            '- **Status:** Running in fallback mode (no database)',
            '- **Reason:** PostgreSQL integration failed during startup',
            '- **Features Available:** Basic MCP Hub functionality only',
            '- **Features Unavailable:** Database tracking, analytics, enhanced tools\n',
            '## 🔧 Troubleshooting',
            '1. Check PostgreSQL server availability',
            '2. Verify database credentials',
            '3. Review MCP Hub logs for connection errors',
            '4. Restart MCP Hub after fixing database issues'
          ].join('\n')
        }],
        isError: false
      };
    };

    hubInstance.toolsetRegistry.tools.hub__analytics_advanced = async (params = {}) => {
      return {
        content: [{
          type: 'text',
          text: '⚠️ Advanced analytics unavailable - PostgreSQL integration failed during startup'
        }],
        isError: true
      };
    };
  }

  // Add to hub instance
  hubInstance.postgresIntegration = fallback;

  return fallback;
}

/**
 * Health check function for PostgreSQL integration
 */
export async function checkPostgreSQLHealth(integration) {
  if (!integration || integration.fallbackMode) {
    return {
      status: 'unavailable',
      reason: 'Integration not available or in fallback mode',
      healthy: false
    };
  }

  try {
    const stats = integration.getIntegrationStats();
    
    const health = {
      status: stats.initialized ? 'healthy' : 'unhealthy',
      initialized: stats.initialized,
      adapters: {
        available: Object.values(stats.adapters).filter(a => a.available).length,
        connected: Object.values(stats.adapters).filter(a => a.connected).length,
        total: Object.keys(stats.adapters).length
      },
      statistics: stats.statistics,
      timestamp: new Date().toISOString(),
      healthy: stats.initialized && Object.values(stats.adapters).some(a => a.connected)
    };

    // Test database connectivity if available
    if (integration.toolIndexAdapter) {
      try {
        await integration.toolIndexAdapter.getIndexStats();
        health.databaseConnectivity = 'ok';
      } catch (error) {
        health.databaseConnectivity = 'error';
        health.databaseError = error.message;
        health.healthy = false;
      }
    }

    return health;

  } catch (error) {
    return {
      status: 'error',
      error: error.message,
      healthy: false,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Get PostgreSQL integration metrics for monitoring
 */
export function getPostgreSQLMetrics(integration) {
  if (!integration || integration.fallbackMode) {
    return {
      available: false,
      fallbackMode: true,
      metrics: {}
    };
  }

  try {
    const stats = integration.getIntegrationStats();
    
    return {
      available: true,
      fallbackMode: false,
      metrics: {
        // Integration metrics
        initialized: stats.initialized,
        adaptersAvailable: Object.values(stats.adapters).filter(a => a.available).length,
        adaptersConnected: Object.values(stats.adapters).filter(a => a.connected).length,
        
        // Usage statistics
        serversTracked: stats.statistics.serversTracked,
        toolsTracked: stats.statistics.toolsTracked,
        executionsTracked: stats.statistics.executionsTracked,
        apiRequestsTracked: stats.statistics.apiRequestsTracked,
        chainsExecuted: stats.statistics.chainsExecuted,
        
        // Configuration
        options: stats.options,
        
        // Timestamp
        lastChecked: new Date().toISOString()
      }
    };

  } catch (error) {
    return {
      available: false,
      error: error.message,
      metrics: {}
    };
  }
}

export default {
  initializePostgreSQLIntegration,
  checkPostgreSQLHealth,
  getPostgreSQLMetrics
};

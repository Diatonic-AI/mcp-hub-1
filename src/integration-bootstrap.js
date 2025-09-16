/**
 * MCP Hub PostgreSQL Integration Bootstrap
 * 
 * This module orchestrates the integration of the Enhanced PostgreSQL Manager
 * with the existing MCP Hub infrastructure. It handles initialization,
 * registration, and lifecycle management of all enhanced components.
 * 
 * INTEGRATION APPROACH:
 * - Minimal changes to existing codebase
 * - Backward compatible with existing APIs
 * - Optional PostgreSQL features (graceful degradation)
 * - Event-driven integration with existing systems
 * - Preserves existing naming and routing conventions
 */

import logger from './utils/logger.js';
import { wrapError } from './utils/errors.js';
import PostgreSQLIntegrationBridge from './utils/postgresql-integration.js';
import { enhancedMetaTools } from './mcp/enhanced-meta-tools.js';
import { resolvePostgresIntegrationEnv, logPostgresIntegrationResolution } from './utils/pg-env.js';

/**
 * Bootstrap Enhanced PostgreSQL Integration
 * 
 * This function is called during MCP Hub initialization to set up
 * the PostgreSQL integration bridge and enhanced meta-tools.
 */
export async function bootstrapPostgreSQLIntegration(hubInstance, sseManager = null) {
  try {
    logger.info('Starting PostgreSQL integration bootstrap');

    // Resolve PostgreSQL integration settings using central resolver
    const resolution = resolvePostgresIntegrationEnv(process.env);
    logPostgresIntegrationResolution(resolution);
    
    if (!resolution.enabled) {
      return null;
    }

    // Initialize PostgreSQL Integration Bridge
    const pgBridge = new PostgreSQLIntegrationBridge(hubInstance, sseManager, {
      enableRealTimeSync: process.env.ENABLE_REAL_TIME_SYNC !== 'false',
      enableAutoPersistence: process.env.ENABLE_AUTO_PERSISTENCE !== 'false',
      enableAnalytics: process.env.ENABLE_ENHANCED_ANALYTICS !== 'false'
    });

    // Initialize the bridge (this will set up database connections and sync existing data)
    await pgBridge.initialize();

    // Register the bridge globally for access by meta-tools
    global.mcpHub = global.mcpHub || {};
    global.mcpHub.postgresqlBridge = pgBridge;

    // Register enhanced meta-tools with the existing toolset registry
    await registerEnhancedMetaTools(hubInstance);

    // Set up integration event handlers
    setupIntegrationEventHandlers(hubInstance, pgBridge);

    logger.info('PostgreSQL integration bootstrap completed successfully');
    return pgBridge;

  } catch (error) {
    logger.error('PostgreSQL integration bootstrap failed', { error: error.message });
    
    // Graceful degradation - continue without PostgreSQL features
    logger.warn('Continuing without PostgreSQL integration features');
    return null;
  }
}

/**
 * Register Enhanced Meta-Tools
 * 
 * Integrates the new enhanced meta-tools with the existing toolset registry
 * while preserving backward compatibility.
 */
async function registerEnhancedMetaTools(hubInstance) {
  try {
    // Get the existing toolset registry
    const toolsetRegistry = hubInstance.toolsetRegistry;
    if (!toolsetRegistry) {
      logger.warn('Toolset registry not found - enhanced meta-tools will not be available');
      return;
    }

    // Register each enhanced meta-tool
    for (const [toolName, toolFunction] of Object.entries(enhancedMetaTools)) {
      // Check if the tool already exists (preserve existing behavior)
      if (toolsetRegistry.tools && toolsetRegistry.tools[toolName]) {
        logger.debug(`Enhanced meta-tool ${toolName} will override existing tool`);
      }

      // Register the tool
      if (typeof toolsetRegistry.registerTool === 'function') {
        toolsetRegistry.registerTool(toolName, toolFunction, {
          description: `Enhanced version of ${toolName} with PostgreSQL integration`,
          category: 'hub-enhanced',
          requiresPostgreSQL: true,
          version: '2.0.0'
        });
      } else if (toolsetRegistry.tools) {
        // Fallback: directly add to tools object
        toolsetRegistry.tools[toolName] = toolFunction;
      }

      logger.debug(`Enhanced meta-tool registered: ${toolName}`);
    }

    logger.info(`Registered ${Object.keys(enhancedMetaTools).length} enhanced meta-tools`);

  } catch (error) {
    logger.error('Failed to register enhanced meta-tools', { error: error.message });
    throw wrapError(error, 'ENHANCED_META_TOOLS_REGISTRATION_ERROR');
  }
}

/**
 * Set up Integration Event Handlers
 * 
 * Connects the PostgreSQL bridge with existing MCP Hub events
 * to ensure data synchronization and real-time updates.
 */
function setupIntegrationEventHandlers(hubInstance, pgBridge) {
  try {
    // Set up hub lifecycle event handlers
    if (hubInstance.on && typeof hubInstance.on === 'function') {
      
      // Handle server lifecycle events
      hubInstance.on('serverAdded', async (serverInfo) => {
        try {
          await pgBridge.handleServerConnection({
            ...serverInfo,
            eventType: 'server_added',
            timestamp: new Date()
          });
        } catch (error) {
          logger.warn('Failed to handle server added event', { error: error.message });
        }
      });

      hubInstance.on('serverRemoved', async (serverInfo) => {
        try {
          await pgBridge.handleServerDisconnection({
            ...serverInfo,
            eventType: 'server_removed',
            timestamp: new Date()
          });
        } catch (error) {
          logger.warn('Failed to handle server removed event', { error: error.message });
        }
      });

      // Handle tool execution events
      hubInstance.on('toolExecuted', async (executionInfo) => {
        try {
          await pgBridge.handleToolExecution({
            ...executionInfo,
            eventType: 'tool_executed',
            timestamp: new Date()
          });
        } catch (error) {
          logger.warn('Failed to handle tool execution event', { error: error.message });
        }
      });

    } else {
      logger.warn('Hub instance does not support event listening - real-time sync will be limited');
    }

    // Set up toolset registry event handlers
    const toolsetRegistry = hubInstance.toolsetRegistry;
    if (toolsetRegistry && toolsetRegistry.on && typeof toolsetRegistry.on === 'function') {
      
      toolsetRegistry.on('toolRegistered', async (toolInfo) => {
        try {
          // Update tool metadata when tools are registered
          await pgBridge.setEntityMetadata('tool', toolInfo.toolId, 'registry', {
            registeredAt: new Date().toISOString(),
            registryVersion: toolsetRegistry.version || '1.0.0',
            sourceType: 'toolset_registry'
          });
        } catch (error) {
          logger.warn('Failed to handle tool registration event', { error: error.message });
        }
      });

    }

    logger.info('Integration event handlers configured');

  } catch (error) {
    logger.error('Failed to set up integration event handlers', { error: error.message });
    // Non-fatal error - continue without event integration
  }
}

/**
 * Enhanced Tool Chain Execution Middleware
 * 
 * Provides middleware for the existing hub__chain_tools meta-tool
 * to add enhanced tracking and analytics when PostgreSQL is available.
 */
export function createEnhancedChainMiddleware(pgBridge) {
  return async function enhancedChainMiddleware(originalChainFunction) {
    return async function wrappedChainExecution(params) {
      // If PostgreSQL is not available, fall back to original implementation
      if (!pgBridge?.initialized) {
        return await originalChainFunction(params);
      }

      try {
        // Use enhanced chain execution with PostgreSQL tracking
        return await enhancedMetaTools.hub__chain_tools_enhanced(params);
      } catch (error) {
        logger.warn('Enhanced chain execution failed, falling back to original', {
          error: error.message
        });
        return await originalChainFunction(params);
      }
    };
  };
}

/**
 * Enhanced Analytics Middleware
 * 
 * Provides middleware for analytics requests to use PostgreSQL-backed
 * data when available, with graceful fallback to basic analytics.
 */
export function createEnhancedAnalyticsMiddleware(pgBridge) {
  return async function enhancedAnalyticsMiddleware(originalAnalyticsFunction) {
    return async function wrappedAnalytics(params) {
      // If PostgreSQL is not available, fall back to original implementation
      if (!pgBridge?.initialized) {
        return await originalAnalyticsFunction(params);
      }

      try {
        // Use enhanced analytics with PostgreSQL data
        return await enhancedMetaTools.hub__analytics_advanced(params);
      } catch (error) {
        logger.warn('Enhanced analytics failed, falling back to original', {
          error: error.message
        });
        return await originalAnalyticsFunction(params);
      }
    };
  };
}

/**
 * Integration Health Check
 * 
 * Provides a health check function to verify the status of the
 * PostgreSQL integration and all its components.
 */
export async function checkIntegrationHealth() {
  try {
    const pgBridge = global.mcpHub?.postgresqlBridge;
    
    if (!pgBridge) {
      return {
        status: 'disabled',
        message: 'PostgreSQL integration not initialized',
        features: {
          enhancedAnalytics: false,
          realTimeSync: false,
          autoPersistence: false,
          enhancedMetaTools: false
        }
      };
    }

    const integrationStatus = pgBridge.getIntegrationStatus();
    const healthStatus = {
      status: integrationStatus.initialized ? 'healthy' : 'unhealthy',
      message: integrationStatus.initialized 
        ? 'PostgreSQL integration is fully operational'
        : 'PostgreSQL integration is initialized but not fully operational',
      features: {
        enhancedAnalytics: integrationStatus.options.enableAnalytics,
        realTimeSync: integrationStatus.options.enableRealTimeSync,
        autoPersistence: integrationStatus.options.enableAutoPersistence,
        enhancedMetaTools: !!global.mcpHub?.postgresqlBridge
      },
      syncStats: integrationStatus.syncStats,
      lastSync: new Date().toISOString()
    };

    // Test database connectivity
    if (pgBridge.enhancedPgManager) {
      try {
        await pgBridge.enhancedPgManager.query('SELECT 1');
        healthStatus.database = 'connected';
      } catch (error) {
        healthStatus.database = 'disconnected';
        healthStatus.status = 'degraded';
        healthStatus.message = 'PostgreSQL database connectivity issues detected';
      }
    }

    return healthStatus;

  } catch (error) {
    logger.error('Integration health check failed', { error: error.message });
    return {
      status: 'error',
      message: `Health check failed: ${error.message}`,
      features: {
        enhancedAnalytics: false,
        realTimeSync: false,
        autoPersistence: false,
        enhancedMetaTools: false
      }
    };
  }
}

/**
 * Integration Cleanup
 * 
 * Provides cleanup function for graceful shutdown of PostgreSQL integration.
 */
export async function cleanupIntegration() {
  try {
    logger.info('Cleaning up PostgreSQL integration');

    const pgBridge = global.mcpHub?.postgresqlBridge;
    if (pgBridge) {
      await pgBridge.close();
      delete global.mcpHub.postgresqlBridge;
    }

    logger.info('PostgreSQL integration cleanup completed');

  } catch (error) {
    logger.error('PostgreSQL integration cleanup failed', { error: error.message });
  }
}

// Environment Configuration Helper
export function getIntegrationConfig() {
  const resolution = resolvePostgresIntegrationEnv(process.env);
  
  return {
    enabled: resolution.enabled,
    reason: resolution.reason,
    realTimeSync: process.env.ENABLE_REAL_TIME_SYNC !== 'false',
    autoPersistence: process.env.ENABLE_AUTO_PERSISTENCE !== 'false',
    analytics: process.env.ENABLE_ENHANCED_ANALYTICS !== 'false',
    database: {
      host: process.env.POSTGRES_HOST || '10.10.10.11',
      port: process.env.POSTGRES_PORT || 5432,
      database: process.env.POSTGRES_DB || 'postgres',
      user: process.env.POSTGRES_USER || 'postgres',
      // Note: password should be handled securely in production
    }
  };
}

export default {
  bootstrapPostgreSQLIntegration,
  createEnhancedChainMiddleware,
  createEnhancedAnalyticsMiddleware,
  checkIntegrationHealth,
  cleanupIntegration,
  getIntegrationConfig
};

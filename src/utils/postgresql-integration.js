/**
 * PostgreSQL Integration Bridge
 * 
 * This module provides integration between the Enhanced PostgreSQL Manager
 * and the existing MCP Hub infrastructure, ensuring seamless data flow
 * and backward compatibility with current systems.
 * 
 * INTEGRATION FEATURES:
 * - Bridges Enhanced PostgreSQL Manager with existing toolset registry
 * - Integrates with SSE Manager for real-time updates
 * - Connects with centralized tool index for synchronized operations
 * - Provides middleware for automatic data persistence
 * - Maintains compatibility with existing API endpoints
 */

import EnhancedPostgreSQLManager from './enhanced-postgresql-manager.js';
import { toolIndex } from './tool-index.js';
import logger from './logger.js';
import { wrapError } from './errors.js';

export class PostgreSQLIntegrationBridge {
  constructor(hubInstance, sseManager, options = {}) {
    this.hubInstance = hubInstance;
    this.sseManager = sseManager;
    this.options = {
      enableRealTimeSync: true,
      enableAutoPersistence: true,
      enableAnalytics: true,
      ...options
    };
    
    this.enhancedPgManager = null;
    this.initialized = false;
    this.syncStats = {
      toolsSynced: 0,
      serversSynced: 0,
      executionsLogged: 0,
      analyticsGenerated: 0
    };
  }

  /**
   * Initialize the PostgreSQL integration
   */
  async initialize() {
    try {
      logger.info('Initializing PostgreSQL Integration Bridge');
      
      // Initialize enhanced PostgreSQL manager
      this.enhancedPgManager = new EnhancedPostgreSQLManager({
        host: process.env.POSTGRES_HOST || '10.10.10.11',
        port: process.env.POSTGRES_PORT || 5432,
        database: process.env.POSTGRES_DB || 'postgres',
        user: process.env.POSTGRES_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD || 'DacDev@41'
      });
      
      await this.enhancedPgManager.initialize();
      
      // Set up integration hooks
      await this.setupIntegrationHooks();
      
      // Initial sync with existing data
      await this.performInitialSync();
      
      this.initialized = true;
      logger.info('PostgreSQL Integration Bridge initialized successfully');
      
      return this;
    } catch (error) {
      throw wrapError(error, 'POSTGRESQL_INTEGRATION_INIT_ERROR');
    }
  }

  /**
   * Set up integration hooks with existing MCP Hub components
   */
  async setupIntegrationHooks() {
    // Hook into tool index events
    toolIndex.on('serverRegistered', (event) => {
      this.handleServerRegistration(event);
    });
    
    toolIndex.on('toolUsed', (event) => {
      this.handleToolUsage(event);
    });
    
    // Hook into Enhanced PostgreSQL Manager events
    this.enhancedPgManager.on('enhancedChainExecutionLogged', (execution) => {
      this.broadcastChainExecutionUpdate(execution);
    });
    
    this.enhancedPgManager.on('chainExecutionProgressUpdated', (execution) => {
      this.broadcastChainExecutionUpdate(execution);
    });
    
    this.enhancedPgManager.on('securityAuditEvent', (event) => {
      this.handleSecurityEvent(event);
    });
    
    // Hook into hub lifecycle events
    if (this.hubInstance) {
      this.hubInstance.on('serverConnected', (serverInfo) => {
        this.handleServerConnection(serverInfo);
      });
      
      this.hubInstance.on('serverDisconnected', (serverInfo) => {
        this.handleServerDisconnection(serverInfo);
      });
      
      this.hubInstance.on('toolExecuted', (executionInfo) => {
        this.handleToolExecution(executionInfo);
      });
    }
    
    logger.info('Integration hooks set up successfully');
  }

  /**
   * Perform initial sync of existing data
   */
  async performInitialSync() {
    logger.info('Performing initial data sync');
    
    try {
      // Sync servers from tool index
      const serverStats = toolIndex.getStats();
      for (const serverName of serverStats.servers) {
        const serverEntry = toolIndex.getServer(serverName);
        if (serverEntry) {
          await this.syncServerToDatabase(serverName, serverEntry);
          this.syncStats.serversSynced++;
        }
      }
      
      // Sync tools from tool index
      const toolsResult = toolIndex.listTools({ includeMetadata: true });
      for (const tool of toolsResult.tools) {
        await this.syncToolToDatabase(tool);
        this.syncStats.toolsSynced++;
      }
      
      logger.info('Initial sync completed', {
        serversSynced: this.syncStats.serversSynced,
        toolsSynced: this.syncStats.toolsSynced
      });
      
    } catch (error) {
      logger.error('Initial sync failed', { error: error.message });
      throw wrapError(error, 'INITIAL_SYNC_ERROR');
    }
  }

  /**
   * Handle server registration from tool index
   */
  async handleServerRegistration(event) {
    if (!this.options.enableAutoPersistence) return;
    
    try {
      await this.syncServerToDatabase(event.serverName, event.serverInfo);
      this.syncStats.serversSynced++;
      
      logger.debug('Server registration synced to database', {
        serverName: event.serverName,
        toolCount: event.toolIds?.length || 0
      });
    } catch (error) {
      logger.warn('Failed to sync server registration', {
        serverName: event.serverName,
        error: error.message
      });
    }
  }

  /**
   * Handle tool usage events
   */
  async handleToolUsage(event) {
    if (!this.options.enableAutoPersistence) return;
    
    try {
      // Create enhanced tool execution record
      const executionInfo = {
        toolId: event.toolId,
        serverName: event.serverName,
        toolName: event.toolName,
        status: 'completed',
        durationMs: 0, // Will be updated by actual execution
        metadata: {
          source: 'tool_index_usage',
          usageCount: event.usageCount
        }
      };
      
      await this.enhancedPgManager.logToolExecution(executionInfo);
      this.syncStats.executionsLogged++;
      
    } catch (error) {
      logger.warn('Failed to log tool usage', {
        toolId: event.toolId,
        error: error.message
      });
    }
  }

  /**
   * Handle server connection events
   */
  async handleServerConnection(serverInfo) {
    try {
      // Update server status in database
      await this.enhancedPgManager.upsertServer(serverInfo.name, {
        ...serverInfo,
        status: 'connected',
        lastConnectedAt: new Date()
      });
      
      // Log security audit event
      await this.enhancedPgManager.logSecurityAuditEvent({
        eventType: 'server_connection',
        resourceType: 'server',
        resourceId: serverInfo.name,
        resourceName: serverInfo.displayName || serverInfo.name,
        action: 'connect',
        status: 'success',
        description: `Server ${serverInfo.name} connected successfully`
      });
      
      // Set metadata for connected server
      await this.enhancedPgManager.setEntityMetadata(
        'server',
        serverInfo.name,
        'connection',
        {
          lastConnectedAt: new Date().toISOString(),
          connectionCount: (await this.getServerConnectionCount(serverInfo.name)) + 1,
          transport: serverInfo.transport || 'unknown'
        }
      );
      
      logger.debug('Server connection processed', { serverName: serverInfo.name });
      
    } catch (error) {
      logger.warn('Failed to process server connection', {
        serverName: serverInfo.name,
        error: error.message
      });
    }
  }

  /**
   * Handle tool execution events
   */
  async handleToolExecution(executionInfo) {
    if (!this.options.enableAutoPersistence) return;
    
    try {
      // Enhanced tool execution logging
      const enhancedExecutionInfo = {
        ...executionInfo,
        executionId: executionInfo.executionId || `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        metadata: {
          ...executionInfo.metadata,
          integrationSource: 'hub_execution_handler',
          timestamp: new Date().toISOString()
        }
      };
      
      await this.enhancedPgManager.logToolExecution(enhancedExecutionInfo);
      this.syncStats.executionsLogged++;
      
      // Update tool metadata with execution statistics
      await this.updateToolExecutionMetadata(executionInfo);
      
      logger.debug('Tool execution logged', {
        toolId: executionInfo.toolId,
        status: executionInfo.status || 'completed',
        duration: executionInfo.durationMs || 0
      });
      
    } catch (error) {
      logger.warn('Failed to log tool execution', {
        toolId: executionInfo.toolId,
        error: error.message
      });
    }
  }

  /**
   * Handle enhanced tool chain execution
   */
  async handleEnhancedToolChainExecution(chainSpec, metadata = {}) {
    if (!this.initialized) {
      logger.warn('Integration bridge not initialized - skipping chain execution logging');
      return null;
    }
    
    try {
      const chainInfo = {
        chainConfig: chainSpec,
        chainType: this.determineChainType(chainSpec),
        totalSteps: chainSpec.chain?.length || 0,
        priority: chainSpec.execution_options?.priority || 0,
        initiatedBy: metadata.initiatedBy || 'hub',
        clientInfo: {
          userAgent: metadata.userAgent,
          sessionId: metadata.sessionId,
          requestId: metadata.requestId
        },
        securityContext: {
          permissions: metadata.permissions || [],
          tenant: metadata.tenant || 'default'
        },
        metadata: {
          ...metadata,
          integrationVersion: '2.0.0',
          source: 'enhanced_chain_handler'
        },
        tags: this.generateChainTags(chainSpec)
      };
      
      const chainExecution = await this.enhancedPgManager.logEnhancedToolChainExecution(chainInfo);
      
      logger.info('Enhanced tool chain execution logged', {
        chainId: chainExecution.chain_id,
        totalSteps: chainInfo.totalSteps,
        chainType: chainInfo.chainType
      });
      
      return chainExecution;
      
    } catch (error) {
      logger.error('Failed to log enhanced tool chain execution', {
        error: error.message,
        chainLength: chainSpec.chain?.length || 0
      });
      throw wrapError(error, 'ENHANCED_CHAIN_EXECUTION_LOG_ERROR');
    }
  }

  /**
   * Update tool chain execution progress
   */
  async updateChainExecutionProgress(chainId, progressInfo) {
    if (!this.initialized) return null;
    
    try {
      const result = await this.enhancedPgManager.updateChainExecutionProgress(chainId, progressInfo);
      
      // Broadcast progress update via SSE
      if (this.sseManager && this.options.enableRealTimeSync) {
        this.sseManager.broadcast('chain_progress_update', {
          chainId: chainId,
          progress: progressInfo,
          timestamp: new Date().toISOString()
        });
      }
      
      return result;
      
    } catch (error) {
      logger.warn('Failed to update chain execution progress', {
        chainId,
        error: error.message
      });
    }
  }

  /**
   * Get advanced analytics dashboard data
   */
  async getAdvancedAnalytics(timeRange = '24 hours', options = {}) {
    if (!this.initialized) {
      logger.warn('Integration bridge not initialized - returning empty analytics');
      return { hub: {}, topTools: [], chainExecutions: [], serverPerformance: [] };
    }
    
    try {
      const analytics = await this.enhancedPgManager.getAdvancedAnalytics(timeRange, options.includeRealTime);
      this.syncStats.analyticsGenerated++;
      
      // Add integration-specific metrics
      analytics.integration = {
        syncStats: this.syncStats,
        bridgeVersion: '2.0.0',
        lastSyncAt: new Date().toISOString()
      };
      
      return analytics;
      
    } catch (error) {
      logger.error('Failed to get advanced analytics', { error: error.message });
      throw wrapError(error, 'ADVANCED_ANALYTICS_ERROR');
    }
  }

  /**
   * Get entity metadata with integration-specific enhancements
   */
  async getEntityMetadata(entityType, entityId, namespace = 'default', keys = null) {
    if (!this.initialized) return {};
    
    try {
      const metadata = await this.enhancedPgManager.getEntityMetadata(entityType, entityId, namespace, keys);
      
      // Add integration-specific metadata
      if (entityType === 'tool') {
        const toolFromIndex = toolIndex.getTool(entityId);
        if (toolFromIndex) {
          metadata._integration = {
            toolIndex: {
              usageCount: toolFromIndex.usageCount,
              lastUsed: toolFromIndex.lastUsed,
              registeredAt: toolFromIndex.registeredAt
            }
          };
        }
      }
      
      return metadata;
      
    } catch (error) {
      logger.warn('Failed to get entity metadata', {
        entityType,
        entityId,
        namespace,
        error: error.message
      });
      return {};
    }
  }

  /**
   * Set entity metadata with integration hooks
   */
  async setEntityMetadata(entityType, entityId, namespace = 'default', metadataMap) {
    if (!this.initialized) return;
    
    try {
      await this.enhancedPgManager.setEntityMetadata(entityType, entityId, namespace, metadataMap);
      
      // Trigger SSE update for metadata changes
      if (this.sseManager && this.options.enableRealTimeSync) {
        this.sseManager.broadcast('metadata_updated', {
          entityType,
          entityId,
          namespace,
          keys: Object.keys(metadataMap),
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      logger.warn('Failed to set entity metadata', {
        entityType,
        entityId,
        namespace,
        error: error.message
      });
    }
  }

  /**
   * Sync server data to database
   */
  async syncServerToDatabase(serverName, serverInfo) {
    const serverConfig = {
      displayName: serverInfo.displayName || serverName,
      endpoint: serverInfo.endpoint || 'unknown',
      transportType: serverInfo.transport || 'stdio',
      status: serverInfo.status || 'unknown',
      capabilities: serverInfo.capabilities || {},
      metadata: {
        ...serverInfo.metadata,
        syncedAt: new Date().toISOString(),
        source: 'integration_bridge'
      },
      config: serverInfo.config || {}
    };
    
    await this.enhancedPgManager.upsertServer(serverName, serverConfig);
  }

  /**
   * Sync tool data to database
   */
  async syncToolToDatabase(tool) {
    const toolConfig = {
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema || {},
      category: tool.category || 'general',
      metadata: {
        ...tool.metadata,
        syncedAt: new Date().toISOString(),
        source: 'integration_bridge',
        originalRegisteredAt: tool.registeredAt
      }
    };
    
    await this.enhancedPgManager.upsertTool(tool.serverName, toolConfig);
  }

  /**
   * Update tool execution metadata
   */
  async updateToolExecutionMetadata(executionInfo) {
    const metadata = {
      executionStats: {
        lastExecutionAt: new Date().toISOString(),
        lastDuration: executionInfo.durationMs || 0,
        lastStatus: executionInfo.status || 'completed'
      }
    };
    
    if (executionInfo.error || executionInfo.errorMessage) {
      metadata.errorStats = {
        lastErrorAt: new Date().toISOString(),
        lastError: executionInfo.errorMessage || executionInfo.error
      };
    }
    
    await this.setEntityMetadata('tool', executionInfo.toolId, 'execution', metadata);
  }

  /**
   * Broadcast chain execution update via SSE
   */
  broadcastChainExecutionUpdate(execution) {
    if (this.sseManager && this.options.enableRealTimeSync) {
      this.sseManager.broadcast('chain_execution_update', {
        chainId: execution.chain_id,
        status: execution.status,
        progress: execution.progress_percent,
        completedSteps: execution.completed_steps,
        totalSteps: execution.total_steps,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle security events
   */
  handleSecurityEvent(event) {
    // Log high-severity security events
    if (['critical', 'high'].includes(event.severity)) {
      logger.warn('High-severity security event detected', {
        eventType: event.event_type,
        severity: event.severity,
        resourceType: event.resource_type,
        resourceId: event.resource_id,
        action: event.action,
        status: event.status
      });
    }
    
    // Broadcast security events via SSE
    if (this.sseManager && this.options.enableRealTimeSync) {
      this.sseManager.broadcast('security_audit_event', {
        ...event,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Get server connection count from metadata
   */
  async getServerConnectionCount(serverName) {
    const metadata = await this.getEntityMetadata('server', serverName, 'connection', ['connectionCount']);
    return metadata.connectionCount || 0;
  }

  /**
   * Determine chain type from chain specification
   */
  determineChainType(chainSpec) {
    if (!chainSpec.chain || !Array.isArray(chainSpec.chain)) {
      return 'unknown';
    }
    
    const hasParallelGroups = chainSpec.chain.some(step => step.parallel_group);
    const hasConditions = chainSpec.chain.some(step => step.conditions);
    
    if (hasParallelGroups) {
      return 'parallel';
    } else if (hasConditions) {
      return 'conditional';
    } else {
      return 'sequential';
    }
  }

  /**
   * Generate tags for chain execution
   */
  generateChainTags(chainSpec) {
    const tags = [];
    
    if (chainSpec.chain) {
      // Add server tags
      const servers = [...new Set(chainSpec.chain.map(step => step.server_name).filter(Boolean))];
      servers.forEach(server => tags.push(`server:${server}`));
      
      // Add tool category tags
      const categories = [...new Set(chainSpec.chain.map(step => step.category).filter(Boolean))];
      categories.forEach(category => tags.push(`category:${category}`));
      
      // Add execution option tags
      if (chainSpec.execution_options) {
        if (chainSpec.execution_options.fail_fast) {
          tags.push('fail-fast');
        }
        if (chainSpec.execution_options.rollback_on_error) {
          tags.push('rollback-enabled');
        }
      }
    }
    
    return tags;
  }

  /**
   * Get integration status and statistics
   */
  getIntegrationStatus() {
    return {
      initialized: this.initialized,
      enhancedManagerConnected: !!this.enhancedPgManager,
      syncStats: this.syncStats,
      options: this.options,
      cacheStatus: this.enhancedPgManager?.getEnhancedPoolStatus() || null
    };
  }

  /**
   * Cleanup and close integration bridge
   */
  async close() {
    logger.info('Closing PostgreSQL Integration Bridge');
    
    if (this.enhancedPgManager) {
      await this.enhancedPgManager.close();
    }
    
    this.initialized = false;
    logger.info('PostgreSQL Integration Bridge closed');
  }
}

// Export integration bridge
export default PostgreSQLIntegrationBridge;

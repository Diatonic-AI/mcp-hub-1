/**
 * PostgreSQL Hub Integration
 * 
 * This module provides the complete integration between the existing MCP Hub
 * components and the new PostgreSQL database adapters. It ensures that all
 * tool operations, server management, and API calls are properly tracked
 * in the database while maintaining backward compatibility.
 * 
 * INTEGRATION FEATURES:
 * - Tool Index Database Integration
 * - Toolset Registry Database Tracking
 * - API Request Logging
 * - Real-time Data Synchronization
 * - Enhanced Meta-Tools with Database Backend
 */

import logger from '../utils/logger.js';
import { wrapError, ErrorCode } from '../utils/errors.js';
import { createDatabaseAdapterFactory } from '../database/db-adapter.js';

/**
 * PostgreSQL Hub Integration Manager
 */
export class PostgreSQLHubIntegration {
  constructor(hubInstance, options = {}) {
    this.hubInstance = hubInstance;
    this.options = {
      enableDatabaseTracking: true,
      enableApiLogging: true,
      enableRealTimeSync: true,
      enableEnhancedMetaTools: true,
      ...options
    };

    // Database adapters
    this.adapterFactory = createDatabaseAdapterFactory(this.options.database);
    this.toolIndexAdapter = null;
    this.toolsetRegistryAdapter = null;
    this.apiRequestAdapter = null;

    // Integration state
    this.initialized = false;
    this.integrationStats = {
      serversTracked: 0,
      toolsTracked: 0,
      executionsTracked: 0,
      apiRequestsTracked: 0,
      chainsExecuted: 0
    };
  }

  /**
   * Initialize the PostgreSQL integration
   */
  async initialize() {
    try {
      logger.info('Initializing PostgreSQL Hub Integration');

      // Initialize database adapters
      if (this.options.enableDatabaseTracking) {
        await this.initializeDatabaseAdapters();
      }

      // Integrate with existing tool index
      if (this.hubInstance.toolIndex) {
        await this.integrateToolIndex();
      }

      // Integrate with existing toolset registry
      if (this.hubInstance.toolsetRegistry) {
        await this.integrateToolsetRegistry();
      }

      // Set up API request tracking
      if (this.options.enableApiLogging && this.hubInstance.app) {
        await this.setupApiRequestTracking();
      }

      // Enhance meta-tools with database backend
      if (this.options.enableEnhancedMetaTools) {
        await this.enhanceMetaTools();
      }

      this.initialized = true;
      logger.info('PostgreSQL Hub Integration initialized successfully');

      return this;
    } catch (error) {
      logger.error('Failed to initialize PostgreSQL Hub Integration', { error: error.message });
      throw wrapError(error, 'POSTGRESQL_HUB_INTEGRATION_ERROR');
    }
  }

  /**
   * Initialize database adapters
   */
  async initializeDatabaseAdapters() {
    logger.info('Initializing database adapters');

    try {
      // Create adapters
      this.toolIndexAdapter = this.adapterFactory.createToolIndexAdapter();
      this.toolsetRegistryAdapter = this.adapterFactory.createToolsetRegistryAdapter();
      this.apiRequestAdapter = this.adapterFactory.createApiRequestAdapter();

      // Initialize adapters
      await Promise.all([
        this.toolIndexAdapter.initialize(),
        this.toolsetRegistryAdapter.initialize(),
        this.apiRequestAdapter.initialize()
      ]);

      logger.info('Database adapters initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize database adapters', { error: error.message });
      throw wrapError(error, 'DATABASE_ADAPTER_INIT_ERROR');
    }
  }

  /**
   * Integrate with the existing CentralizedToolIndex
   */
  async integrateToolIndex() {
    if (!this.toolIndexAdapter) {
      logger.warn('Tool index adapter not available - skipping tool index integration');
      return;
    }

    logger.info('Integrating with CentralizedToolIndex');

    try {
      const toolIndex = this.hubInstance.toolIndex;

      // Hook into server registration events
      toolIndex.on('serverRegistered', async (event) => {
        try {
          const { serverName, serverInfo, toolIds } = event;
          
          // Register server in database
          const registrationResult = await this.toolIndexAdapter.registerServer({
            name: serverName,
            endpoint: serverInfo.endpoint,
            tools: serverInfo.tools || [],
            capabilities: serverInfo.capabilities || {},
            metadata: serverInfo.metadata || {}
          });

          this.integrationStats.serversTracked++;
          this.integrationStats.toolsTracked += toolIds.length;

          logger.debug(`Registered server ${serverName} in database`, {
            serverId: registrationResult.serverId,
            toolCount: toolIds.length
          });
        } catch (error) {
          logger.warn(`Failed to register server ${event.serverName} in database`, {
            error: error.message
          });
        }
      });

      // Hook into server unregistration events
      toolIndex.on('serverUnregistered', async (event) => {
        try {
          const { serverName } = event;
          
          // Unregister server in database
          await this.toolIndexAdapter.unregisterServer(serverName);

          logger.debug(`Unregistered server ${serverName} from database`);
        } catch (error) {
          logger.warn(`Failed to unregister server ${event.serverName} from database`, {
            error: error.message
          });
        }
      });

      // Hook into tool usage events
      toolIndex.on('toolUsed', async (event) => {
        try {
          const { toolId } = event;
          
          // Record tool usage in database
          await this.toolIndexAdapter.recordToolUsage(toolId);

          this.integrationStats.executionsTracked++;

          logger.debug(`Recorded tool usage for ${toolId}`);
        } catch (error) {
          logger.debug(`Failed to record tool usage for ${event.toolId}`, {
            error: error.message
          });
        }
      });

      // Sync existing data
      await this.syncExistingToolIndexData(toolIndex);

      logger.info('CentralizedToolIndex integration completed');
    } catch (error) {
      logger.error('Failed to integrate with CentralizedToolIndex', { error: error.message });
      throw wrapError(error, 'TOOL_INDEX_INTEGRATION_ERROR');
    }
  }

  /**
   * Integrate with the existing ToolsetRegistry
   */
  async integrateToolsetRegistry() {
    if (!this.toolsetRegistryAdapter) {
      logger.warn('Toolset registry adapter not available - skipping toolset registry integration');
      return;
    }

    logger.info('Integrating with ToolsetRegistry');

    try {
      const toolsetRegistry = this.hubInstance.toolsetRegistry;

      // Enhanced chain tools integration
      if (toolsetRegistry.tools && toolsetRegistry.tools.hub__chain_tools) {
        await this.enhanceChainToolsWithDatabase();
      }

      // Enhanced server listing integration
      if (toolsetRegistry.tools) {
        await this.enhanceServerListingWithDatabase();
      }

      logger.info('ToolsetRegistry integration completed');
    } catch (error) {
      logger.error('Failed to integrate with ToolsetRegistry', { error: error.message });
      throw wrapError(error, 'TOOLSET_REGISTRY_INTEGRATION_ERROR');
    }
  }

  /**
   * Enhance chain tools with database tracking
   */
  async enhanceChainToolsWithDatabase() {
    const toolsetRegistry = this.hubInstance.toolsetRegistry;
    const originalChainTool = toolsetRegistry.tools.hub__chain_tools;

    if (!originalChainTool) {
      logger.warn('hub__chain_tools not found - skipping chain enhancement');
      return;
    }

    // Create enhanced version
    const enhancedChainTool = async (params) => {
      const startTime = Date.now();
      let chainId = null;
      let chainExecutionId = null;

      try {
        // Record chain execution start
        const chainResult = await this.toolsetRegistryAdapter.recordChainExecution(params, {
          initiatedBy: 'hub_chain_tools',
          clientInfo: { enhanced: true },
          startTime: new Date().toISOString()
        });

        chainId = chainResult.chainId;
        chainExecutionId = chainResult.chainExecutionId;
        this.integrationStats.chainsExecuted++;

        logger.info(`Started enhanced chain execution ${chainId}`);

        // Update progress: starting
        await this.toolsetRegistryAdapter.updateChainExecutionProgress(chainId, {
          status: 'running',
          progressPercent: 0
        });

        // Execute the original chain logic
        const result = await originalChainTool(params);

        // Update progress: completed
        const endTime = Date.now();
        const duration = endTime - startTime;

        await this.toolsetRegistryAdapter.updateChainExecutionProgress(chainId, {
          status: 'completed',
          progressPercent: 100,
          completedSteps: params.chain?.length || 0,
          endTime: new Date(endTime).toISOString(),
          durationMs: duration
        });

        logger.info(`Completed enhanced chain execution ${chainId}`, {
          duration,
          steps: params.chain?.length || 0
        });

        // Add chain tracking information to result
        const enhancedResult = {
          ...result,
          chainTracking: {
            chainId,
            chainExecutionId,
            duration,
            databaseTracked: true
          }
        };

        return enhancedResult;
      } catch (error) {
        // Update progress: failed
        if (chainId) {
          await this.toolsetRegistryAdapter.updateChainExecutionProgress(chainId, {
            status: 'failed',
            errors: [{
              step: -1,
              error: error.message,
              timestamp: new Date().toISOString()
            }],
            endTime: new Date().toISOString(),
            durationMs: Date.now() - startTime
          });
        }

        logger.error(`Enhanced chain execution failed`, {
          chainId,
          error: error.message
        });

        throw error;
      }
    };

    // Replace the original tool
    toolsetRegistry.tools.hub__chain_tools = enhancedChainTool;

    logger.info('Enhanced hub__chain_tools with database tracking');
  }

  /**
   * Enhance server listing tools with database data
   */
  async enhanceServerListingWithDatabase() {
    const toolsetRegistry = this.hubInstance.toolsetRegistry;

    // Enhance List_All_Servers
    if (toolsetRegistry.tools.hub__list_servers || toolsetRegistry.tools.List_All_Servers) {
      const originalListServers = toolsetRegistry.tools.hub__list_servers || toolsetRegistry.tools.List_All_Servers;

      const enhancedListServers = async (params) => {
        try {
          // Get enhanced server data from database
          const dbServers = await this.toolIndexAdapter.getActiveServers();
          
          // Get original result
          const originalResult = await originalListServers(params);

          // Merge database data with original result
          const enhancedContent = [{
            type: 'text',
            text: this.formatEnhancedServerList(dbServers, originalResult)
          }];

          return {
            content: enhancedContent
          };
        } catch (error) {
          logger.warn('Failed to get enhanced server data, falling back to original', {
            error: error.message
          });
          return await originalListServers(params);
        }
      };

      // Replace the tool
      const toolName = toolsetRegistry.tools.hub__list_servers ? 'hub__list_servers' : 'List_All_Servers';
      toolsetRegistry.tools[toolName] = enhancedListServers;

      logger.info(`Enhanced ${toolName} with database data`);
    }

    // Enhance List_Server_Tools
    if (toolsetRegistry.tools.hub__list_server_tools || toolsetRegistry.tools.List_Server_Tools) {
      const originalListServerTools = toolsetRegistry.tools.hub__list_server_tools || toolsetRegistry.tools.List_Server_Tools;

      const enhancedListServerTools = async (params) => {
        try {
          const { server_name } = params;
          
          // Get enhanced tool data from database
          const dbTools = await this.toolIndexAdapter.getServerTools(server_name);
          
          // Get original result
          const originalResult = await originalListServerTools(params);

          // Merge database data with original result
          const enhancedContent = [{
            type: 'text',
            text: this.formatEnhancedToolList(dbTools, originalResult, server_name)
          }];

          return {
            content: enhancedContent
          };
        } catch (error) {
          logger.warn('Failed to get enhanced tool data, falling back to original', {
            error: error.message,
            serverName: params.server_name
          });
          return await originalListServerTools(params);
        }
      };

      // Replace the tool
      const toolName = toolsetRegistry.tools.hub__list_server_tools ? 'hub__list_server_tools' : 'List_Server_Tools';
      toolsetRegistry.tools[toolName] = enhancedListServerTools;

      logger.info(`Enhanced ${toolName} with database data`);
    }

    // Enhance List_All_Tools
    if (toolsetRegistry.tools.hub__list_all_tools || toolsetRegistry.tools.List_All_Tools) {
      const originalListAllTools = toolsetRegistry.tools.hub__list_all_tools || toolsetRegistry.tools.List_All_Tools;

      const enhancedListAllTools = async (params) => {
        try {
          // Get enhanced statistics from database
          const stats = await this.toolIndexAdapter.getIndexStats();
          
          // Get original result
          const originalResult = await originalListAllTools(params);

          // Enhance the result with database statistics
          const enhancedContent = [{
            type: 'text',
            text: this.formatEnhancedAllToolsList(stats, originalResult)
          }];

          return {
            content: enhancedContent
          };
        } catch (error) {
          logger.warn('Failed to get enhanced tool statistics, falling back to original', {
            error: error.message
          });
          return await originalListAllTools(params);
        }
      };

      // Replace the tool
      const toolName = toolsetRegistry.tools.hub__list_all_tools ? 'hub__list_all_tools' : 'List_All_Tools';
      toolsetRegistry.tools[toolName] = enhancedListAllTools;

      logger.info(`Enhanced ${toolName} with database statistics`);
    }
  }

  /**
   * Set up API request tracking middleware
   */
  async setupApiRequestTracking() {
    if (!this.hubInstance.app || !this.apiRequestAdapter) {
      logger.warn('Express app or API adapter not available - skipping API tracking');
      return;
    }

    logger.info('Setting up API request tracking middleware');

    try {
      const app = this.hubInstance.app;

      // Add request tracking middleware
      app.use((req, res, next) => {
        const startTime = Date.now();
        let requestId = null;

        // Start request tracking
        this.apiRequestAdapter.recordApiRequest({
          method: req.method,
          path: req.path,
          query: req.query,
          headers: req.headers,
          body: req.body,
          ip: req.ip || req.connection.remoteAddress,
          userAgent: req.get('User-Agent'),
          sessionId: req.sessionID,
          userId: req.user?.id,
          correlationId: req.headers['x-correlation-id']
        }).then(id => {
          requestId = id;
          req.requestId = id;
        }).catch(error => {
          logger.debug('Failed to record API request', { error: error.message });
        });

        // Hook into response
        const originalSend = res.send;
        res.send = function(body) {
          const endTime = Date.now();
          const duration = endTime - startTime;

          // Update request tracking
          if (requestId) {
            this.apiRequestAdapter.updateApiRequest(requestId, {
              statusCode: res.statusCode,
              headers: res.getHeaders(),
              body: body,
              durationMs: duration
            }).catch(error => {
              logger.debug('Failed to update API request', { error: error.message });
            });

            this.integrationStats.apiRequestsTracked++;
          }

          return originalSend.call(this, body);
        }.bind(this);

        next();
      });

      logger.info('API request tracking middleware installed');
    } catch (error) {
      logger.error('Failed to set up API request tracking', { error: error.message });
      throw wrapError(error, 'API_TRACKING_SETUP_ERROR');
    }
  }

  /**
   * Enhance meta-tools with database backend
   */
  async enhanceMetaTools() {
    logger.info('Enhancing meta-tools with database backend');

    try {
      const toolsetRegistry = this.hubInstance.toolsetRegistry;
      if (!toolsetRegistry || !toolsetRegistry.tools) {
        logger.warn('Toolset registry or tools not found - skipping meta-tool enhancement');
        return;
      }

      // Add enhanced analytics meta-tool
      toolsetRegistry.tools.hub__analytics_advanced = async (params = {}) => {
        const { timeRange = '24 hours', includeRealTime = false, format = 'detailed' } = params;

        try {
          if (!this.toolIndexAdapter) {
            return {
              content: [{
                type: 'text',
                text: '⚠️ Database integration not available - basic analytics only'
              }]
            };
          }

          // Get database statistics
          const stats = await this.toolIndexAdapter.getIndexStats();

          // Format advanced analytics report
          const report = [
            `# 📊 Advanced MCP Hub Analytics (${timeRange})`,
            `**Generated:** ${new Date().toISOString()}`,
            `**Database Integration:** ✅ Active\n`,
            
            `## 🎯 Hub Statistics`,
            `- **Total Servers:** ${stats.totalServers}`,
            `- **Total Tools:** ${stats.totalTools}`,
            `- **Total Usage Count:** ${stats.totalUsage}`,
            `- **Last Updated:** ${stats.lastUpdated || 'Unknown'}\n`,

            `## 📈 Integration Metrics`,
            `- **Servers Tracked:** ${this.integrationStats.serversTracked}`,
            `- **Tools Tracked:** ${this.integrationStats.toolsTracked}`,
            `- **Executions Tracked:** ${this.integrationStats.executionsTracked}`,
            `- **API Requests Tracked:** ${this.integrationStats.apiRequestsTracked}`,
            `- **Chains Executed:** ${this.integrationStats.chainsExecuted}\n`,

            `## 🔧 Database Status`,
            `- **Tool Index Adapter:** ${this.toolIndexAdapter?.connected ? '✅' : '❌'} Connected`,
            `- **Registry Adapter:** ${this.toolsetRegistryAdapter?.connected ? '✅' : '❌'} Connected`,
            `- **API Adapter:** ${this.apiRequestAdapter?.connected ? '✅' : '❌'} Connected`
          ];

          return {
            content: [{
              type: 'text',
              text: report.join('\n')
            }]
          };
        } catch (error) {
          logger.error('Enhanced analytics failed', { error: error.message });
          return {
            content: [{
              type: 'text',
              text: `❌ Enhanced analytics failed: ${error.message}`
            }],
            isError: true
          };
        }
      };

      // Add database status meta-tool
      toolsetRegistry.tools.hub__database_status = async (params = {}) => {
        const { verbose = false } = params;

        try {
          const status = {
            initialized: this.initialized,
            adapters: {
              toolIndex: !!this.toolIndexAdapter,
              toolsetRegistry: !!this.toolsetRegistryAdapter,
              apiRequest: !!this.apiRequestAdapter
            },
            statistics: this.integrationStats,
            options: this.options
          };

          const report = [
            `# 🛢️ Database Integration Status`,
            `**Generated:** ${new Date().toISOString()}\n`,
            
            `## 📊 Integration Status`,
            `- **Initialized:** ${status.initialized ? '✅' : '❌'}`,
            `- **Database Tracking:** ${this.options.enableDatabaseTracking ? '✅' : '❌'}`,
            `- **API Logging:** ${this.options.enableApiLogging ? '✅' : '❌'}`,
            `- **Real-time Sync:** ${this.options.enableRealTimeSync ? '✅' : '❌'}\n`,

            `## 🔌 Adapter Status`,
            `- **Tool Index Adapter:** ${status.adapters.toolIndex ? '✅' : '❌'}`,
            `- **Toolset Registry Adapter:** ${status.adapters.toolsetRegistry ? '✅' : '❌'}`,
            `- **API Request Adapter:** ${status.adapters.apiRequest ? '✅' : '❌'}\n`,

            `## 📈 Statistics`,
            `- **Servers Tracked:** ${status.statistics.serversTracked}`,
            `- **Tools Tracked:** ${status.statistics.toolsTracked}`,
            `- **Executions Tracked:** ${status.statistics.executionsTracked}`,
            `- **API Requests Tracked:** ${status.statistics.apiRequestsTracked}`,
            `- **Chains Executed:** ${status.statistics.chainsExecuted}`,

            ...(verbose ? [
              '\n## 🔧 Configuration',
              '```json',
              JSON.stringify(this.options, null, 2),
              '```'
            ] : [])
          ];

          return {
            content: [{
              type: 'text',
              text: report.join('\n')
            }]
          };
        } catch (error) {
          logger.error('Database status check failed', { error: error.message });
          return {
            content: [{
              type: 'text',
              text: `❌ Database status check failed: ${error.message}`
            }],
            isError: true
          };
        }
      };

      logger.info('Enhanced meta-tools with database backend');
    } catch (error) {
      logger.error('Failed to enhance meta-tools', { error: error.message });
      throw wrapError(error, 'META_TOOLS_ENHANCEMENT_ERROR');
    }
  }

  /**
   * Sync existing tool index data to database
   */
  async syncExistingToolIndexData(toolIndex) {
    if (!toolIndex || !this.toolIndexAdapter) {
      return;
    }

    logger.info('Syncing existing tool index data to database');

    try {
      const stats = toolIndex.getStats();
      
      // Sync servers
      for (const serverName of stats.servers || []) {
        try {
          const server = toolIndex.getServer(serverName);
          if (server) {
            await this.toolIndexAdapter.registerServer({
              name: serverName,
              endpoint: server.endpoint || 'unknown',
              capabilities: server.capabilities || {},
              metadata: { 
                ...server.metadata,
                syncedFromIndex: true,
                syncedAt: new Date().toISOString()
              }
            });
            this.integrationStats.serversTracked++;
          }
        } catch (error) {
          logger.warn(`Failed to sync server ${serverName}`, { error: error.message });
        }
      }

      // Sync tools
      const toolsResult = toolIndex.listTools({ includeMetadata: true });
      for (const tool of toolsResult.tools || []) {
        try {
          await this.toolIndexAdapter.registerTool(tool.serverName, {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            category: tool.category,
            metadata: {
              ...tool.metadata,
              syncedFromIndex: true,
              syncedAt: new Date().toISOString(),
              usageCount: tool.usageCount || 0
            }
          });
          this.integrationStats.toolsTracked++;
        } catch (error) {
          logger.warn(`Failed to sync tool ${tool.id}`, { error: error.message });
        }
      }

      logger.info('Existing tool index data synced to database', {
        servers: this.integrationStats.serversTracked,
        tools: this.integrationStats.toolsTracked
      });
    } catch (error) {
      logger.error('Failed to sync existing tool index data', { error: error.message });
      // Non-fatal error - continue without sync
    }
  }

  /**
   * Format enhanced server list
   */
  formatEnhancedServerList(dbServers, originalResult) {
    const header = `# 🖥️ Enhanced Server List (Database-Backed)\n\n`;
    const summary = `**Database Servers:** ${dbServers.length} | **Integration Status:** ✅ Active\n\n`;

    const serverList = dbServers.map(server => [
      `## ${server.name}`,
      `- **Status:** ${server.status} ${server.status === 'active' ? '🟢' : '🔴'}`,
      `- **Endpoint:** ${server.endpoint}`,
      `- **Tools:** ${server.toolCount} (${server.activeToolCount} active)`,
      `- **Connections:** ${server.connectionCount}`,
      `- **Last Connected:** ${server.lastConnected ? new Date(server.lastConnected).toLocaleString() : 'Never'}`,
      ''
    ]).flat();

    return header + summary + serverList.join('\n');
  }

  /**
   * Format enhanced tool list
   */
  formatEnhancedToolList(dbTools, originalResult, serverName) {
    const header = `# 🔧 Enhanced Tools for Server: ${serverName}\n\n`;
    const summary = `**Database Tools:** ${dbTools.length} | **Integration Status:** ✅ Active\n\n`;

    const toolList = dbTools.map(tool => [
      `## ${tool.name}`,
      `- **ID:** ${tool.toolId}`,
      `- **Category:** ${tool.category}`,
      `- **Usage Count:** ${tool.usageCount || 0}`,
      `- **Last Used:** ${tool.lastUsed ? new Date(tool.lastUsed).toLocaleString() : 'Never'}`,
      `- **Avg Execution Time:** ${tool.avgExecutionTime || 'N/A'}ms`,
      `- **Description:** ${tool.description || 'No description'}`,
      `- **Active:** ${tool.isActive ? '✅' : '❌'}`,
      ''
    ]).flat();

    return header + summary + toolList.join('\n');
  }

  /**
   * Format enhanced all tools list
   */
  formatEnhancedAllToolsList(stats, originalResult) {
    const header = `# 🔧 Enhanced All Tools List (Database Analytics)\n\n`;
    const summary = [
      `**Total Servers:** ${stats.totalServers}`,
      `**Total Tools:** ${stats.totalTools}`,
      `**Total Usage:** ${stats.totalUsage}`,
      `**Last Updated:** ${stats.lastUpdated ? new Date(stats.lastUpdated).toLocaleString() : 'Unknown'}`,
      `**Integration Status:** ✅ Active\n\n`
    ].join('\n');

    // Extract original content if available
    let originalContent = '';
    if (originalResult?.content?.[0]?.text) {
      originalContent = originalResult.content[0].text;
    }

    return header + summary + originalContent;
  }

  /**
   * Get integration statistics
   */
  getIntegrationStats() {
    return {
      initialized: this.initialized,
      options: this.options,
      statistics: this.integrationStats,
      adapters: {
        toolIndex: {
          available: !!this.toolIndexAdapter,
          connected: this.toolIndexAdapter?.connected || false
        },
        toolsetRegistry: {
          available: !!this.toolsetRegistryAdapter,
          connected: this.toolsetRegistryAdapter?.connected || false
        },
        apiRequest: {
          available: !!this.apiRequestAdapter,
          connected: this.apiRequestAdapter?.connected || false
        }
      }
    };
  }

  /**
   * Close all database connections
   */
  async close() {
    logger.info('Closing PostgreSQL Hub Integration');

    try {
      if (this.toolIndexAdapter) {
        await this.toolIndexAdapter.close();
      }
      if (this.toolsetRegistryAdapter) {
        await this.toolsetRegistryAdapter.close();
      }
      if (this.apiRequestAdapter) {
        await this.apiRequestAdapter.close();
      }

      this.initialized = false;
      logger.info('PostgreSQL Hub Integration closed successfully');
    } catch (error) {
      logger.error('Error closing PostgreSQL Hub Integration', { error: error.message });
    }
  }
}

/**
 * Initialize PostgreSQL Hub Integration
 * 
 * This is the main entry point for integrating the MCP Hub with PostgreSQL
 */
export async function initializePostgreSQLHubIntegration(hubInstance, options = {}) {
  const integration = new PostgreSQLHubIntegration(hubInstance, options);
  await integration.initialize();
  return integration;
}

export default PostgreSQLHubIntegration;

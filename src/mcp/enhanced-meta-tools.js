/**
 * Enhanced Meta-Tools for MCP Hub
 * 
 * This module extends the existing meta-tools in toolset-registry.js with
 * advanced PostgreSQL-backed functionality including analytics, chain execution
 * tracking, metadata management, and performance monitoring.
 * 
 * ENHANCED FEATURES:
 * - Advanced analytics and performance insights
 * - Enhanced tool chain execution with PostgreSQL persistence
 * - Real-time metadata and status monitoring
 * - Security audit and compliance tools
 * - Advanced server and tool relationship analytics
 */

import logger from '../utils/logger.js';
import { wrapError, ErrorCode, McpError } from '../utils/errors.js';

/**
 * Enhanced Analytics Meta-Tool
 * Provides advanced analytics with PostgreSQL-backed insights
 */
export async function hub__analytics_advanced(params = {}) {
  const { 
    timeRange = '24 hours',
    includeRealTime = false,
    groupBy = 'hour',
    includeMetadata = true,
    format = 'detailed'
  } = params;

  try {
    // Get PostgreSQL integration bridge instance
    const pgBridge = global.mcpHub?.postgresqlBridge;
    if (!pgBridge?.initialized) {
      return {
        content: [{
          type: 'text',
          text: '⚠️ Enhanced analytics requires PostgreSQL integration. Using fallback basic analytics.'
        }]
      };
    }

    // Get advanced analytics data
    const analytics = await pgBridge.getAdvancedAnalytics(timeRange, { 
      includeRealTime,
      groupBy,
      includeMetadata
    });

    if (format === 'json') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(analytics, null, 2)
        }]
      };
    }

    // Format detailed analytics report
    const report = [
      `# 📊 Advanced MCP Hub Analytics (${timeRange})\n`,
      `**Generated:** ${new Date().toISOString()}\n`,
      `**Time Range:** ${timeRange} | **Group By:** ${groupBy}\n\n`,
      
      `## 🎯 Hub Performance Overview`,
      `- **Total Tool Executions:** ${analytics.hub.totalExecutions || 0}`,
      `- **Success Rate:** ${analytics.hub.successRate || 0}%`,
      `- **Average Duration:** ${analytics.hub.avgDuration || 0}ms`,
      `- **Active Servers:** ${analytics.hub.activeServers || 0}`,
      `- **Error Rate:** ${analytics.hub.errorRate || 0}%\n`,

      `## 🔧 Top Performing Tools`,
      ...(analytics.topTools || []).map((tool, i) => 
        `${i + 1}. **${tool.toolName}** (${tool.serverName})\n   - Executions: ${tool.executionCount}, Success: ${tool.successRate}%, Avg: ${tool.avgDuration}ms`
      ),
      '\n',

      `## 🔗 Chain Executions Overview`,
      `- **Total Chains:** ${analytics.chainExecutions?.total || 0}`,
      `- **Sequential:** ${analytics.chainExecutions?.sequential || 0}`,
      `- **Parallel:** ${analytics.chainExecutions?.parallel || 0}`,
      `- **Conditional:** ${analytics.chainExecutions?.conditional || 0}`,
      `- **Average Steps per Chain:** ${analytics.chainExecutions?.avgSteps || 0}\n`,

      `## 🖥️ Server Performance`,
      ...(analytics.serverPerformance || []).map(server => 
        `### ${server.serverName}\n- Status: ${server.status} | Uptime: ${server.uptimePercent || 0}%\n- Avg Response: ${server.avgResponseTime || 0}ms | Tool Count: ${server.toolCount || 0}`
      ),

      `\n## 🔍 Integration Status`,
      `- **Bridge Version:** ${analytics.integration?.bridgeVersion || 'Unknown'}`,
      `- **Sync Stats:** Tools: ${analytics.integration?.syncStats?.toolsSynced || 0}, Servers: ${analytics.integration?.syncStats?.serversSynced || 0}`,
      `- **Last Sync:** ${analytics.integration?.lastSyncAt || 'Unknown'}`
    ];

    return {
      content: [{
        type: 'text',
        text: report.join('\n')
      }]
    };

  } catch (error) {
    logger.error('Enhanced analytics meta-tool error', { error: error.message, params });
    throw new McpError(ErrorCode.InternalError, `Enhanced analytics failed: ${error.message}`);
  }
}

/**
 * Enhanced Tool Chain Meta-Tool with PostgreSQL persistence
 * Provides advanced chain execution with tracking, analytics, and recovery
 */
export async function hub__chain_tools_enhanced(params) {
  const {
    chain = [],
    execution_options = {},
    metadata = {},
    enableTracking = true,
    enableAnalytics = true
  } = params;

  if (!Array.isArray(chain) || chain.length === 0) {
    throw new McpError(ErrorCode.InvalidParams, 'Chain must be a non-empty array');
  }

  try {
    const pgBridge = global.mcpHub?.postgresqlBridge;
    const startTime = Date.now();
    
    let chainExecution = null;
    
    // Initialize enhanced tracking if available
    if (pgBridge?.initialized && enableTracking) {
      chainExecution = await pgBridge.handleEnhancedToolChainExecution({
        chain,
        execution_options
      }, {
        ...metadata,
        enhancedTrackingEnabled: true,
        startTime: new Date().toISOString()
      });
      
      logger.info('Enhanced chain execution started', {
        chainId: chainExecution.chain_id,
        totalSteps: chain.length
      });
    }

    // Execute the chain using the existing hub__chain_tools logic
    // (This would integrate with the existing implementation from toolset-registry.js)
    const hubInstance = global.mcpHub;
    if (!hubInstance) {
      throw new McpError(ErrorCode.InternalError, 'MCP Hub instance not available');
    }

    const results = [];
    const executionState = {
      variables: params.variables || {},
      stepResults: new Map(),
      errors: [],
      completedSteps: 0
    };

    // Group steps for parallel execution
    const parallelGroups = new Map();
    const sequentialSteps = [];

    chain.forEach((step, index) => {
      step._originalIndex = index;
      if (step.parallel_group) {
        if (!parallelGroups.has(step.parallel_group)) {
          parallelGroups.set(step.parallel_group, []);
        }
        parallelGroups.get(step.parallel_group).push(step);
      } else {
        sequentialSteps.push(step);
      }
    });

    // Execute sequential steps
    for (const step of sequentialSteps) {
      try {
        // Update progress if tracking enabled
        if (chainExecution && pgBridge) {
          await pgBridge.updateChainExecutionProgress(chainExecution.chain_id, {
            status: 'running',
            completedSteps: executionState.completedSteps,
            currentStep: step._originalIndex,
            progressPercent: (executionState.completedSteps / chain.length) * 100
          });
        }

        const stepResult = await executeChainStep(hubInstance, step, executionState);
        results.push(stepResult);
        executionState.stepResults.set(step.id || step._originalIndex, stepResult);
        executionState.completedSteps++;

      } catch (error) {
        logger.error('Chain step execution failed', {
          stepIndex: step._originalIndex,
          error: error.message
        });
        
        executionState.errors.push({
          step: step._originalIndex,
          error: error.message,
          timestamp: new Date().toISOString()
        });

        if (execution_options.fail_fast !== false) {
          break;
        }
      }
    }

    // Execute parallel groups
    for (const [groupName, steps] of parallelGroups) {
      try {
        const parallelPromises = steps.map(step => 
          executeChainStep(hubInstance, step, executionState)
            .catch(error => ({ error: error.message, step: step._originalIndex }))
        );

        const parallelResults = await Promise.allSettled(parallelPromises);
        results.push(...parallelResults.map(r => r.value || r.reason));
        executionState.completedSteps += steps.length;

        // Update progress for parallel group
        if (chainExecution && pgBridge) {
          await pgBridge.updateChainExecutionProgress(chainExecution.chain_id, {
            status: 'running',
            completedSteps: executionState.completedSteps,
            progressPercent: (executionState.completedSteps / chain.length) * 100
          });
        }

      } catch (error) {
        logger.error('Parallel group execution failed', {
          groupName,
          error: error.message
        });
        
        if (execution_options.fail_fast !== false) {
          break;
        }
      }
    }

    const endTime = Date.now();
    const totalDuration = endTime - startTime;

    // Finalize tracking
    if (chainExecution && pgBridge) {
      const finalStatus = executionState.errors.length > 0 ? 'completed_with_errors' : 'completed';
      await pgBridge.updateChainExecutionProgress(chainExecution.chain_id, {
        status: finalStatus,
        completedSteps: executionState.completedSteps,
        totalSteps: chain.length,
        progressPercent: 100,
        endTime: new Date().toISOString(),
        durationMs: totalDuration,
        errors: executionState.errors
      });
    }

    // Generate enhanced results
    const enhancedResults = {
      chainId: chainExecution?.chain_id,
      totalSteps: chain.length,
      completedSteps: executionState.completedSteps,
      duration: totalDuration,
      errors: executionState.errors,
      results: results,
      statistics: {
        successRate: ((executionState.completedSteps - executionState.errors.length) / chain.length) * 100,
        averageStepDuration: totalDuration / executionState.completedSteps,
        parallelGroups: parallelGroups.size,
        sequentialSteps: sequentialSteps.length
      }
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(enhancedResults, null, 2)
      }],
      isError: executionState.errors.length > 0
    };

  } catch (error) {
    logger.error('Enhanced chain tools execution failed', { 
      error: error.message, 
      chainLength: chain.length 
    });
    throw new McpError(ErrorCode.InternalError, `Enhanced chain execution failed: ${error.message}`);
  }
}

/**
 * Server Health and Performance Meta-Tool
 */
export async function hub__server_health_advanced(params = {}) {
  const { serverName, includeMetrics = true, includeHistory = false } = params;

  try {
    const pgBridge = global.mcpHub?.postgresqlBridge;
    const hubInstance = global.mcpHub;
    
    if (!hubInstance) {
      throw new McpError(ErrorCode.InternalError, 'MCP Hub instance not available');
    }

    const servers = serverName ? [serverName] : Object.keys(hubInstance.servers || {});
    const serverHealthData = [];

    for (const name of servers) {
      const server = hubInstance.servers[name];
      const healthInfo = {
        name,
        status: server?.status || 'unknown',
        connected: !!server?.connected,
        lastConnected: server?.lastConnected,
        toolCount: Object.keys(server?.tools || {}).length
      };

      // Add PostgreSQL-backed metrics if available
      if (pgBridge?.initialized && includeMetrics) {
        const metadata = await pgBridge.getEntityMetadata('server', name);
        healthInfo.metrics = {
          connectionCount: metadata.connection?.connectionCount || 0,
          lastConnectionAt: metadata.connection?.lastConnectedAt,
          transport: metadata.connection?.transport,
          performanceData: metadata.performance || {}
        };

        // Get execution history if requested
        if (includeHistory) {
          // This would query the enhanced analytics for server-specific data
          const analytics = await pgBridge.getAdvancedAnalytics('7 days', {
            serverFilter: name,
            includeHistory: true
          });
          healthInfo.history = analytics.serverPerformance?.find(s => s.serverName === name);
        }
      }

      serverHealthData.push(healthInfo);
    }

    const report = [
      `# 🖥️ Server Health Report ${serverName ? `- ${serverName}` : '(All Servers)'}`,
      `**Generated:** ${new Date().toISOString()}\n`,
      
      ...serverHealthData.map(server => [
        `## ${server.name}`,
        `- **Status:** ${server.status} ${server.connected ? '🟢' : '🔴'}`,
        `- **Tools:** ${server.toolCount}`,
        `- **Last Connected:** ${server.lastConnected || 'Never'}`,
        
        ...(server.metrics ? [
          `- **Connection Count:** ${server.metrics.connectionCount}`,
          `- **Transport:** ${server.metrics.transport}`,
          `- **Performance:** ${JSON.stringify(server.metrics.performanceData)}`
        ] : []),
        
        ...(server.history ? [
          `- **Uptime (7 days):** ${server.history.uptimePercent}%`,
          `- **Avg Response Time:** ${server.history.avgResponseTime}ms`
        ] : []),
        ''
      ]).flat()
    ];

    return {
      content: [{
        type: 'text',
        text: report.join('\n')
      }]
    };

  } catch (error) {
    logger.error('Server health meta-tool error', { error: error.message, params });
    throw new McpError(ErrorCode.InternalError, `Server health check failed: ${error.message}`);
  }
}

/**
 * Metadata Management Meta-Tool
 */
export async function hub__metadata_manager(params) {
  const {
    action,
    entityType,
    entityId,
    namespace = 'default',
    key,
    value,
    keys
  } = params;

  if (!action || !entityType || !entityId) {
    throw new McpError(ErrorCode.InvalidParams, 'action, entityType, and entityId are required');
  }

  try {
    const pgBridge = global.mcpHub?.postgresqlBridge;
    
    if (!pgBridge?.initialized) {
      return {
        content: [{
          type: 'text',
          text: '⚠️ Metadata management requires PostgreSQL integration.'
        }]
      };
    }

    let result;

    switch (action) {
      case 'get':
        result = await pgBridge.getEntityMetadata(entityType, entityId, namespace, keys);
        break;
        
      case 'set':
        if (!key || value === undefined) {
          throw new McpError(ErrorCode.InvalidParams, 'key and value are required for set action');
        }
        await pgBridge.setEntityMetadata(entityType, entityId, namespace, { [key]: value });
        result = { success: true, action: 'set', key, value };
        break;
        
      case 'delete':
        if (!key) {
          throw new McpError(ErrorCode.InvalidParams, 'key is required for delete action');
        }
        await pgBridge.setEntityMetadata(entityType, entityId, namespace, { [key]: null });
        result = { success: true, action: 'delete', key };
        break;
        
      case 'list':
        result = await pgBridge.getEntityMetadata(entityType, entityId, namespace);
        break;
        
      default:
        throw new McpError(ErrorCode.InvalidParams, `Unsupported action: ${action}`);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };

  } catch (error) {
    logger.error('Metadata manager meta-tool error', { error: error.message, params });
    throw new McpError(ErrorCode.InternalError, `Metadata management failed: ${error.message}`);
  }
}

/**
 * Security Audit Meta-Tool
 */
export async function hub__security_audit(params = {}) {
  const {
    timeRange = '24 hours',
    severity = 'all',
    resourceType,
    action
  } = params;

  try {
    const pgBridge = global.mcpHub?.postgresqlBridge;
    
    if (!pgBridge?.initialized) {
      return {
        content: [{
          type: 'text',
          text: '⚠️ Security audit requires PostgreSQL integration.'
        }]
      };
    }

    // Get security audit events (this would be implemented in the enhanced PostgreSQL manager)
    const auditEvents = await pgBridge.enhancedPgManager.query(`
      SELECT event_type, severity, resource_type, resource_id, action, status, description,
             event_time, client_info, security_context
      FROM security_audit_log
      WHERE event_time > NOW() - INTERVAL '${timeRange}'
        ${severity !== 'all' ? `AND severity = $1` : ''}
        ${resourceType ? `AND resource_type = $2` : ''}
        ${action ? `AND action = $3` : ''}
      ORDER BY event_time DESC
      LIMIT 100
    `, [
      ...(severity !== 'all' ? [severity] : []),
      ...(resourceType ? [resourceType] : []),
      ...(action ? [action] : [])
    ]);

    const report = [
      `# 🔐 Security Audit Report (${timeRange})`,
      `**Generated:** ${new Date().toISOString()}`,
      `**Filter:** Severity: ${severity}, Resource: ${resourceType || 'all'}, Action: ${action || 'all'}\n`,
      
      `## Summary`,
      `- **Total Events:** ${auditEvents.rows.length}`,
      `- **High Severity:** ${auditEvents.rows.filter(e => e.severity === 'high').length}`,
      `- **Critical Severity:** ${auditEvents.rows.filter(e => e.severity === 'critical').length}`,
      `- **Success Rate:** ${((auditEvents.rows.filter(e => e.status === 'success').length / auditEvents.rows.length) * 100).toFixed(1)}%\n`,
      
      `## Recent Events`,
      ...auditEvents.rows.slice(0, 20).map(event => 
        `### ${event.event_time} - ${event.severity.toUpperCase()}\n` +
        `- **Type:** ${event.event_type} | **Action:** ${event.action} | **Status:** ${event.status}\n` +
        `- **Resource:** ${event.resource_type}/${event.resource_id}\n` +
        `- **Description:** ${event.description}\n`
      )
    ];

    return {
      content: [{
        type: 'text',
        text: report.join('\n')
      }]
    };

  } catch (error) {
    logger.error('Security audit meta-tool error', { error: error.message, params });
    throw new McpError(ErrorCode.InternalError, `Security audit failed: ${error.message}`);
  }
}

/**
 * Integration Status Meta-Tool
 */
export async function hub__integration_status(params = {}) {
  const { verbose = false } = params;

  try {
    const pgBridge = global.mcpHub?.postgresqlBridge;
    const hubInstance = global.mcpHub;
    
    const status = {
      hub: {
        initialized: !!hubInstance,
        serverCount: Object.keys(hubInstance?.servers || {}).length,
        activeConnections: Object.values(hubInstance?.servers || {}).filter(s => s.connected).length
      },
      postgresql: {
        integrated: !!pgBridge,
        initialized: pgBridge?.initialized || false,
        status: pgBridge?.getIntegrationStatus() || null
      },
      features: {
        enhancedAnalytics: pgBridge?.initialized && pgBridge.options.enableAnalytics,
        realTimeSync: pgBridge?.initialized && pgBridge.options.enableRealTimeSync,
        autoPersistence: pgBridge?.initialized && pgBridge.options.enableAutoPersistence
      }
    };

    const report = [
      `# 🔧 MCP Hub Integration Status`,
      `**Generated:** ${new Date().toISOString()}\n`,
      
      `## Hub Core`,
      `- **Status:** ${status.hub.initialized ? '✅' : '❌'} Initialized`,
      `- **Servers:** ${status.hub.serverCount} total, ${status.hub.activeConnections} connected\n`,
      
      `## PostgreSQL Integration`,
      `- **Integration:** ${status.postgresql.integrated ? '✅' : '❌'} Available`,
      `- **Initialized:** ${status.postgresql.initialized ? '✅' : '❌'}`,
      ...(status.postgresql.status ? [
        `- **Sync Stats:** ${JSON.stringify(status.postgresql.status.syncStats)}`,
        `- **Enhanced Manager:** ${status.postgresql.status.enhancedManagerConnected ? '✅' : '❌'}`
      ] : []),
      '\n',
      
      `## Enhanced Features`,
      `- **Advanced Analytics:** ${status.features.enhancedAnalytics ? '✅' : '❌'}`,
      `- **Real-time Sync:** ${status.features.realTimeSync ? '✅' : '❌'}`,
      `- **Auto Persistence:** ${status.features.autoPersistence ? '✅' : '❌'}`,
      
      ...(verbose && status.postgresql.status ? [
        '\n## Detailed Status',
        '```json',
        JSON.stringify(status, null, 2),
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
    logger.error('Integration status meta-tool error', { error: error.message, params });
    throw new McpError(ErrorCode.InternalError, `Integration status check failed: ${error.message}`);
  }
}

/**
 * Helper function to execute a single chain step
 */
async function executeChainStep(hubInstance, step, executionState) {
  const { server_name, tool_name, arguments: args = {}, input_mapping = {}, conditions = {} } = step;

  // Check conditions
  if (conditions.execute_if) {
    const shouldExecute = evaluateCondition(conditions.execute_if, executionState);
    if (!shouldExecute) {
      return { skipped: true, reason: 'condition not met' };
    }
  }

  // Apply input mapping
  const mappedArgs = applyInputMapping(args, input_mapping, executionState);

  // Execute the tool
  const server = hubInstance.servers[server_name];
  if (!server) {
    throw new Error(`Server ${server_name} not found`);
  }

  const startTime = Date.now();
  try {
    const result = await server.callTool(tool_name, mappedArgs);
    const duration = Date.now() - startTime;
    
    return {
      success: true,
      result,
      duration,
      server: server_name,
      tool: tool_name
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      success: false,
      error: error.message,
      duration,
      server: server_name,
      tool: tool_name
    };
  }
}

/**
 * Helper function to evaluate conditions
 */
function evaluateCondition(condition, executionState) {
  try {
    // Create a safe evaluation context
    const context = {
      ...executionState.variables,
      PREV: Array.from(executionState.stepResults.values()).pop(),
      stepResults: Object.fromEntries(executionState.stepResults)
    };
    
    // Simple condition evaluation (in production, use a safe evaluator)
    const func = new Function(...Object.keys(context), `return ${condition}`);
    return func(...Object.values(context));
  } catch (error) {
    logger.warn('Condition evaluation failed', { condition, error: error.message });
    return false;
  }
}

/**
 * Helper function to apply input mapping
 */
function applyInputMapping(baseArgs, inputMapping, executionState) {
  const mappedArgs = { ...baseArgs };
  
  for (const [targetKey, sourcePath] of Object.entries(inputMapping)) {
    try {
      const value = extractValueFromPath(sourcePath, executionState);
      if (value !== undefined) {
        mappedArgs[targetKey] = value;
      }
    } catch (error) {
      logger.warn('Input mapping failed', { targetKey, sourcePath, error: error.message });
    }
  }
  
  return mappedArgs;
}

/**
 * Helper function to extract value from path
 */
function extractValueFromPath(path, executionState) {
  const context = {
    ...executionState.variables,
    PREV: Array.from(executionState.stepResults.values()).pop(),
    stepResults: Object.fromEntries(executionState.stepResults)
  };
  
  return path.split('.').reduce((obj, key) => obj?.[key], context);
}

// Export all enhanced meta-tools
export const enhancedMetaTools = {
  hub__analytics_advanced,
  hub__chain_tools_enhanced,
  hub__server_health_advanced,
  hub__metadata_manager,
  hub__security_audit,
  hub__integration_status
};

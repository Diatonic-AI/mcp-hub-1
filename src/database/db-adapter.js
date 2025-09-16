/**
 * MCP Hub Database Adapter
 * 
 * This module provides database adapters for the MCP Hub components,
 * enabling them to persist and retrieve data from the PostgreSQL database.
 * 
 * ADAPTERS PROVIDED:
 * - Tool Index Adapter: Integrates the CentralizedToolIndex with PostgreSQL
 * - Toolset Registry Adapter: Adapts the ToolsetRegistry to use the database
 * - Server Manager Adapter: Enables server tracking in the database
 * - Chain Execution Adapter: Tracks tool chain executions in the database
 */

import { Pool } from 'pg';
import logger from '../utils/logger.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Database connection configuration
 */
const defaultConfig = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB || 'postgres',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || '',
  max: 20, // Max connection pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
};

/**
 * Base Database Adapter
 */
export class DatabaseAdapter {
  constructor(config = {}) {
    this.config = { ...defaultConfig, ...config };
    this.pool = null;
    this.connected = false;
  }

  /**
   * Initialize the database connection pool
   */
  async initialize() {
    try {
      this.pool = new Pool(this.config);
      
      // Test connection
      const client = await this.pool.connect();
      try {
        await client.query('SELECT NOW()');
        this.connected = true;
        logger.info('Database connection established successfully');
      } finally {
        client.release();
      }
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize database connection', { error: error.message });
      this.connected = false;
      throw new McpError(ErrorCode.InternalError, `Database connection failed: ${error.message}`);
    }
  }

  /**
   * Execute a query with parameters
   */
  async query(text, params = []) {
    if (!this.pool) {
      throw new McpError(ErrorCode.InternalError, 'Database not initialized');
    }

    try {
      const start = Date.now();
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      // Log slow queries
      if (duration > 200) {
        logger.debug('Slow query detected', { 
          text, 
          duration, 
          rowCount: result.rowCount
        });
      }
      
      return result;
    } catch (error) {
      logger.error('Database query error', { 
        text, 
        error: error.message
      });
      throw new McpError(ErrorCode.InternalError, `Database query error: ${error.message}`);
    }
  }

  /**
   * Execute a transaction
   */
  async transaction(callback) {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Close the database connection pool
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.connected = false;
      logger.info('Database connection closed');
    }
  }
}

/**
 * Tool Index Database Adapter
 * 
 * Adapts the CentralizedToolIndex to use PostgreSQL for storage
 */
export class ToolIndexDatabaseAdapter extends DatabaseAdapter {
  /**
   * Initialize the adapter and tables
   */
  async initialize() {
    await super.initialize();
    await this.ensureTablesExist();
    return true;
  }

  /**
   * Ensure the required tables exist
   */
  async ensureTablesExist() {
    // Tables are created by the comprehensive schema
    // Check if they exist
    try {
      const tablesExist = await this.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'mcp_servers'
        ) AS servers_exist,
        EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'mcp_tools'
        ) AS tools_exist
      `);
      
      if (!tablesExist.rows[0].servers_exist || !tablesExist.rows[0].tools_exist) {
        logger.warn('Required database tables do not exist. Schema initialization may be required.');
      } else {
        logger.info('Required database tables found');
      }
    } catch (error) {
      logger.error('Error checking for database tables', { error: error.message });
    }
  }

  /**
   * Register a server in the database
   */
  async registerServer(serverInfo) {
    const { name, endpoint, tools = [], capabilities = {}, metadata = {} } = serverInfo;
    
    if (!name || !endpoint) {
      throw new McpError(ErrorCode.InvalidParams, 'Server name and endpoint are required');
    }

    try {
      // Check if server already exists
      const existingServer = await this.query('SELECT id FROM mcp_servers WHERE name = $1', [name]);
      let serverId;
      
      if (existingServer.rows.length > 0) {
        serverId = existingServer.rows[0].id;
        
        // Update existing server
        await this.query(`
          UPDATE mcp_servers 
          SET 
            endpoint = $1,
            display_name = $2,
            capabilities = $3,
            metadata = $4,
            status = 'active',
            updated_at = NOW()
          WHERE id = $5
        `, [endpoint, name, JSON.stringify(capabilities), JSON.stringify(metadata), serverId]);
        
        logger.debug(`Updated server ${name} in database`);
      } else {
        // Insert new server
        const result = await this.query(`
          INSERT INTO mcp_servers (
            name, 
            display_name,
            endpoint, 
            capabilities, 
            metadata,
            status,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, 'active', NOW(), NOW())
          RETURNING id
        `, [name, name, endpoint, JSON.stringify(capabilities), JSON.stringify(metadata)]);
        
        serverId = result.rows[0].id;
        logger.debug(`Registered server ${name} in database`);
      }

      // Register server tools
      const registeredToolIds = [];
      for (const tool of tools) {
        const toolId = await this.registerTool(name, tool, serverId);
        registeredToolIds.push(toolId);
      }

      // Update server tool count
      await this.query(`
        UPDATE mcp_servers 
        SET 
          tool_count = $1,
          active_tool_count = $1,
          updated_at = NOW()
        WHERE id = $2
      `, [tools.length, serverId]);

      // Record server connection event
      await this.query(`
        INSERT INTO server_connections (
          connection_id,
          server_id,
          server_name,
          connection_type,
          event_type,
          event_time
        ) VALUES ($1, $2, $3, $4, 'connected', NOW())
      `, [
        `conn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        serverId,
        name,
        serverInfo.transport || 'stdio'
      ]);

      // Return registration result
      return {
        serverName: name,
        serverId,
        toolIds: registeredToolIds,
        registeredAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Failed to register server ${name}`, { error: error.message });
      throw new McpError(ErrorCode.InternalError, `Server registration failed: ${error.message}`);
    }
  }

  /**
   * Register a tool in the database
   */
  async registerTool(serverName, toolInfo, serverId = null) {
    const { name, description, inputSchema, category, metadata = {} } = toolInfo;
    
    if (!name || !serverName) {
      throw new McpError(ErrorCode.InvalidParams, 'Tool name and server name are required');
    }

    // Create unique tool ID
    const toolId = `${serverName}__${name}`;

    try {
      // If serverId not provided, look it up
      let actualServerId = serverId;
      if (!actualServerId) {
        const serverResult = await this.query('SELECT id FROM mcp_servers WHERE name = $1', [serverName]);
        if (serverResult.rows.length === 0) {
          throw new McpError(ErrorCode.NotFound, `Server ${serverName} not found`);
        }
        actualServerId = serverResult.rows[0].id;
      }

      // Check if tool already exists
      const existingTool = await this.query('SELECT id FROM mcp_tools WHERE tool_id = $1', [toolId]);
      
      if (existingTool.rows.length > 0) {
        // Update existing tool
        await this.query(`
          UPDATE mcp_tools 
          SET 
            description = $1,
            input_schema = $2,
            category = $3,
            metadata = $4,
            is_active = true,
            updated_at = NOW()
          WHERE tool_id = $5
        `, [
          description || '',
          JSON.stringify(inputSchema || {}),
          category || 'general',
          JSON.stringify(metadata),
          toolId
        ]);
        
        logger.debug(`Updated tool ${toolId} in database`);
        return toolId;
      } else {
        // Insert new tool
        await this.query(`
          INSERT INTO mcp_tools (
            tool_id,
            name,
            original_name,
            server_id,
            server_name,
            description,
            input_schema,
            category,
            metadata,
            is_active,
            created_at,
            updated_at,
            registered_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, NOW(), NOW(), NOW())
        `, [
          toolId,
          name,
          name,
          actualServerId,
          serverName,
          description || '',
          JSON.stringify(inputSchema || {}),
          category || 'general',
          JSON.stringify(metadata)
        ]);
        
        logger.debug(`Registered tool ${toolId} in database`);
        return toolId;
      }
    } catch (error) {
      logger.error(`Failed to register tool ${toolId}`, { error: error.message });
      throw new McpError(ErrorCode.InternalError, `Tool registration failed: ${error.message}`);
    }
  }

  /**
   * Unregister a server from the database
   */
  async unregisterServer(serverName) {
    try {
      // Get server ID
      const serverResult = await this.query('SELECT id FROM mcp_servers WHERE name = $1', [serverName]);
      if (serverResult.rows.length === 0) {
        return false;
      }
      
      const serverId = serverResult.rows[0].id;
      
      // Record server disconnection event
      await this.query(`
        INSERT INTO server_connections (
          connection_id,
          server_id,
          server_name,
          connection_type,
          event_type,
          event_time
        ) VALUES ($1, $2, $3, 'stdio', 'disconnected', NOW())
      `, [
        `disconn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        serverId,
        serverName
      ]);
      
      // Update server status to inactive
      await this.query(`
        UPDATE mcp_servers 
        SET 
          status = 'inactive',
          last_disconnected_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
      `, [serverId]);
      
      // Mark tools as inactive
      await this.query(`
        UPDATE mcp_tools 
        SET 
          is_active = false,
          updated_at = NOW()
        WHERE server_id = $1
      `, [serverId]);
      
      logger.debug(`Unregistered server ${serverName} from database`);
      return true;
    } catch (error) {
      logger.error(`Failed to unregister server ${serverName}`, { error: error.message });
      throw new McpError(ErrorCode.InternalError, `Server unregistration failed: ${error.message}`);
    }
  }

  /**
   * Unregister a tool from the database
   */
  async unregisterTool(toolId) {
    try {
      // Mark tool as inactive
      await this.query(`
        UPDATE mcp_tools 
        SET 
          is_active = false,
          updated_at = NOW()
        WHERE tool_id = $1
      `, [toolId]);
      
      logger.debug(`Unregistered tool ${toolId} from database`);
      return true;
    } catch (error) {
      logger.error(`Failed to unregister tool ${toolId}`, { error: error.message });
      throw new McpError(ErrorCode.InternalError, `Tool unregistration failed: ${error.message}`);
    }
  }

  /**
   * Record tool usage
   */
  async recordToolUsage(toolId) {
    try {
      // Update tool usage statistics
      await this.query(`
        UPDATE mcp_tools 
        SET 
          usage_count = usage_count + 1,
          last_used_at = NOW(),
          first_used_at = COALESCE(first_used_at, NOW()),
          updated_at = NOW()
        WHERE tool_id = $1
      `, [toolId]);
      
      // Insert tool execution record
      await this.query(`
        INSERT INTO tool_executions (
          execution_id,
          tool_id,
          tool_name,
          server_id,
          server_name,
          status,
          started_at,
          metadata
        ) 
        SELECT 
          $1, 
          t.id, 
          t.name, 
          t.server_id, 
          t.server_name, 
          'pending', 
          NOW(),
          $2
        FROM mcp_tools t
        WHERE t.tool_id = $3
      `, [
        `exec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        JSON.stringify({ source: 'tool_usage_tracking' }),
        toolId
      ]);
      
      logger.debug(`Recorded usage for tool ${toolId}`);
      return true;
    } catch (error) {
      // Non-fatal error - log but don't throw
      logger.warn(`Failed to record tool usage for ${toolId}`, { error: error.message });
      return false;
    }
  }

  /**
   * Update tool execution result
   */
  async updateToolExecution(toolId, result, status = 'completed', errorMessage = null, duration = null) {
    try {
      // Find the most recent pending execution for this tool
      const executionResult = await this.query(`
        SELECT id, execution_id 
        FROM tool_executions 
        WHERE tool_id = (SELECT id FROM mcp_tools WHERE tool_id = $1) 
          AND status = 'pending' 
        ORDER BY started_at DESC 
        LIMIT 1
      `, [toolId]);
      
      if (executionResult.rows.length === 0) {
        logger.warn(`No pending execution found for tool ${toolId}`);
        return false;
      }
      
      const executionId = executionResult.rows[0].id;
      
      // Update execution record
      await this.query(`
        UPDATE tool_executions 
        SET 
          status = $1,
          result = $2,
          error_message = $3,
          completed_at = NOW(),
          duration_ms = $4
        WHERE id = $5
      `, [
        status,
        result ? JSON.stringify(result) : null,
        errorMessage,
        duration || (Date.now() - new Date(executionResult.rows[0].started_at).getTime()),
        executionId
      ]);
      
      // If error occurred, update tool error stats
      if (status === 'failed') {
        await this.query(`
          UPDATE mcp_tools 
          SET 
            error_count = error_count + 1,
            last_error_at = NOW(),
            last_error_message = $1,
            updated_at = NOW()
          WHERE tool_id = $2
        `, [errorMessage, toolId]);
      }
      
      logger.debug(`Updated execution record for tool ${toolId}`);
      return true;
    } catch (error) {
      logger.warn(`Failed to update tool execution for ${toolId}`, { error: error.message });
      return false;
    }
  }

  /**
   * Get all active servers
   */
  async getActiveServers() {
    try {
      const result = await this.query(`
        SELECT 
          id, 
          name, 
          display_name, 
          endpoint, 
          status,
          capabilities,
          metadata,
          tool_count,
          active_tool_count,
          connection_count,
          last_connected_at
        FROM mcp_servers 
        WHERE status NOT IN ('disabled', 'error')
      `);
      
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        displayName: row.display_name,
        endpoint: row.endpoint,
        status: row.status,
        capabilities: row.capabilities,
        metadata: row.metadata,
        toolCount: row.tool_count,
        activeToolCount: row.active_tool_count,
        connectionCount: row.connection_count,
        lastConnected: row.last_connected_at
      }));
    } catch (error) {
      logger.error('Failed to get active servers', { error: error.message });
      throw new McpError(ErrorCode.InternalError, `Server query failed: ${error.message}`);
    }
  }

  /**
   * Get server by name
   */
  async getServer(serverName) {
    try {
      const result = await this.query(`
        SELECT 
          id, 
          name, 
          display_name, 
          endpoint, 
          status,
          capabilities,
          metadata,
          tool_count,
          active_tool_count,
          connection_count,
          last_connected_at,
          last_disconnected_at,
          health_status
        FROM mcp_servers 
        WHERE name = $1
      `, [serverName]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        displayName: row.display_name,
        endpoint: row.endpoint,
        status: row.status,
        capabilities: row.capabilities,
        metadata: row.metadata,
        toolCount: row.tool_count,
        activeToolCount: row.active_tool_count,
        connectionCount: row.connection_count,
        lastConnected: row.last_connected_at,
        lastDisconnected: row.last_disconnected_at,
        healthStatus: row.health_status
      };
    } catch (error) {
      logger.error(`Failed to get server ${serverName}`, { error: error.message });
      throw new McpError(ErrorCode.InternalError, `Server query failed: ${error.message}`);
    }
  }

  /**
   * Get tools for a server
   */
  async getServerTools(serverName) {
    try {
      const result = await this.query(`
        SELECT 
          id,
          tool_id,
          name,
          description,
          input_schema,
          category,
          metadata,
          usage_count,
          last_used_at,
          avg_execution_time_ms,
          is_active
        FROM mcp_tools 
        WHERE server_name = $1
        ORDER BY name
      `, [serverName]);
      
      return result.rows.map(row => ({
        id: row.id,
        toolId: row.tool_id,
        name: row.name,
        description: row.description,
        inputSchema: row.input_schema,
        category: row.category,
        metadata: row.metadata,
        usageCount: row.usage_count,
        lastUsed: row.last_used_at,
        avgExecutionTime: row.avg_execution_time_ms,
        isActive: row.is_active
      }));
    } catch (error) {
      logger.error(`Failed to get tools for server ${serverName}`, { error: error.message });
      throw new McpError(ErrorCode.InternalError, `Tool query failed: ${error.message}`);
    }
  }

  /**
   * Get tool by ID
   */
  async getTool(toolId) {
    try {
      const result = await this.query(`
        SELECT 
          id,
          tool_id,
          name,
          server_name,
          description,
          input_schema,
          category,
          metadata,
          usage_count,
          last_used_at,
          avg_execution_time_ms,
          success_rate,
          is_active
        FROM mcp_tools 
        WHERE tool_id = $1
      `, [toolId]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      return {
        id: row.id,
        toolId: row.tool_id,
        name: row.name,
        serverName: row.server_name,
        description: row.description,
        inputSchema: row.input_schema,
        category: row.category,
        metadata: row.metadata,
        usageCount: row.usage_count,
        lastUsed: row.last_used_at,
        avgExecutionTime: row.avg_execution_time_ms,
        successRate: row.success_rate,
        isActive: row.is_active
      };
    } catch (error) {
      logger.error(`Failed to get tool ${toolId}`, { error: error.message });
      throw new McpError(ErrorCode.InternalError, `Tool query failed: ${error.message}`);
    }
  }

  /**
   * Find tools matching a pattern
   */
  async findTools(pattern, caseSensitive = false) {
    try {
      const queryText = `
        SELECT 
          id,
          tool_id,
          name,
          server_name,
          description,
          category,
          usage_count,
          is_active
        FROM mcp_tools 
        WHERE ${caseSensitive ? 'name' : 'LOWER(name)'} LIKE ${caseSensitive ? '$1' : 'LOWER($1)'}
          AND is_active = true
        ORDER BY usage_count DESC, name
        LIMIT 100
      `;
      
      const result = await this.query(queryText, [`%${pattern}%`]);
      
      return result.rows.map(row => ({
        id: row.id,
        toolId: row.tool_id,
        name: row.name,
        serverName: row.server_name,
        description: row.description,
        category: row.category,
        usageCount: row.usage_count,
        isActive: row.is_active
      }));
    } catch (error) {
      logger.error(`Failed to find tools matching pattern ${pattern}`, { error: error.message });
      throw new McpError(ErrorCode.InternalError, `Tool search failed: ${error.message}`);
    }
  }

  /**
   * Get index statistics
   */
  async getIndexStats() {
    try {
      const result = await this.query(`
        SELECT 
          (SELECT COUNT(*) FROM mcp_servers WHERE status != 'disabled') AS server_count,
          (SELECT COUNT(*) FROM mcp_tools WHERE is_active = true) AS tool_count,
          (SELECT SUM(usage_count) FROM mcp_tools) AS total_usage_count,
          (SELECT MAX(updated_at) FROM mcp_tools) AS last_updated
      `);
      
      const row = result.rows[0];
      return {
        totalServers: parseInt(row.server_count, 10),
        totalTools: parseInt(row.tool_count, 10),
        totalUsage: parseInt(row.total_usage_count, 10) || 0,
        lastUpdated: row.last_updated
      };
    } catch (error) {
      logger.error('Failed to get index statistics', { error: error.message });
      throw new McpError(ErrorCode.InternalError, `Statistics query failed: ${error.message}`);
    }
  }
}

/**
 * Toolset Registry Database Adapter
 * 
 * Adapts the ToolsetRegistry to use PostgreSQL for storage
 */
export class ToolsetRegistryDatabaseAdapter extends DatabaseAdapter {
  /**
   * Initialize the adapter
   */
  async initialize() {
    await super.initialize();
    return true;
  }

  /**
   * Record tool chain execution
   */
  async recordChainExecution(chainConfig, metadata = {}) {
    try {
      const chainId = `chain_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const chainType = this.determineChainType(chainConfig);
      const totalSteps = chainConfig.chain?.length || 0;
      
      // Insert chain execution record
      const result = await this.query(`
        INSERT INTO tool_chain_executions (
          chain_id,
          chain_config,
          chain_type,
          execution_options,
          total_steps,
          status,
          started_at,
          metadata,
          initiated_by,
          client_info
        ) VALUES ($1, $2, $3, $4, $5, 'pending', NOW(), $6, $7, $8)
        RETURNING id
      `, [
        chainId,
        JSON.stringify(chainConfig),
        chainType,
        JSON.stringify(chainConfig.execution_options || {}),
        totalSteps,
        JSON.stringify(metadata),
        metadata.initiatedBy || 'hub',
        JSON.stringify(metadata.clientInfo || {})
      ]);
      
      const chainExecutionId = result.rows[0].id;
      
      // Insert chain steps
      if (chainConfig.chain && Array.isArray(chainConfig.chain)) {
        await Promise.all(chainConfig.chain.map(async (step, index) => {
          const stepId = `step_${chainId}_${index}`;
          
          await this.query(`
            INSERT INTO tool_chain_steps (
              step_id,
              chain_execution_id,
              chain_id,
              step_index,
              step_config,
              parallel_group,
              tool_name,
              server_name,
              original_arguments,
              input_mapping,
              transformations,
              conditions
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          `, [
            stepId,
            chainExecutionId,
            chainId,
            index,
            JSON.stringify(step),
            step.parallel_group || null,
            step.tool_name,
            step.server_name,
            JSON.stringify(step.arguments || {}),
            JSON.stringify(step.input_mapping || {}),
            JSON.stringify(step.transformations || []),
            JSON.stringify(step.conditions || {})
          ]);
        }));
      }
      
      logger.debug(`Recorded chain execution ${chainId}`);
      
      return {
        chainId,
        chainExecutionId,
        totalSteps
      };
    } catch (error) {
      logger.error('Failed to record chain execution', { error: error.message });
      throw new McpError(ErrorCode.InternalError, `Chain execution recording failed: ${error.message}`);
    }
  }

  /**
   * Update chain execution progress
   */
  async updateChainExecutionProgress(chainId, progressInfo) {
    try {
      const {
        status,
        completedSteps,
        currentStep,
        progressPercent,
        errors = [],
        endTime,
        durationMs
      } = progressInfo;
      
      // Update chain execution record
      await this.query(`
        UPDATE tool_chain_executions 
        SET 
          status = $1,
          completed_steps = $2,
          current_step = $3,
          progress_percent = $4,
          failed_steps = $5,
          error_message = $6,
          ${endTime ? 'completed_at = $7,' : ''}
          ${durationMs ? 'duration_ms = $8,' : ''}
          updated_at = NOW()
        WHERE chain_id = $9
      `, [
        status || 'running',
        completedSteps || 0,
        currentStep,
        progressPercent || 0,
        errors.length,
        errors.length > 0 ? errors[0].error : null,
        ...(endTime ? [new Date(endTime)] : []),
        ...(durationMs ? [durationMs] : []),
        chainId
      ]);
      
      // If we have a currentStep, update the step status
      if (currentStep !== undefined) {
        await this.query(`
          UPDATE tool_chain_steps
          SET
            status = 'running',
            started_at = NOW()
          WHERE chain_id = $1 AND step_index = $2
        `, [chainId, currentStep]);
      }
      
      // If we have completedSteps, update all steps up to that point as completed
      if (completedSteps) {
        await this.query(`
          UPDATE tool_chain_steps
          SET
            status = 'completed',
            completed_at = NOW(),
            duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000
          WHERE chain_id = $1 AND step_index < $2 AND status != 'completed'
        `, [chainId, completedSteps]);
      }
      
      // If we have errors, update the affected steps
      if (errors.length > 0) {
        for (const error of errors) {
          if (error.step !== undefined) {
            await this.query(`
              UPDATE tool_chain_steps
              SET
                status = 'failed',
                error_message = $1,
                completed_at = NOW(),
                duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000
              WHERE chain_id = $2 AND step_index = $3
            `, [error.error, chainId, error.step]);
          }
        }
      }
      
      logger.debug(`Updated chain execution progress for ${chainId}`);
      return true;
    } catch (error) {
      logger.error(`Failed to update chain execution progress for ${chainId}`, { error: error.message });
      // Non-fatal error - log but don't throw
      return false;
    }
  }

  /**
   * Update step execution result
   */
  async updateStepExecution(chainId, stepIndex, result, status = 'completed', errorMessage = null) {
    try {
      // Update step record
      await this.query(`
        UPDATE tool_chain_steps 
        SET 
          status = $1,
          result = $2,
          error_message = $3,
          completed_at = NOW(),
          duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000
        WHERE chain_id = $4 AND step_index = $5
      `, [
        status,
        result ? JSON.stringify(result) : null,
        errorMessage,
        chainId,
        stepIndex
      ]);
      
      logger.debug(`Updated step execution for chain ${chainId}, step ${stepIndex}`);
      return true;
    } catch (error) {
      logger.error(`Failed to update step execution for chain ${chainId}, step ${stepIndex}`, { error: error.message });
      // Non-fatal error - log but don't throw
      return false;
    }
  }

  /**
   * Get chain execution details
   */
  async getChainExecution(chainId) {
    try {
      // Get chain execution record
      const chainResult = await this.query(`
        SELECT 
          id,
          chain_id,
          chain_type,
          total_steps,
          completed_steps,
          status,
          progress_percent,
          started_at,
          completed_at,
          duration_ms,
          error_message
        FROM tool_chain_executions 
        WHERE chain_id = $1
      `, [chainId]);
      
      if (chainResult.rows.length === 0) {
        return null;
      }
      
      const chain = chainResult.rows[0];
      
      // Get chain steps
      const stepsResult = await this.query(`
        SELECT 
          id,
          step_id,
          step_index,
          status,
          tool_name,
          server_name,
          result,
          error_message,
          started_at,
          completed_at,
          duration_ms
        FROM tool_chain_steps 
        WHERE chain_id = $1
        ORDER BY step_index
      `, [chainId]);
      
      return {
        id: chain.id,
        chainId: chain.chain_id,
        chainType: chain.chain_type,
        totalSteps: chain.total_steps,
        completedSteps: chain.completed_steps,
        status: chain.status,
        progressPercent: chain.progress_percent,
        startedAt: chain.started_at,
        completedAt: chain.completed_at,
        durationMs: chain.duration_ms,
        errorMessage: chain.error_message,
        steps: stepsResult.rows.map(step => ({
          id: step.id,
          stepId: step.step_id,
          stepIndex: step.step_index,
          status: step.status,
          toolName: step.tool_name,
          serverName: step.server_name,
          result: step.result,
          errorMessage: step.error_message,
          startedAt: step.started_at,
          completedAt: step.completed_at,
          durationMs: step.duration_ms
        }))
      };
    } catch (error) {
      logger.error(`Failed to get chain execution ${chainId}`, { error: error.message });
      throw new McpError(ErrorCode.InternalError, `Chain execution query failed: ${error.message}`);
    }
  }

  /**
   * Helper to determine chain type
   */
  determineChainType(chainConfig) {
    if (!chainConfig.chain || !Array.isArray(chainConfig.chain)) {
      return 'unknown';
    }
    
    const hasParallelGroups = chainConfig.chain.some(step => step.parallel_group);
    const hasConditions = chainConfig.chain.some(step => step.conditions && Object.keys(step.conditions).length > 0);
    
    if (hasParallelGroups && hasConditions) {
      return 'mixed';
    } else if (hasParallelGroups) {
      return 'parallel';
    } else if (hasConditions) {
      return 'conditional';
    } else {
      return 'sequential';
    }
  }
}

/**
 * API Request Tracking Adapter
 * 
 * Tracks API requests in the database
 */
export class ApiRequestDatabaseAdapter extends DatabaseAdapter {
  /**
   * Initialize the adapter
   */
  async initialize() {
    await super.initialize();
    return true;
  }

  /**
   * Record API request
   */
  async recordApiRequest(requestInfo) {
    try {
      const {
        method,
        path,
        query,
        headers,
        body,
        ip,
        userAgent,
        requestId = uuidv4(),
        sessionId,
        userId,
        correlationId
      } = requestInfo;
      
      // Start request tracking
      await this.query(`
        INSERT INTO api_requests (
          request_id,
          method,
          endpoint,
          route,
          query_params,
          headers,
          body,
          client_info,
          user_agent,
          ip_address,
          session_id,
          user_id,
          correlation_id,
          started_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      `, [
        requestId,
        method,
        path,
        path, // Will need more sophisticated routing in a real app
        JSON.stringify(query || {}),
        JSON.stringify(this.sanitizeHeaders(headers || {})),
        body ? JSON.stringify(body) : null,
        JSON.stringify({ userAgent, ip }),
        userAgent,
        ip,
        sessionId,
        userId,
        correlationId
      ]);
      
      return requestId;
    } catch (error) {
      logger.error('Failed to record API request', { error: error.message });
      // Non-fatal error - log but don't throw
      return null;
    }
  }

  /**
   * Update API request with response
   */
  async updateApiRequest(requestId, responseInfo) {
    try {
      const {
        statusCode,
        headers,
        body,
        durationMs,
        error
      } = responseInfo;
      
      // Update request record
      await this.query(`
        UPDATE api_requests 
        SET 
          status_code = $1,
          response_headers = $2,
          response_body = $3,
          duration_ms = $4,
          error_message = $5,
          error_code = $6,
          completed_at = NOW()
        WHERE request_id = $7
      `, [
        statusCode,
        JSON.stringify(this.sanitizeHeaders(headers || {})),
        body ? JSON.stringify(body) : null,
        durationMs,
        error?.message,
        error?.code,
        requestId
      ]);
      
      return true;
    } catch (error) {
      logger.error(`Failed to update API request ${requestId}`, { error: error.message });
      // Non-fatal error - log but don't throw
      return false;
    }
  }

  /**
   * Sanitize headers to remove sensitive information
   */
  sanitizeHeaders(headers) {
    const sanitized = { ...headers };
    
    // Remove sensitive headers
    const sensitiveHeaders = ['authorization', 'cookie', 'set-cookie', 'x-api-key'];
    for (const header of sensitiveHeaders) {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }
}

/**
 * Create a database adapter factory
 */
export function createDatabaseAdapterFactory(config = {}) {
  return {
    createToolIndexAdapter: () => new ToolIndexDatabaseAdapter(config),
    createToolsetRegistryAdapter: () => new ToolsetRegistryDatabaseAdapter(config),
    createApiRequestAdapter: () => new ApiRequestDatabaseAdapter(config)
  };
}

export default createDatabaseAdapterFactory;

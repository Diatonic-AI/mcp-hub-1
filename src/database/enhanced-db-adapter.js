/**
 * Enhanced Database Adapter for MCP Hub
 * 
 * This module provides enhanced database functionality for proper server
 * and tool registration with tracking of changes and registration times.
 */

import logger from '../utils/logger.js';

/**
 * Enhanced Registration Adapter
 * 
 * Properly tracks server and tool registrations with change tracking
 */
export class EnhancedRegistrationAdapter {
  constructor(dbAdapter) {
    this.db = dbAdapter;
  }

  /**
   * Register or update a server with proper tracking
   * 
   * @param {Object} serverInfo - Server information
   * @param {string} serverInfo.name - Server name
   * @param {string} serverInfo.endpoint - Server endpoint URL
   * @param {Array} serverInfo.tools - Array of tool objects
   * @param {Object} serverInfo.metadata - Additional metadata
   * @param {string} serverInfo.transport - Transport type (stdio, sse, http)
   * @param {Object} serverInfo.serverInfo - Server capability information
   * @param {string} hubInstanceId - Hub instance UUID
   */
  async registerServerWithTracking(serverInfo, hubInstanceId) {
    const { 
      name, 
      endpoint, 
      tools = [], 
      metadata = {},
      transport = 'stdio',
      serverInfo: serverCapabilities = {}
    } = serverInfo;

    logger.info(`Registering server ${name} with ${tools.length} tools`);

    try {
      // Use the db query method directly instead of transaction
      // PostgreSQL Manager doesn't have a transaction method
      const client = this.db;
      
      // Check if server already exists
      const existingResult = await client.query(`
          SELECT 
            id, 
            tools_count,
            (SELECT array_agg(namespaced_name) FROM mcp_hub.mcp_tools WHERE server_id = s.id) as existing_tools
          FROM mcp_hub.mcp_servers s
          WHERE name = $1 AND hub_instance_id = $2
        `, [name, hubInstanceId]);

        let serverId;
        let isNewServer = false;
        let existingTools = [];
        let previousToolCount = 0;

        if (existingResult.rows.length > 0) {
          // Server exists - update it
          serverId = existingResult.rows[0].id;
          existingTools = existingResult.rows[0].existing_tools || [];
          previousToolCount = existingResult.rows[0].tools_count || 0;

          await client.query(`
            UPDATE mcp_hub.mcp_servers 
            SET 
              endpoint = $1,
              connection_state = 'CONNECTED',
              transport_type = $2,
              server_info = $3,
              metadata = $4,
              last_connected = NOW(),
              last_registration_at = NOW(),
              tools_count = $5,
              resources_count = $6,
              prompts_count = $7
            WHERE id = $8
          `, [
            endpoint,
            transport.toUpperCase(),
            JSON.stringify(serverCapabilities),
            JSON.stringify(metadata),
            tools.length,
            serverCapabilities.resourceCount || 0,
            serverCapabilities.promptCount || 0,
            serverId
          ]);

          logger.debug(`Updated existing server ${name} (ID: ${serverId})`);
        } else {
          // New server - insert it
          isNewServer = true;
          const insertResult = await client.query(`
            INSERT INTO mcp_hub.mcp_servers (
              hub_instance_id,
              name,
              display_name,
              endpoint,
              transport_type,
              connection_state,
              server_info,
              metadata,
              created_at,
              last_connected,
              last_registration_at,
              tools_count,
              resources_count,
              prompts_count
            ) VALUES ($1, $2, $3, $4, $5, 'CONNECTED', $6, $7, NOW(), NOW(), NOW(), $8, $9, $10)
            RETURNING id
          `, [
            hubInstanceId,
            name,
            metadata.displayName || name,
            endpoint,
            transport.toUpperCase(),
            JSON.stringify(serverCapabilities),
            JSON.stringify(metadata),
            tools.length,
            serverCapabilities.resourceCount || 0,
            serverCapabilities.promptCount || 0
          ]);

          serverId = insertResult.rows[0].id;
          logger.info(`Created new server ${name} (ID: ${serverId})`);
        }

        // Process tools - track added, updated, and removed
        const currentToolNames = tools.map(t => `${name}__${t.name}`);
        const addedTools = [];
        const updatedTools = [];
        const removedTools = existingTools.filter(t => !currentToolNames.includes(t));

        // Register or update each tool
        for (const tool of tools) {
          const namespacedName = `${name}__${tool.name}`;
          const isExistingTool = existingTools.includes(namespacedName);

          // Check if tool exists
          const toolResult = await client.query(`
            SELECT id FROM mcp_hub.mcp_tools 
            WHERE server_id = $1 AND namespaced_name = $2
          `, [serverId, namespacedName]);

          if (toolResult.rows.length > 0) {
            // Update existing tool
            await client.query(`
              UPDATE mcp_hub.mcp_tools 
              SET 
                description = $1,
                input_schema = $2,
                category = $3,
                metadata = $4,
                last_registration_at = NOW()
              WHERE id = $5
            `, [
              tool.description || '',
              JSON.stringify(tool.inputSchema || {}),
              tool.category || 'general',
              JSON.stringify(tool.metadata || {}),
              toolResult.rows[0].id
            ]);
            
            updatedTools.push(namespacedName);
            logger.debug(`Updated tool ${namespacedName}`);
          } else {
            // Insert new tool
            await client.query(`
              INSERT INTO mcp_hub.mcp_tools (
                server_id,
                name,
                original_name,
                namespaced_name,
                description,
                input_schema,
                category,
                metadata,
                registered_at,
                last_registration_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
            `, [
              serverId,
              tool.name,
              tool.name,
              namespacedName,
              tool.description || '',
              JSON.stringify(tool.inputSchema || {}),
              tool.category || 'general',
              JSON.stringify(tool.metadata || {})
            ]);
            
            addedTools.push(namespacedName);
            logger.debug(`Added new tool ${namespacedName}`);
          }
        }

        // Mark removed tools as inactive (soft delete)
        if (removedTools.length > 0) {
          await client.query(`
            UPDATE mcp_hub.mcp_tools 
            SET 
              last_registration_at = NOW(),
              metadata = jsonb_set(
                COALESCE(metadata, '{}'::jsonb), 
                '{inactive}', 
                'true'::jsonb
              )
            WHERE server_id = $1 AND namespaced_name = ANY($2)
          `, [serverId, removedTools]);
          
          logger.info(`Marked ${removedTools.length} tools as inactive for server ${name}`);
        }

        // Update server statistics
        await client.query(`
          UPDATE mcp_hub.mcp_servers 
          SET 
            tools_added = tools_added + $1,
            tools_updated = tools_updated + $2,
            tools_removed = tools_removed + $3
          WHERE id = $4
        `, [
          addedTools.length,
          updatedTools.length, 
          removedTools.length,
          serverId
        ]);

        // Log the registration summary
        const summary = {
          serverName: name,
          serverId,
          isNewServer,
          previousToolCount,
          currentToolCount: tools.length,
          toolsAdded: addedTools.length,
          toolsUpdated: updatedTools.length,
          toolsRemoved: removedTools.length,
          registeredAt: new Date().toISOString()
        };

        logger.info(`Server registration complete for ${name}`, summary);
        
        return summary;
    } catch (error) {
      logger.error(`Failed to register server ${name}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Unregister a server (mark as disconnected)
   */
  async unregisterServerWithTracking(serverName, hubInstanceId) {
    try {
      const result = await this.db.query(`
        UPDATE mcp_hub.mcp_servers 
        SET 
          connection_state = 'DISCONNECTED',
          last_disconnected = NOW()
        WHERE name = $1 AND hub_instance_id = $2
        RETURNING id, tools_count
      `, [serverName, hubInstanceId]);

      if (result.rows.length > 0) {
        logger.info(`Unregistered server ${serverName} with ${result.rows[0].tools_count} tools`);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error(`Failed to unregister server ${serverName}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Get registration statistics
   */
  async getRegistrationStats(hubInstanceId) {
    try {
      const result = await this.db.query(`
        SELECT 
          COUNT(*) as total_servers,
          COUNT(CASE WHEN connection_state = 'CONNECTED' THEN 1 END) as connected_servers,
          SUM(tools_count) as total_tools,
          SUM(tools_added) as total_tools_added,
          SUM(tools_updated) as total_tools_updated,
          SUM(tools_removed) as total_tools_removed
        FROM mcp_hub.mcp_servers
        WHERE hub_instance_id = $1
      `, [hubInstanceId]);

      return result.rows[0];
    } catch (error) {
      logger.error('Failed to get registration stats', { error: error.message });
      throw error;
    }
  }
}

export default EnhancedRegistrationAdapter;

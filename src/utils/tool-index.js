/**
 * CentralizedToolIndex - Tool Registration and Discovery System
 * 
 * This module provides a centralized index for all tools across MCP servers.
 * It separates tool discovery from tool execution, allowing external tools
 * to register themselves via API endpoints.
 * 
 * FEATURES:
 * - Tool registration via API
 * - Fast tool discovery and search
 * - Server capability tracking
 * - Real-time updates and notifications
 * - Tool metadata and routing information
 */

import EventEmitter from 'events';
import logger from './logger.js';

/**
 * Centralized tool index manager
 */
export class CentralizedToolIndex extends EventEmitter {
  constructor() {
    super();
    
    // Main index structure
    this.index = {
      // Tools indexed by unique ID
      tools: new Map(), // toolId -> ToolEntry
      
      // Secondary indexes for fast lookup
      byServer: new Map(), // serverName -> Set<toolId>
      byName: new Map(), // toolName -> Set<toolId> (handles name conflicts)
      byCategory: new Map(), // category -> Set<toolId>
      
      // Metadata
      lastUpdated: null,
      version: 1
    };
    
    // Server registry
    this.servers = new Map(); // serverName -> ServerEntry
    
    // Index statistics
    this.stats = {
      totalTools: 0,
      totalServers: 0,
      lastRegistration: null,
      lastQuery: null
    };
  }

  /**
   * Register a server with its tools
   */
  async registerServer(serverInfo) {
    const { name, endpoint, tools = [], capabilities = {}, metadata = {} } = serverInfo;
    
    if (!name || !endpoint) {
      throw new Error('Server name and endpoint are required');
    }

    // Create server entry
    const serverEntry = {
      name,
      endpoint,
      capabilities,
      metadata,
      registeredAt: new Date().toISOString(),
      lastUpdate: new Date().toISOString(),
      toolCount: tools.length,
      status: 'active'
    };

    // Remove existing tools for this server if re-registering
    if (this.servers.has(name)) {
      await this.unregisterServer(name);
    }

    // Register server
    this.servers.set(name, serverEntry);
    this.index.byServer.set(name, new Set());

    // Register all tools from this server
    const registeredToolIds = [];
    for (const tool of tools) {
      try {
        const toolId = await this.registerTool(name, tool);
        registeredToolIds.push(toolId);
      } catch (error) {
        logger.warn(`Failed to register tool '${tool.name}' from server '${name}': ${error.message}`);
      }
    }

    // Update statistics
    this.stats.totalServers = this.servers.size;
    this.stats.lastRegistration = new Date().toISOString();
    this.index.lastUpdated = new Date().toISOString();

    logger.info(`Server '${name}' registered with ${registeredToolIds.length} tools`, {
      serverName: name,
      endpoint,
      toolCount: registeredToolIds.length
    });

    // Emit registration event
    this.emit('serverRegistered', {
      serverName: name,
      toolIds: registeredToolIds,
      serverInfo: serverEntry
    });

    return {
      serverName: name,
      toolIds: registeredToolIds,
      registeredAt: serverEntry.registeredAt
    };
  }

  /**
   * Register a single tool
   */
  async registerTool(serverName, toolInfo) {
    const { name, description, inputSchema, category, metadata = {} } = toolInfo;
    
    if (!name || !serverName) {
      throw new Error('Tool name and server name are required');
    }

    // Create unique tool ID
    const toolId = `${serverName}__${name}`;
    
    // Create tool entry
    const toolEntry = {
      id: toolId,
      name,
      originalName: name,
      serverName,
      description: description || '',
      inputSchema: inputSchema || {},
      category: category || 'general',
      metadata,
      endpoint: this.servers.get(serverName)?.endpoint,
      registeredAt: new Date().toISOString(),
      lastUsed: null,
      usageCount: 0
    };

    // Add to main index
    this.index.tools.set(toolId, toolEntry);

    // Update secondary indexes
    this.index.byServer.get(serverName).add(toolId);
    
    if (!this.index.byName.has(name)) {
      this.index.byName.set(name, new Set());
    }
    this.index.byName.get(name).add(toolId);
    
    if (!this.index.byCategory.has(toolEntry.category)) {
      this.index.byCategory.set(toolEntry.category, new Set());
    }
    this.index.byCategory.get(toolEntry.category).add(toolId);

    // Update statistics
    this.stats.totalTools = this.index.tools.size;
    this.index.lastUpdated = new Date().toISOString();

    return toolId;
  }

  /**
   * Unregister a server and all its tools
   */
  async unregisterServer(serverName) {
    if (!this.servers.has(serverName)) {
      return false;
    }

    // Get all tool IDs for this server
    const toolIds = Array.from(this.index.byServer.get(serverName) || []);

    // Remove all tools
    for (const toolId of toolIds) {
      this.unregisterTool(toolId);
    }

    // Remove server
    this.servers.delete(serverName);
    this.index.byServer.delete(serverName);

    // Update statistics
    this.stats.totalServers = this.servers.size;
    this.index.lastUpdated = new Date().toISOString();

    logger.info(`Server '${serverName}' unregistered with ${toolIds.length} tools`);

    // Emit unregistration event
    this.emit('serverUnregistered', {
      serverName,
      toolIds
    });

    return true;
  }

  /**
   * Unregister a single tool
   */
  unregisterTool(toolId) {
    const toolEntry = this.index.tools.get(toolId);
    if (!toolEntry) {
      return false;
    }

    // Remove from main index
    this.index.tools.delete(toolId);

    // Remove from secondary indexes
    this.index.byServer.get(toolEntry.serverName)?.delete(toolId);
    this.index.byName.get(toolEntry.originalName)?.delete(toolId);
    this.index.byCategory.get(toolEntry.category)?.delete(toolId);

    // Clean up empty sets
    if (this.index.byName.get(toolEntry.originalName)?.size === 0) {
      this.index.byName.delete(toolEntry.originalName);
    }
    if (this.index.byCategory.get(toolEntry.category)?.size === 0) {
      this.index.byCategory.delete(toolEntry.category);
    }

    // Update statistics
    this.stats.totalTools = this.index.tools.size;
    this.index.lastUpdated = new Date().toISOString();

    return true;
  }

  /**
   * List all tools with optional filtering
   */
  listTools(options = {}) {
    const {
      serverName,
      category,
      namePattern,
      includeMetadata = true,
      format = 'detailed'
    } = options;

    this.stats.lastQuery = new Date().toISOString();

    let toolIds = new Set(this.index.tools.keys());

    // Apply filters
    if (serverName) {
      toolIds = new Set(Array.from(toolIds).filter(id => 
        this.index.byServer.get(serverName)?.has(id)
      ));
    }

    if (category) {
      toolIds = new Set(Array.from(toolIds).filter(id => 
        this.index.byCategory.get(category)?.has(id)
      ));
    }

    if (namePattern) {
      const regex = new RegExp(namePattern, 'i');
      toolIds = new Set(Array.from(toolIds).filter(id => {
        const tool = this.index.tools.get(id);
        return regex.test(tool.name) || regex.test(tool.description);
      }));
    }

    // Convert to array and format
    const tools = Array.from(toolIds).map(id => {
      const tool = this.index.tools.get(id);
      
      if (format === 'simple') {
        return {
          id: tool.id,
          name: tool.name,
          serverName: tool.serverName,
          description: tool.description
        };
      }
      
      return includeMetadata ? tool : {
        id: tool.id,
        name: tool.name,
        originalName: tool.originalName,
        serverName: tool.serverName,
        description: tool.description,
        inputSchema: tool.inputSchema,
        category: tool.category,
        endpoint: tool.endpoint
      };
    });

    return {
      tools,
      count: tools.length,
      totalInIndex: this.stats.totalTools,
      query: options,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Find tools by pattern
   */
  findTools(pattern, options = {}) {
    const {
      searchIn = 'all', // 'name', 'description', 'all'
      caseSensitive = false,
      exactMatch = false,
      limit = 50
    } = options;

    const regex = new RegExp(
      exactMatch ? `^${pattern}$` : pattern,
      caseSensitive ? '' : 'i'
    );

    const results = [];
    
    for (const [toolId, tool] of this.index.tools) {
      let matches = false;
      
      if (searchIn === 'name' || searchIn === 'all') {
        matches = matches || regex.test(tool.name) || regex.test(tool.originalName);
      }
      
      if (searchIn === 'description' || searchIn === 'all') {
        matches = matches || regex.test(tool.description);
      }
      
      if (matches) {
        results.push(tool);
        if (results.length >= limit) break;
      }
    }

    this.stats.lastQuery = new Date().toISOString();

    return {
      results,
      count: results.length,
      pattern,
      options,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get tool by ID
   */
  getTool(toolId) {
    this.stats.lastQuery = new Date().toISOString();
    return this.index.tools.get(toolId) || null;
  }

  /**
   * Get server information
   */
  getServer(serverName) {
    return this.servers.get(serverName) || null;
  }

  /**
   * List all servers
   */
  listServers(options = {}) {
    const { includeTools = false } = options;
    
    const servers = Array.from(this.servers.values()).map(server => {
      const result = { ...server };
      
      if (includeTools) {
        const toolIds = Array.from(this.index.byServer.get(server.name) || []);
        result.tools = toolIds.map(id => this.index.tools.get(id));
      }
      
      return result;
    });

    return {
      servers,
      count: servers.length,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Update tool usage statistics
   */
  recordToolUsage(toolId) {
    const tool = this.index.tools.get(toolId);
    if (tool) {
      tool.lastUsed = new Date().toISOString();
      tool.usageCount = (tool.usageCount || 0) + 1;
      
      // Emit usage event
      this.emit('toolUsed', {
        toolId,
        toolName: tool.name,
        serverName: tool.serverName,
        usageCount: tool.usageCount
      });
    }
  }

  /**
   * Get index statistics
   */
  getStats() {
    const categories = Array.from(this.index.byCategory.keys());
    const servers = Array.from(this.servers.keys());
    
    return {
      ...this.stats,
      categories,
      servers,
      indexVersion: this.index.version,
      lastUpdated: this.index.lastUpdated
    };
  }

  /**
   * Get the routing information for a tool
   */
  getToolRouting(toolId) {
    const tool = this.index.tools.get(toolId);
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`);
    }

    const server = this.servers.get(tool.serverName);
    if (!server) {
      throw new Error(`Server not found for tool: ${tool.serverName}`);
    }

    return {
      toolId: tool.id,
      originalName: tool.originalName,
      serverName: tool.serverName,
      endpoint: server.endpoint,
      inputSchema: tool.inputSchema
    };
  }

  /**
   * Clear the entire index
   */
  clear() {
    this.index.tools.clear();
    this.index.byServer.clear();
    this.index.byName.clear();
    this.index.byCategory.clear();
    this.servers.clear();
    
    this.stats.totalTools = 0;
    this.stats.totalServers = 0;
    this.stats.lastRegistration = null;
    this.stats.lastQuery = null;
    
    this.index.lastUpdated = new Date().toISOString();
    this.index.version += 1;

    this.emit('indexCleared');
  }
}

// Export singleton instance
export const toolIndex = new CentralizedToolIndex();

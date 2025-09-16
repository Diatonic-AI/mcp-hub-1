/**
 * MCP Hub Telemetry Database Integration
 * Provides PostgreSQL-backed telemetry and metrics collection for MCP Hub
 */

const { Pool } = require('pg');
const { EventEmitter } = require('events');

class MCPHubTelemetry extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      host: options.host || 'localhost',
      port: options.port || 5432,
      database: options.database || 'mcp_hub',
      user: options.user || 'mcp_hub_app',
      password: options.password || process.env.MCP_HUB_DB_PASSWORD || 'mcp_hub_secure_password',
      schema: options.schema || 'mcp_hub',
      tenant: options.tenant || 'daclab-ai',
      max: options.maxConnections || 20,
      idleTimeoutMillis: options.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: options.connectionTimeoutMillis || 10000,
      ...options
    };
    
    this.pool = null;
    this.isConnected = false;
    this.hubInstanceId = null;
    this.tenantId = null;
    
    // Cache for frequently accessed data
    this.cache = {
      servers: new Map(),
      tools: new Map(),
      lastCacheUpdate: null,
      cacheExpiryMs: 300000 // 5 minutes
    };
    
    this.metrics = {
      totalQueries: 0,
      failedQueries: 0,
      avgQueryTime: 0,
      lastError: null
    };
  }
  
  /**
   * Initialize database connection and set up hub instance
   */
  async initialize(hubInstance = {}) {
    try {
      // Create connection pool
      this.pool = new Pool(this.config);
      
      // Configure pool connection event to set search path
      this.pool.on('connect', async (client) => {
        try {
          await client.query(`SET search_path TO ${this.config.schema}, public`);
        } catch (error) {
          console.error('Failed to set search path on connection:', error.message);
        }
      });
      
      // Test connection and set search path
      const client = await this.pool.connect();
      await client.query(`SET search_path TO ${this.config.schema}, public`);
      client.release();
      
      this.isConnected = true;
      
      // Find or create tenant
      this.tenantId = await this.ensureTenant();
      
      // Register hub instance
      this.hubInstanceId = await this.registerHubInstance(hubInstance);
      
      this.emit('connected', { tenantId: this.tenantId, hubInstanceId: this.hubInstanceId });
      
      return {
        success: true,
        tenantId: this.tenantId,
        hubInstanceId: this.hubInstanceId
      };
      
    } catch (error) {
      this.metrics.lastError = error;
      this.emit('error', error);
      throw new Error(`Failed to initialize telemetry database: ${error.message}`);
    }
  }
  
  /**
   * Ensure tenant exists, create if not found
   */
  async ensureTenant() {
    const query = `
      INSERT INTO tenants (name, description) 
      VALUES ($1, $2)
      ON CONFLICT (name) 
      DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `;
    
    const result = await this.executeQuery(query, [
      this.config.tenant,
      `MCP Hub tenant for ${this.config.tenant}`
    ]);
    
    return result.rows[0].id;
  }
  
  /**
   * Register or update hub instance
   */
  async registerHubInstance(hubData) {
    const query = `
      INSERT INTO hub_instances (
        tenant_id, instance_name, host, port, pid, version,
        config_path, hub_server_url, state, hub_options
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (tenant_id, host, port)
      DO UPDATE SET
        instance_name = EXCLUDED.instance_name,
        pid = EXCLUDED.pid,
        version = EXCLUDED.version,
        config_path = EXCLUDED.config_path,
        hub_server_url = EXCLUDED.hub_server_url,
        state = EXCLUDED.state,
        hub_options = EXCLUDED.hub_options,
        last_state_change = CURRENT_TIMESTAMP
      RETURNING id
    `;
    
    const values = [
      this.tenantId,
      hubData.instanceName || 'mcp-hub-main',
      hubData.host || 'localhost',
      hubData.port || 37373,
      hubData.pid || process.pid,
      hubData.version || '4.2.1',
      hubData.configPath || null,
      hubData.hubServerUrl || `http://localhost:${hubData.port || 37373}`,
      hubData.state || 'READY',
      JSON.stringify(hubData.options || {})
    ];
    
    const result = await this.executeQuery(query, values);
    return result.rows[0].id;
  }
  
  /**
   * Register or update MCP server
   */
  async registerServer(serverData) {
    const query = `
      INSERT INTO mcp_servers (
        hub_instance_id, name, display_name, description, transport_type,
        connection_state, endpoint, config, resolved_config, server_info, disabled
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (hub_instance_id, name)
      DO UPDATE SET
        display_name = EXCLUDED.display_name,
        description = EXCLUDED.description,
        transport_type = EXCLUDED.transport_type,
        connection_state = EXCLUDED.connection_state,
        endpoint = EXCLUDED.endpoint,
        config = EXCLUDED.config,
        resolved_config = EXCLUDED.resolved_config,
        server_info = EXCLUDED.server_info,
        disabled = EXCLUDED.disabled,
        last_connected = CASE 
          WHEN EXCLUDED.connection_state = 'CONNECTED' THEN CURRENT_TIMESTAMP
          ELSE mcp_servers.last_connected
        END
      RETURNING id
    `;
    
    const values = [
      this.hubInstanceId,
      serverData.name,
      serverData.displayName || serverData.name,
      serverData.description || '',
      serverData.transport?.type || 'stdio',
      serverData.connectionState || 'DISCONNECTED',
      serverData.endpoint || null,
      JSON.stringify(serverData.config || {}),
      JSON.stringify(serverData.resolvedConfig || {}),
      JSON.stringify(serverData.serverInfo || {}),
      serverData.disabled || false
    ];
    
    const result = await this.executeQuery(query, values);
    const serverId = result.rows[0].id;
    
    // Cache server information
    this.cache.servers.set(serverData.name, { id: serverId, ...serverData });
    
    return serverId;
  }
  
  /**
   * Register tools from a server
   */
  async registerTools(serverName, tools) {
    if (!tools || tools.length === 0) return [];
    
    const serverId = await this.getServerId(serverName);
    if (!serverId) throw new Error(`Server not found: ${serverName}`);
    
    const registeredTools = [];
    
    for (const tool of tools) {
      const query = `
        INSERT INTO mcp_tools (
          server_id, name, original_name, namespaced_name, description,
          input_schema, output_schema, category
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (server_id, original_name)
        DO UPDATE SET
          name = EXCLUDED.name,
          namespaced_name = EXCLUDED.namespaced_name,
          description = EXCLUDED.description,
          input_schema = EXCLUDED.input_schema,
          output_schema = EXCLUDED.output_schema,
          category = EXCLUDED.category
        RETURNING id
      `;
      
      const values = [
        serverId,
        tool.name,
        tool.name,
        `${serverName}__${tool.name}`,
        tool.description || '',
        JSON.stringify(tool.inputSchema || {}),
        JSON.stringify(tool.outputSchema || {}),
        this.categorizeToolByName(tool.name)
      ];
      
      const result = await this.executeQuery(query, values);
      const toolId = result.rows[0].id;
      
      registeredTools.push(toolId);
      
      // Cache tool information
      this.cache.tools.set(`${serverName}__${tool.name}`, { 
        id: toolId, 
        serverId,
        ...tool 
      });
    }
    
    return registeredTools;
  }
  
  /**
   * Log tool execution
   */
  async logToolExecution(executionData) {
    const toolId = await this.getToolId(executionData.toolName, executionData.serverName);
    const serverId = await this.getServerId(executionData.serverName);
    
    if (!toolId || !serverId) {
      throw new Error(`Tool or server not found: ${executionData.toolName} on ${executionData.serverName}`);
    }
    
    const query = `
      INSERT INTO tool_executions (
        tool_id, server_id, hub_instance_id, execution_id, session_id,
        correlation_id, parent_execution_id, tool_name, arguments, status,
        started_at, completed_at, execution_time_ms, result, error_message,
        error_code, error_details, memory_usage_mb, cpu_time_ms, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING id
    `;
    
    const values = [
      toolId,
      serverId,
      this.hubInstanceId,
      executionData.executionId || null,
      executionData.sessionId || null,
      executionData.correlationId || null,
      executionData.parentExecutionId || null,
      executionData.toolName,
      JSON.stringify(executionData.arguments || {}),
      executionData.status || 'started',
      executionData.startedAt || new Date(),
      executionData.completedAt || null,
      executionData.executionTimeMs || null,
      JSON.stringify(executionData.result || null),
      executionData.error || null,
      executionData.errorCode || null,
      JSON.stringify(executionData.errorDetails || {}),
      executionData.memoryUsageMb || null,
      executionData.cpuTimeMs || null,
      JSON.stringify(executionData.metadata || {})
    ];
    
    const result = await this.executeQuery(query, values);
    return result.rows[0].id;
  }
  
  /**
   * Log SSE events
   */
  async logSSEEvent(eventData) {
    const query = `
      INSERT INTO sse_events (
        hub_instance_id, event_type, event_data, connection_id, client_count, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;
    
    const values = [
      this.hubInstanceId,
      eventData.type || 'subscription_event',
      JSON.stringify(eventData.data || {}),
      eventData.connectionId || null,
      eventData.clientCount || 0,
      JSON.stringify(eventData.metadata || {})
    ];
    
    const result = await this.executeQuery(query, values);
    return result.rows[0].id;
  }
  
  /**
   * Log structured log entries
   */
  async logEntry(logData) {
    const query = `
      INSERT INTO log_entries (
        hub_instance_id, server_id, level, message, code, data, stack_trace,
        source, component, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `;
    
    const serverId = logData.serverName ? await this.getServerId(logData.serverName) : null;
    
    const values = [
      this.hubInstanceId,
      serverId,
      logData.level,
      logData.message,
      logData.code || null,
      JSON.stringify(logData.data || {}),
      logData.stack || null,
      logData.source || 'hub',
      logData.component || null,
      JSON.stringify(logData.metadata || {})
    ];
    
    const result = await this.executeQuery(query, values);
    return result.rows[0].id;
  }
  
  /**
   * Log API request
   */
  async logAPIRequest(requestData) {
    // Graceful fallback if not connected
    if (!this.isConnected || !this.hubInstanceId) {
      console.debug('Telemetry not ready, skipping API request log');
      return null;
    }
    
    try {
      const query = `
        INSERT INTO api_requests (
          hub_instance_id, method, path, full_url, query_params, headers, body,
          status_code, response_headers, response_body, response_size_bytes,
          started_at, completed_at, duration_ms, client_ip, user_agent,
          session_id, error_message, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        RETURNING id
      `;
      
      const values = [
        this.hubInstanceId,
        requestData.method,
        requestData.path,
        requestData.fullUrl || null,
        JSON.stringify(requestData.queryParams || {}),
        JSON.stringify(requestData.headers || {}),
        typeof requestData.body === 'string' ? requestData.body : JSON.stringify(requestData.body || null),
        requestData.statusCode || null,
        JSON.stringify(requestData.responseHeaders || {}),
        JSON.stringify(requestData.responseBody || null),
        requestData.responseSizeBytes || null,
        requestData.startedAt || new Date(),
        requestData.completedAt || null,
        requestData.durationMs || null,
        requestData.clientIp || null,
        requestData.userAgent || null,
        requestData.sessionId || null,
        requestData.error || null,
        JSON.stringify(requestData.metadata || {})
      ];
      
      const result = await this.executeQuery(query, values);
      return result.rows[0].id;
    } catch (error) {
      // Don't let telemetry errors break the application
      console.debug('Failed to log API request (non-critical):', error.message);
      return null;
    }
  }
  
  /**
   * Update hub state
   */
  async updateHubState(newState, metadata = {}) {
    const query = `
      UPDATE hub_instances 
      SET state = $1, last_state_change = CURRENT_TIMESTAMP, metadata = $2
      WHERE id = $3
      RETURNING state, last_state_change
    `;
    
    const result = await this.executeQuery(query, [
      newState,
      JSON.stringify(metadata),
      this.hubInstanceId
    ]);
    
    return result.rows[0];
  }
  
  /**
   * Update server connection state
   */
  async updateServerConnectionState(serverName, newState, errorMessage = null) {
    const query = `
      UPDATE mcp_servers 
      SET 
        connection_state = $1, 
        error_message = $2,
        last_connected = CASE 
          WHEN $1 = 'CONNECTED' THEN CURRENT_TIMESTAMP
          ELSE last_connected
        END,
        last_disconnected = CASE 
          WHEN $1 = 'DISCONNECTED' THEN CURRENT_TIMESTAMP
          ELSE last_disconnected
        END,
        connection_attempts = CASE 
          WHEN $1 = 'CONNECTING' THEN connection_attempts + 1
          ELSE connection_attempts
        END
      WHERE hub_instance_id = $3 AND name = $4
      RETURNING id, connection_state, last_connected, last_disconnected
    `;
    
    const result = await this.executeQuery(query, [
      newState,
      errorMessage,
      this.hubInstanceId,
      serverName
    ]);
    
    return result.rows[0] || null;
  }
  
  /**
   * Get comprehensive server status
   */
  async getServerStatus(serverName = null) {
    let query = `
      SELECT * FROM server_status_view
      WHERE tenant_name = $1
    `;
    const params = [this.config.tenant];
    
    if (serverName) {
      query += ` AND name = $2`;
      params.push(serverName);
    }
    
    query += ` ORDER BY last_connected DESC`;
    
    const result = await this.executeQuery(query, params);
    return result.rows;
  }
  
  /**
   * Get tool performance metrics
   */
  async getToolPerformance(limit = 50) {
    const query = `
      SELECT * FROM tool_performance_view
      ORDER BY usage_count DESC, avg_execution_time_ms ASC
      LIMIT $1
    `;
    
    const result = await this.executeQuery(query, [limit]);
    return result.rows;
  }
  
  /**
   * Get hub health metrics
   */
  async getHubHealth() {
    const query = `
      SELECT * FROM hub_health_view
      WHERE tenant_name = $1
      ORDER BY started_at DESC
    `;
    
    const result = await this.executeQuery(query, [this.config.tenant]);
    return result.rows[0] || null;
  }
  
  /**
   * Get recent tool executions
   */
  async getRecentExecutions(limit = 100, serverName = null) {
    let query = `
      SELECT 
        te.*,
        t.namespaced_name,
        s.name as server_name
      FROM tool_executions te
      JOIN mcp_tools t ON te.tool_id = t.id
      JOIN mcp_servers s ON te.server_id = s.id
      WHERE s.hub_instance_id = $1
    `;
    const params = [this.hubInstanceId];
    
    if (serverName) {
      query += ` AND s.name = $${params.length + 1}`;
      params.push(serverName);
    }
    
    query += ` ORDER BY te.started_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    
    const result = await this.executeQuery(query, params);
    return result.rows;
  }
  
  /**
   * Get error statistics
   */
  async getErrorStats(timeframe = '24 hours') {
    const query = `
      SELECT 
        s.name as server_name,
        COUNT(*) as total_errors,
        COUNT(DISTINCT te.tool_id) as tools_with_errors,
        AVG(te.execution_time_ms) as avg_failed_execution_time,
        array_agg(DISTINCT te.error_code) FILTER (WHERE te.error_code IS NOT NULL) as error_codes
      FROM tool_executions te
      JOIN mcp_servers s ON te.server_id = s.id
      WHERE s.hub_instance_id = $1 
        AND te.error_message IS NOT NULL
        AND te.started_at > CURRENT_TIMESTAMP - INTERVAL $2
      GROUP BY s.id, s.name
      ORDER BY total_errors DESC
    `;
    
    const result = await this.executeQuery(query, [this.hubInstanceId, timeframe]);
    return result.rows;
  }
  
  // Helper methods
  async getServerId(serverName) {
    if (this.cache.servers.has(serverName)) {
      return this.cache.servers.get(serverName).id;
    }
    
    const query = `
      SELECT id FROM mcp_servers 
      WHERE hub_instance_id = $1 AND name = $2
    `;
    
    const result = await this.executeQuery(query, [this.hubInstanceId, serverName]);
    
    if (result.rows.length > 0) {
      const serverId = result.rows[0].id;
      this.cache.servers.set(serverName, { id: serverId });
      return serverId;
    }
    
    return null;
  }
  
  async getToolId(toolName, serverName) {
    const namespacedName = `${serverName}__${toolName}`;
    
    if (this.cache.tools.has(namespacedName)) {
      return this.cache.tools.get(namespacedName).id;
    }
    
    const query = `
      SELECT t.id FROM mcp_tools t
      JOIN mcp_servers s ON t.server_id = s.id
      WHERE s.hub_instance_id = $1 AND s.name = $2 AND t.original_name = $3
    `;
    
    const result = await this.executeQuery(query, [this.hubInstanceId, serverName, toolName]);
    
    if (result.rows.length > 0) {
      const toolId = result.rows[0].id;
      this.cache.tools.set(namespacedName, { id: toolId });
      return toolId;
    }
    
    return null;
  }
  
  categorizeToolByName(toolName) {
    const categories = {
      filesystem: ['read', 'write', 'file', 'directory', 'move', 'copy', 'delete'],
      memory: ['memory', 'cache', 'remember', 'forget', 'search'],
      git: ['git', 'commit', 'branch', 'merge', 'push', 'pull'],
      database: ['query', 'insert', 'update', 'delete', 'schema', 'table'],
      api: ['get', 'post', 'put', 'patch', 'delete', 'request', 'response'],
      auth: ['auth', 'login', 'token', 'oauth', 'credential'],
      notification: ['notify', 'email', 'alert', 'message', 'send'],
      analysis: ['analyze', 'parse', 'validate', 'check', 'test']
    };
    
    const lowerName = toolName.toLowerCase();
    
    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => lowerName.includes(keyword))) {
        return category;
      }
    }
    
    return 'general';
  }
  
  async executeQuery(query, params = []) {
    const startTime = Date.now();
    let client = null;
    
    try {
      this.metrics.totalQueries++;
      client = await this.pool.connect();
      
      // Ensure search path is set for each connection
      await client.query(`SET search_path TO ${this.config.schema}, public`);
      
      const result = await client.query(query, params);
      
      const duration = Date.now() - startTime;
      this.metrics.avgQueryTime = (this.metrics.avgQueryTime + duration) / 2;
      
      return result;
      
    } catch (error) {
      this.metrics.failedQueries++;
      this.metrics.lastError = error;
      
      this.emit('queryError', {
        query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
        params: params,
        error: error.message,
        duration: Date.now() - startTime
      });
      
      throw error;
    } finally {
      if (client) {
        client.release();
      }
    }
  }
  
  /**
   * Get telemetry metrics
   */
  getTelemetryMetrics() {
    return {
      ...this.metrics,
      isConnected: this.isConnected,
      hubInstanceId: this.hubInstanceId,
      tenantId: this.tenantId,
      cacheStats: {
        servers: this.cache.servers.size,
        tools: this.cache.tools.size,
        lastUpdate: this.cache.lastCacheUpdate
      }
    };
  }
  
  /**
   * Graceful shutdown
   */
  async shutdown() {
    if (this.hubInstanceId) {
      await this.updateHubState('STOPPED', { shutdownAt: new Date().toISOString() });
    }
    
    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
    }
    
    this.emit('disconnected');
  }
}

module.exports = MCPHubTelemetry;

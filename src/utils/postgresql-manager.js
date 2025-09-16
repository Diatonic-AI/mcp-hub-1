/**
 * PostgreSQL Manager - Systematic Data Operations and Persistent Storage
 * 
 * This module provides comprehensive PostgreSQL integration for the MCP Hub,
 * offering persistent storage, systematic data management, and enhanced querying
 * capabilities that integrate seamlessly with the existing MCP server infrastructure.
 * 
 * FEATURES:
 * - Persistent storage for tool index, server configurations, and execution logs
 * - Real-time synchronization with MCP server state
 * - Advanced querying and analytics capabilities
 * - Data integrity and transaction management
 * - Performance monitoring and optimization
 */

import { Pool } from 'pg';
import logger from './logger.js';
import { wrapError } from './errors.js';
import EventEmitter from 'events';

// Singleton instance
let instance = null;

export class PostgreSQLManager extends EventEmitter {
  constructor(connectionConfig = {}) {
    super();
    
    // Default connection configuration
    this.config = {
      host: connectionConfig.host || process.env.POSTGRES_HOST || 'localhost',
      port: connectionConfig.port || process.env.POSTGRES_PORT || 5432,
      database: connectionConfig.database || process.env.POSTGRES_DB || 'postgres',
      user: connectionConfig.user || process.env.POSTGRES_USER || 'postgres',
      password: connectionConfig.password || process.env.POSTGRES_PASSWORD,
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: false,
      ...connectionConfig
    };

    this.pool = null;
    this.initialized = false;
    this.schemas = {
      mcp_hub: 'mcp_hub',
      analytics: 'mcp_analytics',
      logs: 'mcp_logs'
    };

    // Statistics tracking
    this.stats = {
      queriesExecuted: 0,
      lastQuery: null,
      connectionErrors: 0,
      avgQueryTime: 0,
      totalQueryTime: 0
    };
  }

  /**
   * Get singleton instance of PostgreSQLManager
   */
  static getInstance(connectionConfig) {
    if (!instance) {
      instance = new PostgreSQLManager(connectionConfig);
    }
    return instance;
  }

  /**
   * Check if the manager is initialized
   */
  isInitialized() {
    return this.initialized;
  }

  /**
   * Initialize PostgreSQL connection and create required schemas/tables
   */
  async initialize() {
    try {
      // Validate required configuration
      if (!this.config.password) {
        throw new Error('PostgreSQL password is required. Please set POSTGRES_PASSWORD environment variable.');
      }
      
      logger.info('Initializing PostgreSQL Manager', {
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.user
      });

      // Create connection pool
      this.pool = new Pool(this.config);

      // Test connection
      await this.testConnection();

      // Set up error handlers
      this.pool.on('error', (err) => {
        logger.error('PostgreSQL pool error', err.message, { error: err.stack });
        this.stats.connectionErrors++;
        this.emit('connectionError', err);
      });

      // Create schemas and tables
      await this.createSchemas();
      await this.createTables();

      this.initialized = true;
      logger.info('PostgreSQL Manager initialized successfully');
      this.emit('initialized');

      return true;
    } catch (error) {
      const wrappedError = wrapError(error, 'POSTGRESQL_INIT_ERROR');
      logger.error('PostgreSQL initialization failed', wrappedError.message, {
        error: wrappedError.stack,
        config: {
          host: this.config.host,
          port: this.config.port,
          database: this.config.database
        }
      });
      throw wrappedError;
    }
  }

  /**
   * Test PostgreSQL connection
   */
  async testConnection() {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT version() as version, now() as timestamp');
      logger.info('PostgreSQL connection successful', {
        version: result.rows[0].version.split(' ').slice(0, 2).join(' '),
        timestamp: result.rows[0].timestamp
      });
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  /**
   * Create required schemas
   */
  async createSchemas() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Create schemas if they don't exist
      for (const [name, schema] of Object.entries(this.schemas)) {
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
        logger.debug(`Schema ${schema} created or verified`);
      }

      await client.query('COMMIT');
      logger.info('PostgreSQL schemas initialized');
    } catch (error) {
      await client.query('ROLLBACK');
      throw wrapError(error, 'SCHEMA_CREATION_ERROR');
    } finally {
      client.release();
    }
  }

  /**
   * Create required tables
   */
  async createTables() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // MCP Servers table
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.schemas.mcp_hub}.servers (
          id SERIAL PRIMARY KEY,
          name VARCHAR(500) UNIQUE NOT NULL,
          display_name VARCHAR(500),
          endpoint VARCHAR(1000) NOT NULL,
          transport_type VARCHAR(50) DEFAULT 'stdio',
          status VARCHAR(50) DEFAULT 'disconnected',
          capabilities JSONB DEFAULT '{}',
          metadata JSONB DEFAULT '{}',
          config JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
          last_connected_at TIMESTAMP WITH TIME ZONE,
          connection_count INTEGER DEFAULT 0,
          error_count INTEGER DEFAULT 0,
          last_error TEXT
        )
      `);

      // Tools registry table
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.schemas.mcp_hub}.tools (
          id SERIAL PRIMARY KEY,
          tool_id VARCHAR(1000) UNIQUE NOT NULL,
          name VARCHAR(500) NOT NULL,
          original_name VARCHAR(500) NOT NULL,
          server_name VARCHAR(500) REFERENCES ${this.schemas.mcp_hub}.servers(name) ON DELETE CASCADE,
          description TEXT,
          input_schema JSONB DEFAULT '{}',
          category VARCHAR(100) DEFAULT 'general',
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
          last_used_at TIMESTAMP WITH TIME ZONE,
          usage_count INTEGER DEFAULT 0,
          success_count INTEGER DEFAULT 0,
          error_count INTEGER DEFAULT 0
        )
      `);

      // Tool executions log
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.schemas.logs}.tool_executions (
          id SERIAL PRIMARY KEY,
          execution_id VARCHAR(500),
          tool_id VARCHAR(1000) REFERENCES ${this.schemas.mcp_hub}.tools(tool_id),
          server_name VARCHAR(500),
          tool_name VARCHAR(500),
          arguments JSONB,
          result JSONB,
          status VARCHAR(50) DEFAULT 'pending',
          duration_ms INTEGER,
          started_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
          completed_at TIMESTAMP WITH TIME ZONE,
          error_message TEXT,
          metadata JSONB DEFAULT '{}'
        )
      `);

      // Server status history
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.schemas.analytics}.server_status_history (
          id SERIAL PRIMARY KEY,
          server_name VARCHAR(500) REFERENCES ${this.schemas.mcp_hub}.servers(name),
          status VARCHAR(50),
          previous_status VARCHAR(50),
          changed_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
          uptime_seconds INTEGER,
          metadata JSONB DEFAULT '{}'
        )
      `);

      // Hub events log
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.schemas.logs}.hub_events (
          id SERIAL PRIMARY KEY,
          event_type VARCHAR(100) NOT NULL,
          event_data JSONB DEFAULT '{}',
          level VARCHAR(20) DEFAULT 'info',
          message TEXT,
          source VARCHAR(100),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
          metadata JSONB DEFAULT '{}'
        )
      `);

      // Tool chain executions
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.schemas.logs}.tool_chain_executions (
          id SERIAL PRIMARY KEY,
          chain_id VARCHAR(500) UNIQUE NOT NULL,
          chain_config JSONB NOT NULL,
          status VARCHAR(50) DEFAULT 'running',
          total_steps INTEGER,
          completed_steps INTEGER DEFAULT 0,
          failed_steps INTEGER DEFAULT 0,
          started_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
          completed_at TIMESTAMP WITH TIME ZONE,
          duration_ms INTEGER,
          results JSONB DEFAULT '[]',
          error_message TEXT,
          metadata JSONB DEFAULT '{}'
        )
      `);

      // Create indexes for performance
      await this.createIndexes(client);

      await client.query('COMMIT');
      logger.info('PostgreSQL tables created successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      throw wrapError(error, 'TABLE_CREATION_ERROR');
    } finally {
      client.release();
    }
  }

  /**
   * Create performance indexes
   */
  async createIndexes(client) {
    const indexes = [
      // Tools indexes
      `CREATE INDEX IF NOT EXISTS idx_tools_server_name ON ${this.schemas.mcp_hub}.tools(server_name)`,
      `CREATE INDEX IF NOT EXISTS idx_tools_category ON ${this.schemas.mcp_hub}.tools(category)`,
      `CREATE INDEX IF NOT EXISTS idx_tools_last_used ON ${this.schemas.mcp_hub}.tools(last_used_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_tools_usage_count ON ${this.schemas.mcp_hub}.tools(usage_count DESC)`,
      
      // Servers indexes
      `CREATE INDEX IF NOT EXISTS idx_servers_status ON ${this.schemas.mcp_hub}.servers(status)`,
      `CREATE INDEX IF NOT EXISTS idx_servers_updated ON ${this.schemas.mcp_hub}.servers(updated_at DESC)`,
      
      // Tool executions indexes
      `CREATE INDEX IF NOT EXISTS idx_executions_started ON ${this.schemas.logs}.tool_executions(started_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_executions_tool_id ON ${this.schemas.logs}.tool_executions(tool_id)`,
      `CREATE INDEX IF NOT EXISTS idx_executions_status ON ${this.schemas.logs}.tool_executions(status)`,
      `CREATE INDEX IF NOT EXISTS idx_executions_server ON ${this.schemas.logs}.tool_executions(server_name)`,
      
      // Server status history indexes
      `CREATE INDEX IF NOT EXISTS idx_status_history_server ON ${this.schemas.analytics}.server_status_history(server_name)`,
      `CREATE INDEX IF NOT EXISTS idx_status_history_changed ON ${this.schemas.analytics}.server_status_history(changed_at DESC)`,
      
      // Hub events indexes
      `CREATE INDEX IF NOT EXISTS idx_hub_events_type ON ${this.schemas.logs}.hub_events(event_type)`,
      `CREATE INDEX IF NOT EXISTS idx_hub_events_created ON ${this.schemas.logs}.hub_events(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_hub_events_level ON ${this.schemas.logs}.hub_events(level)`,
      
      // Chain executions indexes
      `CREATE INDEX IF NOT EXISTS idx_chain_executions_started ON ${this.schemas.logs}.tool_chain_executions(started_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_chain_executions_status ON ${this.schemas.logs}.tool_chain_executions(status)`
    ];

    for (const indexQuery of indexes) {
      try {
        await client.query(indexQuery);
      } catch (error) {
        // Index might already exist, continue
        logger.debug('Index creation skipped or failed', { query: indexQuery, error: error.message });
      }
    }
  }

  /**
   * Execute a query with performance tracking
   */
  async query(text, params = []) {
    if (!this.pool) {
      throw new Error('PostgreSQL Manager not initialized');
    }

    const startTime = Date.now();
    this.stats.lastQuery = text;

    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - startTime;
      
      this.stats.queriesExecuted++;
      this.stats.totalQueryTime += duration;
      this.stats.avgQueryTime = this.stats.totalQueryTime / this.stats.queriesExecuted;

      logger.debug('PostgreSQL query executed', {
        duration,
        rows: result.rowCount,
        queryType: text.split(' ')[0].toUpperCase()
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('PostgreSQL query failed', error.message, {
        query: text,
        params,
        duration,
        error: error.stack
      });
      throw wrapError(error, 'POSTGRESQL_QUERY_ERROR', { query: text, params });
    }
  }

  /**
   * Register or update a server in PostgreSQL
   */
  async upsertServer(serverName, serverConfig) {
    const {
      displayName,
      endpoint,
      transportType,
      status,
      capabilities = {},
      metadata = {},
      config = {}
    } = serverConfig || {};
    
    const name = serverName;

    const result = await this.query(`
      INSERT INTO ${this.schemas.mcp_hub}.servers 
        (name, display_name, endpoint, transport_type, status, capabilities, metadata, config, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
      ON CONFLICT (name) DO UPDATE SET
        display_name = $2,
        endpoint = $3,
        transport_type = $4,
        status = $5,
        capabilities = $6,
        metadata = $7,
        config = $8,
        updated_at = now(),
        connection_count = CASE WHEN $5 = 'connected' THEN servers.connection_count + 1 ELSE servers.connection_count END,
        last_connected_at = CASE WHEN $5 = 'connected' THEN now() ELSE servers.last_connected_at END
      RETURNING *
    `, [name, displayName, endpoint, transportType, status, JSON.stringify(capabilities), 
        JSON.stringify(metadata), JSON.stringify(config)]);

    this.emit('serverUpserted', result.rows[0]);
    return result.rows[0];
  }

  /**
   * Register or update a tool in PostgreSQL
   */
  async upsertTool(serverName, toolConfig) {
    const {
      name,
      description = '',
      inputSchema = {},
      category = 'general',
      metadata = {},
      version = '1.0.0',
      tags = []
    } = toolConfig || {};
    
    const toolId = `${serverName}__${name}`;
    const originalName = name;

    const result = await this.query(`
      INSERT INTO ${this.schemas.mcp_hub}.tools 
        (tool_id, name, original_name, server_name, description, input_schema, category, metadata, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
      ON CONFLICT (tool_id) DO UPDATE SET
        name = $2,
        original_name = $3,
        description = $5,
        input_schema = $6,
        category = $7,
        metadata = $8,
        updated_at = now()
      RETURNING *
    `, [toolId, name, originalName, serverName, description, JSON.stringify(inputSchema), 
        category, JSON.stringify(metadata)]);

    this.emit('toolUpserted', result.rows[0]);
    return result.rows[0];
  }

  /**
   * Log tool execution
   */
  async logToolExecution(executionInfo) {
    const {
      executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      toolId,
      serverName,
      toolName,
      arguments: args = {},
      result = null,
      status = executionInfo.success === false ? 'error' : 'completed',
      durationMs = executionInfo.executionTimeMs || 0,
      startedAt = new Date(),
      completedAt = new Date(),
      errorMessage = null,
      metadata = {}
    } = executionInfo;

    const logResult = await this.query(`
      INSERT INTO ${this.schemas.logs}.tool_executions 
        (execution_id, tool_id, server_name, tool_name, arguments, result, status, 
         duration_ms, started_at, completed_at, error_message, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [executionId, toolId, serverName, toolName, JSON.stringify(args), 
        JSON.stringify(result), status, durationMs, startedAt, completedAt, errorMessage, JSON.stringify(metadata)]);

    // Update tool usage statistics
    await this.query(`
      UPDATE ${this.schemas.mcp_hub}.tools 
      SET usage_count = usage_count + 1,
          last_used_at = $2,
          success_count = CASE WHEN $3 = 'completed' THEN success_count + 1 ELSE success_count END,
          error_count = CASE WHEN $3 = 'error' THEN error_count + 1 ELSE error_count END
      WHERE tool_id = $1
    `, [toolId, completedAt, status]);

    this.emit('toolExecutionLogged', logResult.rows[0]);
    return logResult.rows[0];
  }

  /**
   * Log server status change
   */
  async logServerStatusChange(serverName, newStatus, previousStatus, uptimeSeconds = 0, metadata = {}) {
    const result = await this.query(`
      INSERT INTO ${this.schemas.analytics}.server_status_history 
        (server_name, status, previous_status, uptime_seconds, metadata)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [serverName, newStatus, previousStatus, uptimeSeconds, JSON.stringify(metadata)]);

    this.emit('serverStatusLogged', result.rows[0]);
    return result.rows[0];
  }

  /**
   * Log hub event
   */
  async logHubEvent(eventInfo) {
    const {
      type,
      data = {},
      level = 'info',
      message = '',
      source = 'hub',
      serverName = null,
      metadata = {}
    } = eventInfo;
    
    const result = await this.query(`
      INSERT INTO ${this.schemas.logs}.hub_events 
        (event_type, event_data, level, message, source, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [type, JSON.stringify(data), level, message, source, JSON.stringify(metadata)]);

    this.emit('hubEventLogged', result.rows[0]);
    return result.rows[0];
  }

  /**
   * Get server analytics
   */
  async getServerAnalytics(serverName = null, timeRange = '24 hours') {
    const whereClause = serverName ? 'WHERE server_name = $1' : '';
    const params = serverName ? [serverName] : [];
    // We embed timeRange directly in the SQL since it's safe (controlled input)

    const result = await this.query(`
      WITH server_stats AS (
        SELECT 
          s.name,
          s.display_name,
          s.status,
          s.connection_count,
          s.error_count,
          s.last_connected_at,
          COUNT(t.id) as tool_count,
          COALESCE(SUM(t.usage_count), 0) as total_tool_usage
        FROM ${this.schemas.mcp_hub}.servers s
        LEFT JOIN ${this.schemas.mcp_hub}.tools t ON s.name = t.server_name
        ${whereClause}
        GROUP BY s.name, s.display_name, s.status, s.connection_count, s.error_count, s.last_connected_at
      ),
      recent_executions AS (
        SELECT 
          server_name,
          COUNT(*) as execution_count,
          AVG(duration_ms) as avg_duration,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as success_count,
          COUNT(CASE WHEN status = 'error' THEN 1 END) as error_count
        FROM ${this.schemas.logs}.tool_executions
        WHERE started_at >= now() - interval '${timeRange}'
        ${serverName ? `AND server_name = '${serverName}'` : ''}
        GROUP BY server_name
      )
      SELECT 
        ss.*,
        COALESCE(re.execution_count, 0) as recent_executions,
        COALESCE(re.avg_duration, 0) as avg_execution_time,
        COALESCE(re.success_count, 0) as recent_successes,
        COALESCE(re.error_count, 0) as recent_errors,
        CASE 
          WHEN COALESCE(re.execution_count, 0) > 0 
          THEN ROUND((COALESCE(re.success_count, 0)::decimal / re.execution_count * 100), 2)
          ELSE 0 
        END as success_rate
      FROM server_stats ss
      LEFT JOIN recent_executions re ON ss.name = re.server_name
      ORDER BY ss.name
    `, params);

    return result.rows;
  }

  /**
   * Get tool analytics
   */
  async getToolAnalytics(limit = 20, timeRange = '24 hours') {
    const result = await this.query(`
      WITH tool_stats AS (
        SELECT 
          t.tool_id,
          t.name,
          t.server_name,
          t.category,
          t.usage_count as total_usage,
          t.last_used_at,
          COALESCE(COUNT(te.id), 0) as recent_executions,
          COALESCE(AVG(te.duration_ms), 0) as avg_duration,
          COALESCE(COUNT(CASE WHEN te.status = 'completed' THEN 1 END), 0) as recent_successes,
          COALESCE(COUNT(CASE WHEN te.status = 'error' THEN 1 END), 0) as recent_errors
        FROM ${this.schemas.mcp_hub}.tools t
        LEFT JOIN ${this.schemas.logs}.tool_executions te ON t.tool_id = te.tool_id
          AND te.started_at >= now() - interval '${timeRange}'
        GROUP BY t.tool_id, t.name, t.server_name, t.category, t.usage_count, t.last_used_at
      )
      SELECT 
        *,
        CASE 
          WHEN recent_executions > 0 
          THEN ROUND((recent_successes::decimal / recent_executions * 100), 2)
          ELSE 100 
        END as success_rate
      FROM tool_stats
      ORDER BY recent_executions DESC, total_usage DESC
      LIMIT $1
    `, [limit]);

    return result.rows;
  }
  
  /**
   * Get comprehensive analytics
   */
  async getAnalytics(timeRange = '24 hours') {
    const hubMetrics = await this.getHubMetrics(timeRange);
    const serverAnalytics = await this.getServerAnalytics(null, timeRange);
    const toolAnalytics = await this.getToolAnalytics(10, timeRange);
    
    return {
      hub: hubMetrics[0] || {},
      servers: serverAnalytics,
      topTools: toolAnalytics,
      timestamp: new Date().toISOString(),
      timeRange
    };
  }

  /**
   * Get hub performance metrics
   */
  async getHubMetrics(timeRange = '24 hours') {
    const result = await this.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${this.schemas.mcp_hub}.servers) as total_servers,
        (SELECT COUNT(*) FROM ${this.schemas.mcp_hub}.servers WHERE status = 'connected') as connected_servers,
        (SELECT COUNT(*) FROM ${this.schemas.mcp_hub}.tools) as total_tools,
        (SELECT COUNT(*) FROM ${this.schemas.logs}.tool_executions 
         WHERE started_at >= now() - interval '${timeRange}') as recent_executions,
        (SELECT AVG(duration_ms) FROM ${this.schemas.logs}.tool_executions 
         WHERE started_at >= now() - interval '${timeRange}') as avg_execution_time,
        (SELECT COUNT(*) FROM ${this.schemas.logs}.hub_events 
         WHERE created_at >= now() - interval '${timeRange}') as recent_events,
        (SELECT COUNT(*) FROM ${this.schemas.logs}.hub_events 
         WHERE level = 'error' AND created_at >= now() - interval '${timeRange}') as recent_errors
    `);

    return result.rows[0];
  }

  /**
   * Search tools with advanced filtering
   */
  async searchTools(searchOptions = {}) {
    const {
      query = '',
      serverName = null,
      category = null,
      minUsage = 0,
      sortBy = 'usage_count',
      sortOrder = 'DESC',
      limit = 50,
      offset = 0
    } = searchOptions;

    let whereConditions = ['1=1'];
    let params = [];
    let paramCounter = 1;

    if (query) {
      whereConditions.push(`(t.name ILIKE $${paramCounter} OR t.description ILIKE $${paramCounter})`);
      params.push(`%${query}%`);
      paramCounter++;
    }

    if (serverName) {
      whereConditions.push(`t.server_name = $${paramCounter}`);
      params.push(serverName);
      paramCounter++;
    }

    if (category) {
      whereConditions.push(`t.category = $${paramCounter}`);
      params.push(category);
      paramCounter++;
    }

    if (minUsage > 0) {
      whereConditions.push(`t.usage_count >= $${paramCounter}`);
      params.push(minUsage);
      paramCounter++;
    }

    params.push(limit, offset);

    const result = await this.query(`
      SELECT 
        t.*,
        s.display_name as server_display_name,
        s.status as server_status,
        COALESCE(COUNT(te.id), 0) as recent_executions
      FROM ${this.schemas.mcp_hub}.tools t
      JOIN ${this.schemas.mcp_hub}.servers s ON t.server_name = s.name
      LEFT JOIN ${this.schemas.logs}.tool_executions te ON t.tool_id = te.tool_id
        AND te.started_at >= now() - interval '24 hours'
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY t.id, s.display_name, s.status
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT $${paramCounter} OFFSET $${paramCounter + 1}
    `, params);

    return result.rows;
  }

  /**
   * Clean up old data based on retention policies
   */
  async cleanupOldData(retentionDays = 30) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const cutoffDate = new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000));

      // Clean up old tool executions
      const executionsResult = await client.query(`
        DELETE FROM ${this.schemas.logs}.tool_executions 
        WHERE started_at < $1
      `, [cutoffDate]);

      // Clean up old server status history
      const statusResult = await client.query(`
        DELETE FROM ${this.schemas.analytics}.server_status_history 
        WHERE changed_at < $1
      `, [cutoffDate]);

      // Clean up old hub events (keep errors longer)
      const eventsResult = await client.query(`
        DELETE FROM ${this.schemas.logs}.hub_events 
        WHERE created_at < $1 AND level != 'error'
      `, [cutoffDate]);

      // Clean up old error events (60 days)
      const oldCutoffDate = new Date(Date.now() - (60 * 24 * 60 * 60 * 1000));
      const errorEventsResult = await client.query(`
        DELETE FROM ${this.schemas.logs}.hub_events 
        WHERE created_at < $1 AND level = 'error'
      `, [oldCutoffDate]);

      await client.query('COMMIT');

      const cleanupStats = {
        executionsRemoved: executionsResult.rowCount,
        statusHistoryRemoved: statusResult.rowCount,
        eventsRemoved: eventsResult.rowCount,
        errorEventsRemoved: errorEventsResult.rowCount,
        retentionDays,
        cleanupDate: new Date().toISOString()
      };

      logger.info('PostgreSQL cleanup completed', cleanupStats);
      this.emit('cleanupCompleted', cleanupStats);

      return cleanupStats;
    } catch (error) {
      await client.query('ROLLBACK');
      throw wrapError(error, 'CLEANUP_ERROR');
    } finally {
      client.release();
    }
  }

  /**
   * Get connection pool status
   */
  getPoolStatus() {
    if (!this.pool) {
      return { status: 'not_initialized' };
    }

    return {
      status: 'active',
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      ...this.stats
    };
  }

  /**
   * Close PostgreSQL connection pool
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.initialized = false;
      logger.info('PostgreSQL Manager closed');
      this.emit('closed');
    }
  }
}

// Export class
export default PostgreSQLManager;

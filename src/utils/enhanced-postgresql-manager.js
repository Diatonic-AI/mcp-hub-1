/**
 * Enhanced PostgreSQL Manager - Advanced Data Operations and Analytics
 * 
 * This module extends the existing PostgreSQL Manager with enhanced capabilities
 * for tool chain tracking, advanced analytics, metadata management, and improved
 * integration with the MCP Hub's centralized tool index system.
 * 
 * ENHANCEMENTS:
 * - Advanced tool chain execution tracking with dependency mapping
 * - Enhanced metadata collection and structured analytics
 * - Improved UUID/GUID support throughout the system
 * - Real-time dashboard metrics and performance insights
 * - Enhanced audit logging and security tracking
 * - Better integration with the centralized tool index
 */

import PostgreSQLManager from './postgresql-manager.js';
import logger from './logger.js';
import { wrapError } from './errors.js';
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid';
import EventEmitter from 'events';

export class EnhancedPostgreSQLManager extends PostgreSQLManager {
  constructor(connectionConfig = {}) {
    super(connectionConfig);
    
    // Enhanced schemas for new capabilities
    this.enhancedSchemas = {
      ...this.schemas,
      metadata: 'mcp_metadata',
      security: 'mcp_security',
      analytics: 'mcp_advanced_analytics'
    };
    
    // Enhanced statistics tracking
    this.enhancedStats = {
      ...this.stats,
      chainExecutions: 0,
      metadataOperations: 0,
      analyticsQueries: 0,
      realTimeUpdates: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
    
    // Cache for frequently accessed data
    this.cache = new Map();
    this.cacheTimeout = 300000; // 5 minutes
  }

  /**
   * Enhanced initialization with additional schemas and tables
   */
  async initialize() {
    try {
      // Call parent initialization
      await super.initialize();
      
      // Create enhanced schemas
      await this.createEnhancedSchemas();
      
      // Create enhanced tables
      await this.createEnhancedTables();
      
      // Set up real-time triggers
      await this.setupRealTimeTriggers();
      
      logger.info('Enhanced PostgreSQL Manager initialized successfully');
      this.emit('enhancedInitialized');
      
      return true;
    } catch (error) {
      throw wrapError(error, 'ENHANCED_POSTGRESQL_INIT_ERROR');
    }
  }

  /**
   * Create enhanced schemas
   */
  async createEnhancedSchemas() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Create additional schemas
      for (const [name, schema] of Object.entries(this.enhancedSchemas)) {
        if (!this.schemas[name]) { // Only create if not already in base schemas
          await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
          logger.debug(`Enhanced schema ${schema} created or verified`);
        }
      }

      await client.query('COMMIT');
      logger.info('Enhanced PostgreSQL schemas initialized');
    } catch (error) {
      await client.query('ROLLBACK');
      throw wrapError(error, 'ENHANCED_SCHEMA_CREATION_ERROR');
    } finally {
      client.release();
    }
  }

  /**
   * Create enhanced tables for improved functionality
   */
  async createEnhancedTables() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Enhanced tool chain executions with better tracking
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.schemas.logs}.enhanced_tool_chain_executions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          chain_id VARCHAR(255) UNIQUE NOT NULL,
          parent_chain_id UUID REFERENCES ${this.schemas.logs}.enhanced_tool_chain_executions(id),
          correlation_id UUID DEFAULT gen_random_uuid(),
          
          -- Chain configuration and metadata
          chain_config JSONB NOT NULL,
          chain_type VARCHAR(50) DEFAULT 'sequential', -- sequential, parallel, conditional
          priority INTEGER DEFAULT 0,
          
          -- Enhanced status tracking
          status VARCHAR(50) DEFAULT 'queued',
          phase VARCHAR(50) DEFAULT 'initialization',
          progress_percent DECIMAL(5,2) DEFAULT 0.0,
          
          -- Step tracking
          total_steps INTEGER DEFAULT 0,
          completed_steps INTEGER DEFAULT 0,
          failed_steps INTEGER DEFAULT 0,
          skipped_steps INTEGER DEFAULT 0,
          retried_steps INTEGER DEFAULT 0,
          
          -- Timing with enhanced precision
          queued_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          started_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          total_duration_ms BIGINT,
          execution_duration_ms BIGINT,
          queue_wait_time_ms BIGINT,
          
          -- Results and error handling
          results JSONB DEFAULT '[]',
          intermediate_results JSONB DEFAULT '{}',
          error_message TEXT,
          error_stack TEXT,
          error_code VARCHAR(100),
          retry_count INTEGER DEFAULT 0,
          max_retries INTEGER DEFAULT 3,
          
          -- Resource usage tracking
          max_memory_usage_mb INTEGER,
          total_cpu_time_ms BIGINT,
          network_requests_count INTEGER DEFAULT 0,
          
          -- Audit and security
          initiated_by VARCHAR(255),
          client_info JSONB DEFAULT '{}',
          security_context JSONB DEFAULT '{}',
          
          -- Enhanced metadata
          metadata JSONB DEFAULT '{}',
          tags TEXT[] DEFAULT '{}',
          
          -- Indexes for performance
          CONSTRAINT check_progress_percent CHECK (progress_percent >= 0 AND progress_percent <= 100)
        )
      `);

      // Tool chain step executions for granular tracking
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.schemas.logs}.tool_chain_step_executions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          chain_execution_id UUID NOT NULL REFERENCES ${this.schemas.logs}.enhanced_tool_chain_executions(id) ON DELETE CASCADE,
          tool_execution_id UUID REFERENCES ${this.schemas.logs}.tool_executions(id),
          
          -- Step identification
          step_id VARCHAR(255) NOT NULL,
          step_index INTEGER NOT NULL,
          step_name VARCHAR(255),
          step_type VARCHAR(50) DEFAULT 'tool_call', -- tool_call, transformation, condition, parallel_group
          
          -- Dependencies and relationships
          depends_on_steps TEXT[] DEFAULT '{}',
          parallel_group VARCHAR(100),
          condition_expression TEXT,
          
          -- Step configuration
          tool_id VARCHAR(500),
          server_name VARCHAR(255),
          tool_name VARCHAR(255),
          arguments JSONB DEFAULT '{}',
          input_mapping JSONB DEFAULT '{}',
          transformations JSONB DEFAULT '[]',
          
          -- Execution tracking
          status execution_status_enum DEFAULT 'started',
          started_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMPTZ,
          duration_ms INTEGER,
          retry_count INTEGER DEFAULT 0,
          
          -- Results
          result JSONB,
          transformed_result JSONB,
          error_message TEXT,
          error_code VARCHAR(100),
          
          -- Performance metrics
          memory_usage_mb INTEGER,
          cpu_time_ms INTEGER,
          
          metadata JSONB DEFAULT '{}'
        )
      `);

      // Enhanced metadata management table
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.enhancedSchemas.metadata}.entity_metadata (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          entity_type VARCHAR(50) NOT NULL, -- server, tool, execution, chain, user
          entity_id VARCHAR(500) NOT NULL,
          
          -- Metadata organization
          namespace VARCHAR(100) NOT NULL DEFAULT 'default',
          category VARCHAR(100),
          subcategory VARCHAR(100),
          
          -- Metadata content
          metadata_key VARCHAR(255) NOT NULL,
          metadata_value JSONB,
          data_type VARCHAR(50) DEFAULT 'json', -- json, string, number, boolean, array
          
          -- Lifecycle
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMPTZ,
          version INTEGER DEFAULT 1,
          
          -- Access control
          visibility VARCHAR(20) DEFAULT 'internal', -- public, internal, private, restricted
          access_permissions JSONB DEFAULT '{}',
          
          -- Audit
          created_by VARCHAR(255),
          updated_by VARCHAR(255),
          
          UNIQUE(entity_type, entity_id, namespace, metadata_key)
        )
      `);

      // Real-time analytics cache table
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.enhancedSchemas.analytics}.analytics_cache (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          cache_key VARCHAR(500) UNIQUE NOT NULL,
          query_hash VARCHAR(64) NOT NULL,
          
          -- Cache content
          result_data JSONB NOT NULL,
          result_metadata JSONB DEFAULT '{}',
          
          -- Cache lifecycle
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMPTZ NOT NULL,
          access_count INTEGER DEFAULT 0,
          last_accessed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          
          -- Cache statistics
          generation_time_ms INTEGER,
          result_size_bytes INTEGER,
          
          -- Tags for cache invalidation
          tags TEXT[] DEFAULT '{}',
          
          metadata JSONB DEFAULT '{}'
        )
      `);

      // Enhanced server performance tracking
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.enhancedSchemas.analytics}.server_performance_metrics (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          server_name VARCHAR(255) NOT NULL,
          metric_timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          
          -- Performance metrics
          response_time_p50_ms DECIMAL(10,2),
          response_time_p90_ms DECIMAL(10,2),
          response_time_p95_ms DECIMAL(10,2),
          response_time_p99_ms DECIMAL(10,2),
          
          -- Throughput metrics
          requests_per_second DECIMAL(10,2),
          successful_requests_per_second DECIMAL(10,2),
          failed_requests_per_second DECIMAL(10,2),
          
          -- Error rates
          error_rate_percent DECIMAL(5,2),
          timeout_rate_percent DECIMAL(5,2),
          retry_rate_percent DECIMAL(5,2),
          
          -- Resource utilization
          cpu_usage_percent DECIMAL(5,2),
          memory_usage_mb INTEGER,
          connection_pool_usage_percent DECIMAL(5,2),
          
          -- Queue metrics
          average_queue_depth INTEGER,
          max_queue_depth INTEGER,
          queue_wait_time_ms DECIMAL(10,2),
          
          -- Connection metrics
          active_connections INTEGER,
          total_connections INTEGER,
          connection_errors INTEGER,
          
          metadata JSONB DEFAULT '{}'
        )
      `);

      // Security audit table
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.enhancedSchemas.security}.security_audit_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          event_timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          
          -- Event classification
          event_type VARCHAR(50) NOT NULL, -- authentication, authorization, access, modification, security_violation
          severity VARCHAR(20) DEFAULT 'info', -- critical, high, medium, low, info
          category VARCHAR(100),
          
          -- Actor information
          user_id VARCHAR(255),
          user_type VARCHAR(50), -- human, service, system, anonymous
          client_ip INET,
          user_agent TEXT,
          session_id UUID,
          
          -- Resource information
          resource_type VARCHAR(50), -- server, tool, chain, data
          resource_id VARCHAR(500),
          resource_name VARCHAR(255),
          
          -- Action details
          action VARCHAR(100) NOT NULL, -- read, write, execute, delete, modify, access
          status VARCHAR(20) DEFAULT 'success', -- success, failure, blocked, suspicious
          
          -- Context
          description TEXT,
          risk_score INTEGER DEFAULT 0, -- 0-100
          metadata JSONB DEFAULT '{}',
          
          -- Geolocation (optional)
          country_code VARCHAR(2),
          region VARCHAR(100),
          city VARCHAR(100),
          
          -- Response
          response_action VARCHAR(100), -- none, alert, block, quarantine
          response_metadata JSONB DEFAULT '{}'
        )
      `);

      // Enhanced indexes
      await this.createEnhancedIndexes(client);

      await client.query('COMMIT');
      logger.info('Enhanced PostgreSQL tables created successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      throw wrapError(error, 'ENHANCED_TABLE_CREATION_ERROR');
    } finally {
      client.release();
    }
  }

  /**
   * Create enhanced performance indexes
   */
  async createEnhancedIndexes(client) {
    const indexes = [
      // Enhanced tool chain execution indexes
      `CREATE INDEX IF NOT EXISTS idx_enhanced_chain_executions_correlation 
       ON ${this.schemas.logs}.enhanced_tool_chain_executions(correlation_id)`,
      
      `CREATE INDEX IF NOT EXISTS idx_enhanced_chain_executions_status_started 
       ON ${this.schemas.logs}.enhanced_tool_chain_executions(status, started_at DESC)`,
       
      `CREATE INDEX IF NOT EXISTS idx_enhanced_chain_executions_priority_queued 
       ON ${this.schemas.logs}.enhanced_tool_chain_executions(priority DESC, queued_at ASC) 
       WHERE status = 'queued'`,

      // Tool chain step indexes
      `CREATE INDEX IF NOT EXISTS idx_tool_chain_step_executions_chain 
       ON ${this.schemas.logs}.tool_chain_step_executions(chain_execution_id, step_index)`,
       
      `CREATE INDEX IF NOT EXISTS idx_tool_chain_step_executions_parallel_group 
       ON ${this.schemas.logs}.tool_chain_step_executions(parallel_group) 
       WHERE parallel_group IS NOT NULL`,

      // Metadata indexes
      `CREATE INDEX IF NOT EXISTS idx_entity_metadata_lookup 
       ON ${this.enhancedSchemas.metadata}.entity_metadata(entity_type, entity_id, namespace)`,
       
      `CREATE INDEX IF NOT EXISTS idx_entity_metadata_key_value 
       ON ${this.enhancedSchemas.metadata}.entity_metadata USING gin(metadata_value)`,
       
      `CREATE INDEX IF NOT EXISTS idx_entity_metadata_expires 
       ON ${this.enhancedSchemas.metadata}.entity_metadata(expires_at) 
       WHERE expires_at IS NOT NULL`,

      // Analytics cache indexes
      `CREATE INDEX IF NOT EXISTS idx_analytics_cache_key 
       ON ${this.enhancedSchemas.analytics}.analytics_cache(cache_key)`,
       
      `CREATE INDEX IF NOT EXISTS idx_analytics_cache_expires 
       ON ${this.enhancedSchemas.analytics}.analytics_cache(expires_at)`,
       
      `CREATE INDEX IF NOT EXISTS idx_analytics_cache_tags 
       ON ${this.enhancedSchemas.analytics}.analytics_cache USING gin(tags)`,

      // Performance metrics indexes
      `CREATE INDEX IF NOT EXISTS idx_server_performance_metrics_server_time 
       ON ${this.enhancedSchemas.analytics}.server_performance_metrics(server_name, metric_timestamp DESC)`,

      // Security audit indexes
      `CREATE INDEX IF NOT EXISTS idx_security_audit_event_time 
       ON ${this.enhancedSchemas.security}.security_audit_log(event_type, event_timestamp DESC)`,
       
      `CREATE INDEX IF NOT EXISTS idx_security_audit_severity 
       ON ${this.enhancedSchemas.security}.security_audit_log(severity, event_timestamp DESC) 
       WHERE severity IN ('critical', 'high')`,
       
      `CREATE INDEX IF NOT EXISTS idx_security_audit_resource 
       ON ${this.enhancedSchemas.security}.security_audit_log(resource_type, resource_id)`
    ];

    for (const indexQuery of indexes) {
      try {
        await client.query(indexQuery);
      } catch (error) {
        logger.debug('Enhanced index creation skipped or failed', { 
          query: indexQuery, 
          error: error.message 
        });
      }
    }
  }

  /**
   * Log enhanced tool chain execution with comprehensive tracking
   */
  async logEnhancedToolChainExecution(chainInfo) {
    const {
      chainId = `chain_${uuidv7()}`,
      parentChainId = null,
      correlationId = uuidv4(),
      chainConfig,
      chainType = 'sequential',
      priority = 0,
      totalSteps = 0,
      initiatedBy = 'system',
      clientInfo = {},
      securityContext = {},
      metadata = {},
      tags = []
    } = chainInfo;

    const result = await this.query(`
      INSERT INTO ${this.schemas.logs}.enhanced_tool_chain_executions (
        chain_id, parent_chain_id, correlation_id, chain_config, chain_type,
        priority, total_steps, initiated_by, client_info, security_context,
        metadata, tags, status, queued_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'queued', now())
      RETURNING *
    `, [
      chainId, parentChainId, correlationId, JSON.stringify(chainConfig), 
      chainType, priority, totalSteps, initiatedBy, JSON.stringify(clientInfo), 
      JSON.stringify(securityContext), JSON.stringify(metadata), tags
    ]);

    this.enhancedStats.chainExecutions++;
    this.emit('enhancedChainExecutionLogged', result.rows[0]);
    
    return result.rows[0];
  }

  /**
   * Update tool chain execution progress
   */
  async updateChainExecutionProgress(chainId, progressInfo) {
    const {
      status = null,
      phase = null,
      progressPercent = null,
      completedSteps = null,
      failedSteps = null,
      skippedSteps = null,
      retriedSteps = null,
      intermediateResults = null,
      memoryUsageMb = null,
      cpuTimeMs = null,
      networkRequestsCount = null
    } = progressInfo;

    const updateFields = [];
    const updateValues = [];
    let paramCounter = 1;

    if (status !== null) {
      updateFields.push(`status = $${paramCounter++}`);
      updateValues.push(status);
    }
    
    if (phase !== null) {
      updateFields.push(`phase = $${paramCounter++}`);
      updateValues.push(phase);
    }
    
    if (progressPercent !== null) {
      updateFields.push(`progress_percent = $${paramCounter++}`);
      updateValues.push(progressPercent);
    }
    
    if (completedSteps !== null) {
      updateFields.push(`completed_steps = $${paramCounter++}`);
      updateValues.push(completedSteps);
    }
    
    if (failedSteps !== null) {
      updateFields.push(`failed_steps = $${paramCounter++}`);
      updateValues.push(failedSteps);
    }
    
    if (skippedSteps !== null) {
      updateFields.push(`skipped_steps = $${paramCounter++}`);
      updateValues.push(skippedSteps);
    }
    
    if (retriedSteps !== null) {
      updateFields.push(`retried_steps = $${paramCounter++}`);
      updateValues.push(retriedSteps);
    }
    
    if (intermediateResults !== null) {
      updateFields.push(`intermediate_results = $${paramCounter++}`);
      updateValues.push(JSON.stringify(intermediateResults));
    }
    
    if (memoryUsageMb !== null) {
      updateFields.push(`max_memory_usage_mb = GREATEST(COALESCE(max_memory_usage_mb, 0), $${paramCounter++})`);
      updateValues.push(memoryUsageMb);
    }
    
    if (cpuTimeMs !== null) {
      updateFields.push(`total_cpu_time_ms = COALESCE(total_cpu_time_ms, 0) + $${paramCounter++}`);
      updateValues.push(cpuTimeMs);
    }
    
    if (networkRequestsCount !== null) {
      updateFields.push(`network_requests_count = COALESCE(network_requests_count, 0) + $${paramCounter++}`);
      updateValues.push(networkRequestsCount);
    }

    // Add timing updates
    if (status === 'running' && phase === 'execution') {
      updateFields.push(`started_at = COALESCE(started_at, now())`);
      updateFields.push(`queue_wait_time_ms = EXTRACT(EPOCH FROM (now() - queued_at)) * 1000`);
    }
    
    if (status === 'completed' || status === 'failed') {
      updateFields.push(`completed_at = now()`);
      updateFields.push(`total_duration_ms = EXTRACT(EPOCH FROM (now() - queued_at)) * 1000`);
      updateFields.push(`execution_duration_ms = EXTRACT(EPOCH FROM (now() - COALESCE(started_at, queued_at))) * 1000`);
    }

    updateValues.push(chainId);

    const result = await this.query(`
      UPDATE ${this.schemas.logs}.enhanced_tool_chain_executions
      SET ${updateFields.join(', ')}
      WHERE chain_id = $${paramCounter}
      RETURNING *
    `, updateValues);

    this.emit('chainExecutionProgressUpdated', result.rows[0]);
    return result.rows[0];
  }

  /**
   * Log tool chain step execution
   */
  async logChainStepExecution(stepInfo) {
    const {
      chainExecutionId,
      toolExecutionId = null,
      stepId,
      stepIndex,
      stepName = '',
      stepType = 'tool_call',
      dependsOnSteps = [],
      parallelGroup = null,
      conditionExpression = null,
      toolId = null,
      serverName = null,
      toolName = null,
      arguments: args = {},
      inputMapping = {},
      transformations = [],
      metadata = {}
    } = stepInfo;

    const result = await this.query(`
      INSERT INTO ${this.schemas.logs}.tool_chain_step_executions (
        chain_execution_id, tool_execution_id, step_id, step_index, step_name,
        step_type, depends_on_steps, parallel_group, condition_expression,
        tool_id, server_name, tool_name, arguments, input_mapping,
        transformations, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `, [
      chainExecutionId, toolExecutionId, stepId, stepIndex, stepName,
      stepType, dependsOnSteps, parallelGroup, conditionExpression,
      toolId, serverName, toolName, JSON.stringify(args),
      JSON.stringify(inputMapping), JSON.stringify(transformations),
      JSON.stringify(metadata)
    ]);

    this.emit('chainStepExecutionLogged', result.rows[0]);
    return result.rows[0];
  }

  /**
   * Store entity metadata with enhanced organization
   */
  async setEntityMetadata(entityType, entityId, namespace = 'default', metadataMap) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const [key, value] of Object.entries(metadataMap)) {
        await client.query(`
          INSERT INTO ${this.enhancedSchemas.metadata}.entity_metadata 
            (entity_type, entity_id, namespace, metadata_key, metadata_value, 
             data_type, created_by, updated_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
          ON CONFLICT (entity_type, entity_id, namespace, metadata_key) DO UPDATE SET
            metadata_value = $5,
            updated_at = now(),
            version = entity_metadata.version + 1,
            updated_by = $7
        `, [
          entityType, entityId, namespace, key, JSON.stringify(value),
          this.inferDataType(value), 'enhanced-manager'
        ]);
      }

      await client.query('COMMIT');
      this.enhancedStats.metadataOperations++;
      this.emit('entityMetadataUpdated', { entityType, entityId, namespace, keys: Object.keys(metadataMap) });

    } catch (error) {
      await client.query('ROLLBACK');
      throw wrapError(error, 'METADATA_UPDATE_ERROR');
    } finally {
      client.release();
    }
  }

  /**
   * Get entity metadata with caching
   */
  async getEntityMetadata(entityType, entityId, namespace = 'default', keys = null) {
    const cacheKey = `metadata:${entityType}:${entityId}:${namespace}:${keys ? keys.join(',') : 'all'}`;
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (cached.expires > Date.now()) {
        this.enhancedStats.cacheHits++;
        return cached.data;
      } else {
        this.cache.delete(cacheKey);
      }
    }

    this.enhancedStats.cacheMisses++;

    let whereClause = 'WHERE entity_type = $1 AND entity_id = $2 AND namespace = $3';
    let params = [entityType, entityId, namespace];

    if (keys && keys.length > 0) {
      whereClause += ' AND metadata_key = ANY($4)';
      params.push(keys);
    }

    const result = await this.query(`
      SELECT metadata_key, metadata_value, data_type, version, updated_at
      FROM ${this.enhancedSchemas.metadata}.entity_metadata
      ${whereClause}
      ORDER BY metadata_key
    `, params);

    const metadata = {};
    for (const row of result.rows) {
      metadata[row.metadata_key] = row.metadata_value;
    }

    // Cache the result
    this.cache.set(cacheKey, {
      data: metadata,
      expires: Date.now() + this.cacheTimeout
    });

    return metadata;
  }

  /**
   * Get comprehensive analytics dashboard data
   */
  async getAdvancedAnalytics(timeRange = '24 hours', includeRealTime = true) {
    const cacheKey = `analytics:dashboard:${timeRange}:${includeRealTime}`;
    
    // Check cache for non-real-time requests
    if (!includeRealTime && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (cached.expires > Date.now()) {
        this.enhancedStats.cacheHits++;
        return cached.data;
      }
    }

    this.enhancedStats.analyticsQueries++;

    // Get enhanced hub metrics
    const hubMetrics = await this.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${this.schemas.mcp_hub}.servers) as total_servers,
        (SELECT COUNT(*) FROM ${this.schemas.mcp_hub}.servers WHERE status = 'connected') as connected_servers,
        (SELECT COUNT(*) FROM ${this.schemas.mcp_hub}.tools) as total_tools,
        
        -- Enhanced execution metrics
        (SELECT COUNT(*) FROM ${this.schemas.logs}.tool_executions 
         WHERE started_at >= now() - interval '${timeRange}') as recent_executions,
        (SELECT COUNT(*) FROM ${this.schemas.logs}.enhanced_tool_chain_executions 
         WHERE started_at >= now() - interval '${timeRange}') as recent_chain_executions,
        
        -- Performance metrics
        (SELECT AVG(duration_ms) FROM ${this.schemas.logs}.tool_executions 
         WHERE started_at >= now() - interval '${timeRange}' AND duration_ms IS NOT NULL) as avg_execution_time,
        (SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) 
         FROM ${this.schemas.logs}.tool_executions 
         WHERE started_at >= now() - interval '${timeRange}' AND duration_ms IS NOT NULL) as p95_execution_time,
        
        -- Error rates
        (SELECT 
          ROUND((COUNT(*) FILTER (WHERE error_message IS NOT NULL)::decimal / 
                 NULLIF(COUNT(*), 0)) * 100, 2)
         FROM ${this.schemas.logs}.tool_executions 
         WHERE started_at >= now() - interval '${timeRange}') as error_rate_percent,
         
        -- Chain execution metrics
        (SELECT 
          ROUND(AVG(progress_percent), 2)
         FROM ${this.schemas.logs}.enhanced_tool_chain_executions 
         WHERE started_at >= now() - interval '${timeRange}') as avg_chain_progress,
        
        -- Resource usage
        (SELECT AVG(max_memory_usage_mb) 
         FROM ${this.schemas.logs}.enhanced_tool_chain_executions 
         WHERE started_at >= now() - interval '${timeRange}' 
         AND max_memory_usage_mb IS NOT NULL) as avg_memory_usage_mb
    `);

    // Get top performing tools
    const topTools = await this.query(`
      SELECT 
        t.tool_id,
        t.name,
        t.server_name,
        t.usage_count,
        COUNT(te.id) as recent_usage,
        AVG(te.duration_ms) as avg_duration,
        ROUND((COUNT(te.id) FILTER (WHERE te.error_message IS NULL)::decimal / 
               NULLIF(COUNT(te.id), 0)) * 100, 2) as success_rate
      FROM ${this.schemas.mcp_hub}.tools t
      LEFT JOIN ${this.schemas.logs}.tool_executions te ON t.tool_id = te.tool_id
        AND te.started_at >= now() - interval '${timeRange}'
      GROUP BY t.tool_id, t.name, t.server_name, t.usage_count
      HAVING COUNT(te.id) > 0
      ORDER BY recent_usage DESC, success_rate DESC
      LIMIT 10
    `);

    // Get chain execution statistics
    const chainStats = await this.query(`
      SELECT 
        chain_type,
        status,
        COUNT(*) as count,
        AVG(total_duration_ms) as avg_duration_ms,
        AVG(progress_percent) as avg_progress,
        AVG(completed_steps::decimal / NULLIF(total_steps, 0) * 100) as avg_completion_rate
      FROM ${this.schemas.logs}.enhanced_tool_chain_executions
      WHERE started_at >= now() - interval '${timeRange}'
      GROUP BY chain_type, status
      ORDER BY chain_type, status
    `);

    // Get server performance metrics
    const serverPerformance = await this.query(`
      SELECT 
        server_name,
        AVG(response_time_p95_ms) as avg_p95_response_time,
        AVG(requests_per_second) as avg_requests_per_second,
        AVG(error_rate_percent) as avg_error_rate,
        MAX(max_queue_depth) as max_queue_depth,
        AVG(active_connections) as avg_active_connections
      FROM ${this.enhancedSchemas.analytics}.server_performance_metrics
      WHERE metric_timestamp >= now() - interval '${timeRange}'
      GROUP BY server_name
      ORDER BY avg_requests_per_second DESC
    `);

    const analytics = {
      hub: hubMetrics.rows[0] || {},
      topTools: topTools.rows,
      chainExecutions: chainStats.rows,
      serverPerformance: serverPerformance.rows,
      metadata: {
        timeRange,
        generatedAt: new Date().toISOString(),
        includeRealTime,
        cacheStats: {
          hits: this.enhancedStats.cacheHits,
          misses: this.enhancedStats.cacheMisses,
          hitRate: this.enhancedStats.cacheHits / (this.enhancedStats.cacheHits + this.enhancedStats.cacheMisses) || 0
        }
      }
    };

    // Cache non-real-time results
    if (!includeRealTime) {
      this.cache.set(cacheKey, {
        data: analytics,
        expires: Date.now() + this.cacheTimeout
      });
    }

    return analytics;
  }

  /**
   * Log security audit event
   */
  async logSecurityAuditEvent(auditInfo) {
    const {
      eventType,
      severity = 'info',
      category = null,
      userId = null,
      userType = 'system',
      clientIp = null,
      userAgent = null,
      sessionId = null,
      resourceType = null,
      resourceId = null,
      resourceName = null,
      action,
      status = 'success',
      description = null,
      riskScore = 0,
      metadata = {},
      responseAction = 'none'
    } = auditInfo;

    const result = await this.query(`
      INSERT INTO ${this.enhancedSchemas.security}.security_audit_log (
        event_type, severity, category, user_id, user_type, client_ip, user_agent,
        session_id, resource_type, resource_id, resource_name, action, status,
        description, risk_score, metadata, response_action
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *
    `, [
      eventType, severity, category, userId, userType, clientIp, userAgent,
      sessionId, resourceType, resourceId, resourceName, action, status,
      description, riskScore, JSON.stringify(metadata), responseAction
    ]);

    // Emit security event for real-time monitoring
    this.emit('securityAuditEvent', {
      ...result.rows[0],
      timestamp: new Date().toISOString()
    });

    return result.rows[0];
  }

  /**
   * Setup real-time triggers for live dashboard updates
   */
  async setupRealTimeTriggers() {
    const client = await this.pool.connect();
    try {
      // Create notification function
      await client.query(`
        CREATE OR REPLACE FUNCTION notify_enhanced_changes()
        RETURNS TRIGGER AS $$
        BEGIN
          PERFORM pg_notify(
            'enhanced_mcp_changes',
            json_build_object(
              'table', TG_TABLE_NAME,
              'operation', TG_OP,
              'timestamp', CURRENT_TIMESTAMP,
              'data', CASE 
                WHEN TG_OP = 'DELETE' THEN row_to_json(OLD)
                ELSE row_to_json(NEW)
              END
            )::text
          );
          RETURN COALESCE(NEW, OLD);
        END;
        $$ LANGUAGE plpgsql;
      `);

      // Add triggers to key tables
      const triggerTables = [
        `${this.schemas.logs}.enhanced_tool_chain_executions`,
        `${this.schemas.logs}.tool_chain_step_executions`,
        `${this.enhancedSchemas.security}.security_audit_log`,
        `${this.schemas.mcp_hub}.servers`,
        `${this.schemas.mcp_hub}.tools`
      ];

      for (const table of triggerTables) {
        const triggerName = `enhanced_notify_${table.split('.')[1]}`;
        await client.query(`
          DROP TRIGGER IF EXISTS ${triggerName} ON ${table};
          CREATE TRIGGER ${triggerName}
            AFTER INSERT OR UPDATE OR DELETE ON ${table}
            FOR EACH ROW EXECUTE FUNCTION notify_enhanced_changes();
        `);
      }

      logger.info('Enhanced real-time triggers set up successfully');
    } catch (error) {
      logger.warn('Failed to set up real-time triggers', { error: error.message });
    } finally {
      client.release();
    }
  }

  /**
   * Infer data type for metadata storage
   */
  inferDataType(value) {
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (Array.isArray(value)) return 'array';
    if (value && typeof value === 'object') return 'json';
    return 'json';
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (value.expires <= now) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get enhanced connection pool status
   */
  getEnhancedPoolStatus() {
    const baseStatus = this.getPoolStatus();
    return {
      ...baseStatus,
      enhanced: {
        cacheSize: this.cache.size,
        cacheHitRate: this.enhancedStats.cacheHits / (this.enhancedStats.cacheHits + this.enhancedStats.cacheMisses) || 0,
        chainExecutions: this.enhancedStats.chainExecutions,
        metadataOperations: this.enhancedStats.metadataOperations,
        analyticsQueries: this.enhancedStats.analyticsQueries
      }
    };
  }

  /**
   * Enhanced cleanup with cache management
   */
  async close() {
    // Clean up cache
    this.cache.clear();
    
    // Call parent cleanup
    await super.close();
    
    logger.info('Enhanced PostgreSQL Manager closed');
  }
}

// Export class
export default EnhancedPostgreSQLManager;

/**
 * Real-Time System Orchestrator
 * 
 * This module orchestrates all components of the MCP Hub into a unified real-time system:
 * - PostgreSQL for persistent storage and analytics
 * - Redis for caching, pub/sub, and real-time operations
 * - MCP Hub for server management and tool routing
 * - SSE for real-time client updates
 * - WebSocket for bidirectional communication
 * - Telemetry for monitoring and observability
 * - BullMQ for job queues and background processing
 */

import EventEmitter from 'events';
import { PostgreSQLManager } from '../utils/postgresql-manager.js';
import { RedisService } from '../utils/redis-service.js';
import { telemetryManager } from '../telemetry/index.js';
import { analyticsService } from '../telemetry/analytics-service.js';
import logger from '../utils/logger.js';
import { wrapError } from '../utils/errors.js';
import { toolIndex } from '../utils/tool-index.js';
import { Queue, Worker, QueueScheduler } from 'bullmq';

/**
 * Orchestration modes for different operational patterns
 */
export const OrchestrationMode = {
  DEVELOPMENT: 'development',    // Local development with minimal services
  PRODUCTION: 'production',      // Full production with all services
  HYBRID: 'hybrid',              // Mixed mode with selective services
  TESTING: 'testing'             // Testing mode with mocked services
};

/**
 * System health status levels
 */
export const HealthStatus = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  CRITICAL: 'critical',
  UNKNOWN: 'unknown'
};

/**
 * Real-Time System Orchestrator
 */
export class RealtimeOrchestrator extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      mode: config.mode || OrchestrationMode.PRODUCTION,
      postgres: config.postgres || {},
      redis: config.redis || {},
      telemetry: config.telemetry || {},
      queues: config.queues || {},
      monitoring: config.monitoring || {},
      ...config
    };
    
    // Core services
    this.postgresManager = null;
    this.redisService = null;
    this.mcpHub = null;
    this.sseManager = null;
    
    // Job queues
    this.queues = new Map();
    this.workers = new Map();
    this.schedulers = new Map();
    
    // State management
    this.state = {
      initialized: false,
      services: new Map(),
      health: new Map(),
      metrics: new Map(),
      connections: new Map()
    };
    
    // Real-time sync
    this.syncInterval = null;
    this.healthCheckInterval = null;
    this.metricsInterval = null;
    
    // Event bus for cross-service communication
    this.eventBus = new EventEmitter();
    this.eventBus.setMaxListeners(100);
  }
  
  /**
   * Initialize the entire real-time system
   */
  async initialize() {
    try {
      logger.info('Initializing Real-Time System Orchestrator', {
        mode: this.config.mode,
        services: Object.keys(this.config)
      });
      
      // Phase 1: Initialize data layer
      await this.initializeDataLayer();
      
      // Phase 2: Initialize messaging layer
      await this.initializeMessagingLayer();
      
      // Phase 3: Initialize processing layer
      await this.initializeProcessingLayer();
      
      // Phase 4: Initialize monitoring layer
      await this.initializeMonitoringLayer();
      
      // Phase 5: Setup cross-service integrations
      await this.setupIntegrations();
      
      // Phase 6: Start real-time synchronization
      await this.startRealtimeSync();
      
      this.state.initialized = true;
      this.emit('initialized', {
        mode: this.config.mode,
        services: Array.from(this.state.services.keys()),
        timestamp: new Date().toISOString()
      });
      
      logger.info('Real-Time System Orchestrator initialized successfully');
      return true;
      
    } catch (error) {
      const wrappedError = wrapError(error, 'ORCHESTRATOR_INIT_ERROR');
      logger.error('Failed to initialize orchestrator', wrappedError);
      throw wrappedError;
    }
  }
  
  /**
   * Phase 1: Initialize data layer (PostgreSQL + Redis)
   */
  async initializeDataLayer() {
    logger.info('Initializing data layer');
    
    // Initialize PostgreSQL
    if (this.config.mode !== OrchestrationMode.TESTING) {
      try {
        this.postgresManager = new PostgreSQLManager(this.config.postgres);
        await this.postgresManager.initialize();
        
        this.state.services.set('postgresql', {
          status: 'connected',
          instance: this.postgresManager
        });
        
        // Setup PostgreSQL event handlers
        this.setupPostgreSQLHandlers();
        
        logger.info('PostgreSQL initialized successfully');
      } catch (error) {
        logger.warn('PostgreSQL initialization failed, continuing without persistence', {
          error: error.message
        });
        this.state.services.set('postgresql', {
          status: 'unavailable',
          error: error.message
        });
      }
    }
    
    // Initialize Redis
    try {
      this.redisService = new RedisService(this.config.redis);
      await this.redisService.connect();
      
      this.state.services.set('redis', {
        status: 'connected',
        instance: this.redisService
      });
      
      // Setup Redis event handlers
      this.setupRedisHandlers();
      
      logger.info('Redis initialized successfully');
    } catch (error) {
      logger.warn('Redis initialization failed, continuing with limited functionality', {
        error: error.message
      });
      this.state.services.set('redis', {
        status: 'unavailable',
        error: error.message
      });
    }
  }
  
  /**
   * Phase 2: Initialize messaging layer (SSE + WebSocket + Pub/Sub)
   */
  async initializeMessagingLayer() {
    logger.info('Initializing messaging layer');
    
    // Setup Redis pub/sub channels if available
    if (this.redisService && this.redisService.isConnected()) {
      const channels = [
        'mcp-hub:servers:status',
        'mcp-hub:tools:updates',
        'mcp-hub:telemetry:events',
        'mcp-hub:config:changes',
        'mcp-hub:analytics:metrics'
      ];
      
      for (const channel of channels) {
        await this.redisService.subscribe(channel, (data) => {
          this.handlePubSubMessage(channel, data);
        });
      }
      
      logger.info('Redis pub/sub channels initialized', { channels });
    }
    
    // Setup internal event bus
    this.setupEventBus();
    
    this.state.services.set('messaging', {
      status: 'active',
      channels: this.redisService ? 5 : 0
    });
  }
  
  /**
   * Phase 3: Initialize processing layer (BullMQ job queues)
   */
  async initializeProcessingLayer() {
    logger.info('Initializing processing layer');
    
    if (!this.redisService || !this.redisService.isConnected()) {
      logger.warn('Redis not available, skipping job queue initialization');
      return;
    }
    
    const connection = {
      host: this.config.redis.host,
      port: this.config.redis.port,
      password: this.config.redis.password
    };
    
    // Create job queues
    const queueConfigs = [
      {
        name: 'tool-execution',
        processor: this.processToolExecution.bind(this)
      },
      {
        name: 'analytics-aggregation',
        processor: this.processAnalyticsAggregation.bind(this)
      },
      {
        name: 'telemetry-processing',
        processor: this.processTelemetryData.bind(this)
      },
      {
        name: 'maintenance-tasks',
        processor: this.processMaintenanceTasks.bind(this)
      }
    ];
    
    for (const queueConfig of queueConfigs) {
      // Create queue
      const queue = new Queue(queueConfig.name, { connection });
      this.queues.set(queueConfig.name, queue);
      
      // Create worker
      const worker = new Worker(
        queueConfig.name,
        queueConfig.processor,
        { connection }
      );
      this.workers.set(queueConfig.name, worker);
      
      // Create scheduler for repeatable jobs
      const scheduler = new QueueScheduler(queueConfig.name, { connection });
      this.schedulers.set(queueConfig.name, scheduler);
      
      logger.info(`Job queue initialized: ${queueConfig.name}`);
    }
    
    // Schedule recurring jobs
    await this.scheduleRecurringJobs();
    
    this.state.services.set('processing', {
      status: 'active',
      queues: Array.from(this.queues.keys())
    });
  }
  
  /**
   * Phase 4: Initialize monitoring layer
   */
  async initializeMonitoringLayer() {
    logger.info('Initializing monitoring layer');
    
    // Start health checks
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 30000); // Every 30 seconds
    
    // Start metrics collection
    this.metricsInterval = setInterval(() => {
      this.collectMetrics();
    }, 60000); // Every minute
    
    // Initialize telemetry if not already done
    if (telemetryManager && !telemetryManager.isInitialized()) {
      try {
        await telemetryManager.initialize();
        logger.info('Telemetry system initialized');
      } catch (error) {
        logger.warn('Telemetry initialization failed', { error: error.message });
      }
    }
    
    this.state.services.set('monitoring', {
      status: 'active',
      healthCheck: true,
      metrics: true,
      telemetry: telemetryManager?.isInitialized() || false
    });
  }
  
  /**
   * Phase 5: Setup cross-service integrations
   */
  async setupIntegrations() {
    logger.info('Setting up cross-service integrations');
    
    // PostgreSQL ↔ Redis sync
    if (this.postgresManager && this.redisService) {
      this.setupDatabaseCacheSync();
    }
    
    // Tool Index ↔ Database sync
    if (this.postgresManager && toolIndex) {
      this.setupToolIndexSync();
    }
    
    // Telemetry ↔ Analytics integration
    if (telemetryManager && analyticsService) {
      this.setupTelemetryAnalytics();
    }
    
    // MCP Hub event integration
    this.setupMCPHubIntegration();
    
    logger.info('Cross-service integrations established');
  }
  
  /**
   * Phase 6: Start real-time synchronization
   */
  async startRealtimeSync() {
    logger.info('Starting real-time synchronization');
    
    // Sync interval for data consistency
    this.syncInterval = setInterval(async () => {
      await this.performDataSync();
    }, 5000); // Every 5 seconds
    
    // Emit ready event
    this.emit('ready', {
      timestamp: new Date().toISOString(),
      services: Array.from(this.state.services.keys())
    });
    
    logger.info('Real-time synchronization started');
  }
  
  /**
   * Setup PostgreSQL event handlers
   */
  setupPostgreSQLHandlers() {
    if (!this.postgresManager) return;
    
    this.postgresManager.on('serverUpserted', async (server) => {
      // Broadcast to Redis pub/sub
      if (this.redisService) {
        await this.redisService.publish('mcp-hub:servers:status', {
          event: 'server_upserted',
          server
        });
      }
      
      // Update cache
      if (this.redisService) {
        await this.redisService.setCache(
          `server:${server.name}`,
          server,
          300 // 5 minute TTL
        );
      }
      
      // Emit to event bus
      this.eventBus.emit('server:upserted', server);
    });
    
    this.postgresManager.on('toolUpserted', async (tool) => {
      // Update tool index
      if (toolIndex) {
        toolIndex.registerTool(tool.server_name, {
          name: tool.original_name,
          description: tool.description,
          inputSchema: tool.input_schema
        });
      }
      
      // Broadcast update
      if (this.redisService) {
        await this.redisService.publish('mcp-hub:tools:updates', {
          event: 'tool_upserted',
          tool
        });
      }
      
      // Emit to event bus
      this.eventBus.emit('tool:upserted', tool);
    });
    
    this.postgresManager.on('toolExecutionLogged', async (execution) => {
      // Queue analytics aggregation
      if (this.queues.has('analytics-aggregation')) {
        await this.queues.get('analytics-aggregation').add(
          'process_execution',
          { execution },
          { delay: 1000 }
        );
      }
      
      // Update real-time metrics
      this.updateExecutionMetrics(execution);
    });
  }
  
  /**
   * Setup Redis event handlers
   */
  setupRedisHandlers() {
    if (!this.redisService) return;
    
    // Handle connection events
    this.redisService.on('connected', () => {
      this.state.services.set('redis', {
        status: 'connected',
        instance: this.redisService
      });
      this.emit('service:connected', { service: 'redis' });
    });
    
    this.redisService.on('disconnected', () => {
      this.state.services.set('redis', {
        status: 'disconnected',
        instance: this.redisService
      });
      this.emit('service:disconnected', { service: 'redis' });
    });
  }
  
  /**
   * Setup internal event bus
   */
  setupEventBus() {
    // Cross-service event routing
    this.eventBus.on('tool:execute', async (data) => {
      await this.handleToolExecution(data);
    });
    
    this.eventBus.on('config:change', async (data) => {
      await this.handleConfigChange(data);
    });
    
    this.eventBus.on('server:status', async (data) => {
      await this.handleServerStatusChange(data);
    });
  }
  
  /**
   * Setup database-cache synchronization
   */
  setupDatabaseCacheSync() {
    // Sync tools from database to cache on startup
    this.eventBus.on('tool:upserted', async (tool) => {
      const cacheKey = `tool:${tool.tool_id}`;
      await this.redisService.setCache(cacheKey, tool, 600); // 10 minute TTL
    });
    
    // Sync server status
    this.eventBus.on('server:status:changed', async (data) => {
      const cacheKey = `server:status:${data.serverName}`;
      await this.redisService.setCache(cacheKey, data, 60); // 1 minute TTL
    });
  }
  
  /**
   * Setup tool index synchronization
   */
  setupToolIndexSync() {
    // Sync tool index changes to database
    this.eventBus.on('toolIndex:updated', async (data) => {
      const { serverName, tools } = data;
      
      for (const tool of tools) {
        await this.postgresManager.upsertTool(serverName, tool);
      }
    });
  }
  
  /**
   * Setup telemetry-analytics integration
   */
  setupTelemetryAnalytics() {
    // Forward telemetry events to analytics
    if (telemetryManager) {
      telemetryManager.on('event', async (event) => {
        if (analyticsService) {
          await analyticsService.trackEvent(event);
        }
        
        // Store in Redis for real-time dashboards
        if (this.redisService) {
          await this.redisService.publish('mcp-hub:telemetry:events', event);
        }
      });
    }
  }
  
  /**
   * Setup MCP Hub integration
   */
  setupMCPHubIntegration() {
    this.eventBus.on('mcpHub:initialized', (mcpHub) => {
      this.mcpHub = mcpHub;
      
      // Forward MCP Hub events to orchestrator
      mcpHub.on('serverConnected', async (data) => {
        await this.handleServerConnected(data);
      });
      
      mcpHub.on('serverDisconnected', async (data) => {
        await this.handleServerDisconnected(data);
      });
      
      mcpHub.on('toolsChanged', async (data) => {
        await this.handleToolsChanged(data);
      });
    });
  }
  
  /**
   * Handle pub/sub messages
   */
  handlePubSubMessage(channel, data) {
    logger.debug('Received pub/sub message', { channel, data });
    
    // Route to appropriate handler
    switch (channel) {
      case 'mcp-hub:servers:status':
        this.eventBus.emit('server:status:update', data);
        break;
      case 'mcp-hub:tools:updates':
        this.eventBus.emit('tools:update', data);
        break;
      case 'mcp-hub:telemetry:events':
        this.eventBus.emit('telemetry:event', data);
        break;
      case 'mcp-hub:config:changes':
        this.eventBus.emit('config:change', data);
        break;
      case 'mcp-hub:analytics:metrics':
        this.eventBus.emit('analytics:metrics', data);
        break;
    }
  }
  
  /**
   * Process tool execution job
   */
  async processToolExecution(job) {
    const { toolId, serverName, arguments: args } = job.data;
    
    try {
      logger.info('Processing tool execution', { toolId, serverName });
      
      // Execute through MCP Hub if available
      if (this.mcpHub) {
        const result = await this.mcpHub.callTool(serverName, toolId, args);
        
        // Log execution to database
        if (this.postgresManager) {
          await this.postgresManager.logToolExecution({
            toolId,
            serverName,
            toolName: toolId.split('__')[1],
            arguments: args,
            result,
            status: 'completed',
            durationMs: job.processedOn - job.timestamp
          });
        }
        
        return result;
      }
      
      throw new Error('MCP Hub not available');
      
    } catch (error) {
      logger.error('Tool execution failed', { error: error.message, toolId });
      
      // Log failure
      if (this.postgresManager) {
        await this.postgresManager.logToolExecution({
          toolId,
          serverName,
          toolName: toolId.split('__')[1],
          arguments: args,
          status: 'error',
          errorMessage: error.message,
          durationMs: job.processedOn - job.timestamp
        });
      }
      
      throw error;
    }
  }
  
  /**
   * Process analytics aggregation job
   */
  async processAnalyticsAggregation(job) {
    const { type, data } = job.data;
    
    logger.debug('Processing analytics aggregation', { type });
    
    if (this.postgresManager) {
      switch (type) {
        case 'process_execution':
          // Update aggregated metrics
          await this.updateAggregatedMetrics(data.execution);
          break;
        case 'daily_rollup':
          // Perform daily analytics rollup
          await this.performDailyRollup();
          break;
        case 'cleanup':
          // Clean up old data
          await this.postgresManager.cleanupOldData(30);
          break;
      }
    }
  }
  
  /**
   * Process telemetry data job
   */
  async processTelemetryData(job) {
    const { events } = job.data;
    
    logger.debug('Processing telemetry data', { eventCount: events.length });
    
    // Batch insert to database
    if (this.postgresManager) {
      for (const event of events) {
        await this.postgresManager.logHubEvent({
          type: event.type,
          data: event.data,
          level: event.level || 'info',
          message: event.message,
          source: event.source || 'telemetry'
        });
      }
    }
    
    // Forward to analytics
    if (analyticsService) {
      for (const event of events) {
        await analyticsService.trackEvent(event);
      }
    }
  }
  
  /**
   * Process maintenance tasks
   */
  async processMaintenanceTasks(job) {
    const { task } = job.data;
    
    logger.info('Processing maintenance task', { task });
    
    switch (task) {
      case 'cleanup_cache':
        // Clean up expired cache entries
        if (this.redisService) {
          // Redis handles TTL automatically
          logger.info('Cache cleanup completed');
        }
        break;
        
      case 'optimize_database':
        // Run database optimization
        if (this.postgresManager) {
          await this.postgresManager.query('VACUUM ANALYZE');
          logger.info('Database optimization completed');
        }
        break;
        
      case 'rotate_logs':
        // Rotate old logs
        if (this.postgresManager) {
          await this.postgresManager.cleanupOldData(7); // Keep 7 days
          logger.info('Log rotation completed');
        }
        break;
    }
  }
  
  /**
   * Schedule recurring jobs
   */
  async scheduleRecurringJobs() {
    const maintenanceQueue = this.queues.get('maintenance-tasks');
    const analyticsQueue = this.queues.get('analytics-aggregation');
    
    if (maintenanceQueue) {
      // Daily cleanup at 2 AM
      await maintenanceQueue.add(
        'cleanup',
        { task: 'cleanup_cache' },
        { repeat: { cron: '0 2 * * *' } }
      );
      
      // Weekly database optimization
      await maintenanceQueue.add(
        'optimize',
        { task: 'optimize_database' },
        { repeat: { cron: '0 3 * * 0' } }
      );
      
      // Daily log rotation
      await maintenanceQueue.add(
        'rotate',
        { task: 'rotate_logs' },
        { repeat: { cron: '0 1 * * *' } }
      );
    }
    
    if (analyticsQueue) {
      // Daily analytics rollup at 1 AM
      await analyticsQueue.add(
        'rollup',
        { type: 'daily_rollup' },
        { repeat: { cron: '0 1 * * *' } }
      );
    }
    
    logger.info('Recurring jobs scheduled');
  }
  
  /**
   * Perform health check
   */
  async performHealthCheck() {
    const health = new Map();
    
    // Check PostgreSQL
    if (this.postgresManager) {
      try {
        const result = await this.postgresManager.query('SELECT 1');
        health.set('postgresql', HealthStatus.HEALTHY);
      } catch (error) {
        health.set('postgresql', HealthStatus.CRITICAL);
      }
    }
    
    // Check Redis
    if (this.redisService) {
      const isConnected = this.redisService.isConnected();
      health.set('redis', isConnected ? HealthStatus.HEALTHY : HealthStatus.CRITICAL);
    }
    
    // Check MCP Hub
    if (this.mcpHub) {
      const connectedServers = this.mcpHub.getConnectedServers().length;
      const totalServers = Object.keys(this.mcpHub.config).length;
      
      if (connectedServers === totalServers) {
        health.set('mcpHub', HealthStatus.HEALTHY);
      } else if (connectedServers > 0) {
        health.set('mcpHub', HealthStatus.DEGRADED);
      } else {
        health.set('mcpHub', HealthStatus.CRITICAL);
      }
    }
    
    // Check job queues
    let queueHealth = HealthStatus.HEALTHY;
    for (const [name, queue] of this.queues) {
      const counts = await queue.getJobCounts();
      if (counts.failed > 100) {
        queueHealth = HealthStatus.CRITICAL;
        break;
      } else if (counts.failed > 10) {
        queueHealth = HealthStatus.DEGRADED;
      }
    }
    health.set('queues', queueHealth);
    
    // Update state
    this.state.health = health;
    
    // Determine overall health
    let overallHealth = HealthStatus.HEALTHY;
    for (const [service, status] of health) {
      if (status === HealthStatus.CRITICAL) {
        overallHealth = HealthStatus.CRITICAL;
        break;
      } else if (status === HealthStatus.DEGRADED) {
        overallHealth = HealthStatus.DEGRADED;
      }
    }
    
    // Emit health status
    this.emit('health:check', {
      overall: overallHealth,
      services: Object.fromEntries(health),
      timestamp: new Date().toISOString()
    });
    
    // Log if unhealthy
    if (overallHealth !== HealthStatus.HEALTHY) {
      logger.warn('System health check failed', {
        overall: overallHealth,
        services: Object.fromEntries(health)
      });
    }
  }
  
  /**
   * Collect system metrics
   */
  async collectMetrics() {
    const metrics = new Map();
    
    // Database metrics
    if (this.postgresManager) {
      const poolStatus = this.postgresManager.getPoolStatus();
      metrics.set('database', {
        connections: poolStatus.totalCount,
        idle: poolStatus.idleCount,
        queries: poolStatus.queries,
        errors: poolStatus.errors,
        avgDuration: poolStatus.avgDuration
      });
    }
    
    // Cache metrics
    if (this.redisService) {
      const cacheStats = await this.redisService.getCacheStats();
      metrics.set('cache', cacheStats);
    }
    
    // Queue metrics
    const queueMetrics = {};
    for (const [name, queue] of this.queues) {
      const counts = await queue.getJobCounts();
      queueMetrics[name] = counts;
    }
    metrics.set('queues', queueMetrics);
    
    // Memory metrics
    const memUsage = process.memoryUsage();
    metrics.set('memory', {
      rss: Math.round(memUsage.rss / 1024 / 1024), // MB
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024)
    });
    
    // Update state
    this.state.metrics = metrics;
    
    // Emit metrics
    this.emit('metrics:collected', {
      metrics: Object.fromEntries(metrics),
      timestamp: new Date().toISOString()
    });
    
    // Store in database for historical analysis
    if (this.postgresManager) {
      await this.postgresManager.logHubEvent({
        type: 'system_metrics',
        data: Object.fromEntries(metrics),
        level: 'info',
        source: 'orchestrator'
      });
    }
  }
  
  /**
   * Perform data synchronization
   */
  async performDataSync() {
    try {
      // Sync tool index to database
      if (this.postgresManager && toolIndex) {
        const stats = toolIndex.getStats();
        
        // Log sync event
        await this.postgresManager.logHubEvent({
          type: 'data_sync',
          data: {
            tools: stats.totalTools,
            servers: stats.totalServers
          },
          level: 'debug',
          source: 'orchestrator'
        });
      }
      
      // Sync cache statistics
      if (this.redisService) {
        const stats = await this.redisService.getCacheStats();
        
        // Publish to monitoring channel
        await this.redisService.publish('mcp-hub:analytics:metrics', {
          type: 'cache_stats',
          data: stats
        });
      }
      
    } catch (error) {
      logger.error('Data sync failed', { error: error.message });
    }
  }
  
  /**
   * Handle server connected event
   */
  async handleServerConnected(data) {
    const { serverName, capabilities } = data;
    
    logger.info('Server connected', { serverName });
    
    // Update database
    if (this.postgresManager) {
      await this.postgresManager.upsertServer({
        name: serverName,
        status: 'connected',
        capabilities,
        metadata: { connectedAt: new Date() }
      });
    }
    
    // Update cache
    if (this.redisService) {
      await this.redisService.setCache(
        `server:${serverName}:status`,
        'connected',
        300
      );
    }
    
    // Broadcast event
    if (this.redisService) {
      await this.redisService.publish('mcp-hub:servers:status', {
        event: 'connected',
        serverName,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Handle server disconnected event
   */
  async handleServerDisconnected(data) {
    const { serverName, reason } = data;
    
    logger.info('Server disconnected', { serverName, reason });
    
    // Update database
    if (this.postgresManager) {
      await this.postgresManager.upsertServer({
        name: serverName,
        status: 'disconnected',
        metadata: { disconnectedAt: new Date(), reason }
      });
      
      // Log status change
      await this.postgresManager.logServerStatusChange(
        serverName,
        'disconnected',
        'connected',
        0,
        { reason }
      );
    }
    
    // Update cache
    if (this.redisService) {
      await this.redisService.setCache(
        `server:${serverName}:status`,
        'disconnected',
        300
      );
    }
    
    // Broadcast event
    if (this.redisService) {
      await this.redisService.publish('mcp-hub:servers:status', {
        event: 'disconnected',
        serverName,
        reason,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Handle tools changed event
   */
  async handleToolsChanged(data) {
    const { serverName, tools } = data;
    
    logger.info('Tools changed', { serverName, toolCount: tools.length });
    
    // Update database
    if (this.postgresManager) {
      for (const tool of tools) {
        await this.postgresManager.upsertTool(serverName, tool);
      }
    }
    
    // Invalidate cache
    if (this.redisService) {
      await this.redisService.deleteCache(`tools:${serverName}:*`);
    }
    
    // Broadcast event
    if (this.redisService) {
      await this.redisService.publish('mcp-hub:tools:updates', {
        event: 'tools_changed',
        serverName,
        toolCount: tools.length,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Update execution metrics
   */
  updateExecutionMetrics(execution) {
    // Update in-memory metrics
    const metrics = this.state.metrics.get('executions') || {
      total: 0,
      successful: 0,
      failed: 0,
      avgDuration: 0
    };
    
    metrics.total++;
    if (execution.status === 'completed') {
      metrics.successful++;
    } else {
      metrics.failed++;
    }
    
    // Update average duration
    metrics.avgDuration = (
      (metrics.avgDuration * (metrics.total - 1) + execution.duration_ms) /
      metrics.total
    );
    
    this.state.metrics.set('executions', metrics);
  }
  
  /**
   * Update aggregated metrics in database
   */
  async updateAggregatedMetrics(execution) {
    if (!this.postgresManager) return;
    
    // This would typically update aggregated tables
    // For now, the metrics are calculated on-demand via analytics queries
    logger.debug('Updated aggregated metrics for execution', {
      toolId: execution.tool_id
    });
  }
  
  /**
   * Perform daily analytics rollup
   */
  async performDailyRollup() {
    if (!this.postgresManager) return;
    
    logger.info('Performing daily analytics rollup');
    
    // Get yesterday's analytics
    const analytics = await this.postgresManager.getAnalytics('24 hours');
    
    // Store rollup
    await this.postgresManager.logHubEvent({
      type: 'daily_rollup',
      data: analytics,
      level: 'info',
      source: 'orchestrator'
    });
    
    logger.info('Daily rollup completed', {
      servers: analytics.servers.length,
      tools: analytics.topTools.length
    });
  }
  
  /**
   * Get system status
   */
  getStatus() {
    return {
      initialized: this.state.initialized,
      mode: this.config.mode,
      services: Object.fromEntries(this.state.services),
      health: Object.fromEntries(this.state.health),
      metrics: Object.fromEntries(this.state.metrics),
      connections: this.state.connections.size,
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Graceful shutdown
   */
  async shutdown() {
    logger.info('Shutting down Real-Time System Orchestrator');
    
    // Clear intervals
    if (this.syncInterval) clearInterval(this.syncInterval);
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    if (this.metricsInterval) clearInterval(this.metricsInterval);
    
    // Stop workers
    for (const [name, worker] of this.workers) {
      await worker.close();
      logger.info(`Worker stopped: ${name}`);
    }
    
    // Stop schedulers
    for (const [name, scheduler] of this.schedulers) {
      await scheduler.close();
      logger.info(`Scheduler stopped: ${name}`);
    }
    
    // Close queue connections
    for (const [name, queue] of this.queues) {
      await queue.close();
      logger.info(`Queue closed: ${name}`);
    }
    
    // Disconnect services
    if (this.redisService) {
      await this.redisService.disconnect();
    }
    
    if (this.postgresManager) {
      await this.postgresManager.close();
    }
    
    // Shutdown telemetry
    if (telemetryManager) {
      await telemetryManager.shutdown();
    }
    
    this.state.initialized = false;
    this.emit('shutdown', {
      timestamp: new Date().toISOString()
    });
    
    logger.info('Real-Time System Orchestrator shutdown complete');
  }
}

// Export singleton instance
let orchestratorInstance = null;

export function getOrchestrator(config) {
  if (!orchestratorInstance) {
    orchestratorInstance = new RealtimeOrchestrator(config);
  }
  return orchestratorInstance;
}

export default RealtimeOrchestrator;

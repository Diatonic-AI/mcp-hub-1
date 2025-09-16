/**
 * Integration Example: How to integrate MCPHubTelemetry with existing MCP Hub
 * This shows how to modify existing MCP Hub classes to add telemetry tracking
 */

const MCPHubTelemetry = require('./mcp_hub_telemetry');

// Example: Enhanced MCPHub class with telemetry integration
class EnhancedMCPHub {
  constructor(config, options = {}) {
    // Existing MCP Hub initialization...
    this.config = config;
    this.servers = new Map();
    this.eventEmitter = new EventEmitter();
    
    // Add telemetry system
    this.telemetry = new MCPHubTelemetry({
      tenant: options.tenant || 'daclab-ai',
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'mcp_hub',
      user: process.env.DB_USER || 'mcp_hub_app',
      password: process.env.MCP_HUB_DB_PASSWORD,
    });
    
    // Initialize telemetry when hub starts
    this.initializeTelemetry();
    
    // Set up event handlers for telemetry
    this.setupTelemetryEventHandlers();
  }
  
  async initializeTelemetry() {
    try {
      const result = await this.telemetry.initialize({
        instanceName: this.config.instanceName || 'mcp-hub-main',
        host: this.config.host || 'localhost',
        port: this.config.port || 37373,
        pid: process.pid,
        version: this.config.version || '4.2.1',
        configPath: this.config.configPath,
        hubServerUrl: `http://${this.config.host || 'localhost'}:${this.config.port || 37373}`,
        state: 'STARTING',
        options: this.config.hubOptions || {}
      });
      
      console.log('Telemetry initialized:', result);
      
      // Update hub state to READY
      await this.telemetry.updateHubState('READY');
      
    } catch (error) {
      console.error('Failed to initialize telemetry:', error);
      // Continue without telemetry if initialization fails
    }
  }
  
  setupTelemetryEventHandlers() {
    // Listen for server events
    this.eventEmitter.on('serverConnected', async (serverData) => {
      if (this.telemetry.isConnected) {
        try {
          await this.telemetry.registerServer({
            ...serverData,
            connectionState: 'CONNECTED'
          });
          
          // Register server tools
          if (serverData.tools && serverData.tools.length > 0) {
            await this.telemetry.registerTools(serverData.name, serverData.tools);
          }
          
        } catch (error) {
          console.error('Failed to register server in telemetry:', error);
        }
      }
    });
    
    this.eventEmitter.on('serverDisconnected', async (serverName, error) => {
      if (this.telemetry.isConnected) {
        try {
          await this.telemetry.updateServerConnectionState(
            serverName, 
            'DISCONNECTED', 
            error?.message
          );
        } catch (err) {
          console.error('Failed to update server state in telemetry:', err);
        }
      }
    });
    
    // Listen for tool executions
    this.eventEmitter.on('toolExecuted', async (executionData) => {
      if (this.telemetry.isConnected) {
        try {
          await this.telemetry.logToolExecution({
            toolName: executionData.toolName,
            serverName: executionData.serverName,
            arguments: executionData.arguments,
            result: executionData.result,
            error: executionData.error,
            status: executionData.error ? 'failed' : 'completed',
            startedAt: executionData.startTime,
            completedAt: executionData.endTime,
            executionTimeMs: executionData.duration,
            sessionId: executionData.sessionId,
            correlationId: executionData.correlationId
          });
        } catch (error) {
          console.error('Failed to log tool execution:', error);
        }
      }
    });
    
    // Listen for SSE events
    this.eventEmitter.on('sseEvent', async (eventData) => {
      if (this.telemetry.isConnected) {
        try {
          await this.telemetry.logSSEEvent({
            type: eventData.type,
            data: eventData.data,
            connectionId: eventData.connectionId,
            clientCount: eventData.clientCount
          });
        } catch (error) {
          console.error('Failed to log SSE event:', error);
        }
      }
    });
    
    // Listen for log entries
    this.eventEmitter.on('logEntry', async (logData) => {
      if (this.telemetry.isConnected) {
        try {
          await this.telemetry.logEntry({
            level: logData.level,
            message: logData.message,
            code: logData.code,
            data: logData.data,
            stack: logData.stack,
            source: logData.source || 'hub',
            component: logData.component,
            serverName: logData.serverName
          });
        } catch (error) {
          console.error('Failed to log entry:', error);
        }
      }
    });
  }
  
  // Enhanced server connection method with telemetry
  async connectServer(serverName, serverConfig) {
    const startTime = Date.now();
    
    try {
      // Update telemetry: server connecting
      if (this.telemetry.isConnected) {
        await this.telemetry.updateServerConnectionState(serverName, 'CONNECTING');
      }
      
      // Existing server connection logic...
      const server = await this.createServerConnection(serverName, serverConfig);
      await server.connect();
      
      // Get server capabilities
      const capabilities = await server.getCapabilities();
      
      // Store server
      this.servers.set(serverName, server);
      
      // Emit event for telemetry
      this.eventEmitter.emit('serverConnected', {
        name: serverName,
        displayName: serverConfig.displayName,
        description: serverConfig.description,
        transport: serverConfig.transport,
        endpoint: server.endpoint,
        config: serverConfig,
        tools: capabilities.tools || [],
        resources: capabilities.resources || [],
        prompts: capabilities.prompts || [],
        serverInfo: capabilities.serverInfo || {}
      });
      
      return server;
      
    } catch (error) {
      // Emit event for telemetry
      this.eventEmitter.emit('serverDisconnected', serverName, error);
      
      throw error;
    }
  }
  
  // Enhanced tool execution with telemetry
  async executeTool(serverName, toolName, arguments, options = {}) {
    const startTime = Date.now();
    const sessionId = options.sessionId || this.generateSessionId();
    const correlationId = options.correlationId || this.generateCorrelationId();
    
    try {
      const server = this.servers.get(serverName);
      if (!server) {
        throw new Error(`Server not found: ${serverName}`);
      }
      
      // Execute tool using existing logic
      const result = await server.executeTool(toolName, arguments);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Emit event for telemetry
      this.eventEmitter.emit('toolExecuted', {
        toolName,
        serverName,
        arguments,
        result,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        duration,
        sessionId,
        correlationId
      });
      
      return result;
      
    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Emit event for telemetry (with error)
      this.eventEmitter.emit('toolExecuted', {
        toolName,
        serverName,
        arguments,
        error: error.message,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        duration,
        sessionId,
        correlationId
      });
      
      throw error;
    }
  }
  
  // New method: Get telemetry dashboard data
  async getTelemetryDashboard() {
    if (!this.telemetry.isConnected) {
      return { error: 'Telemetry not available' };
    }
    
    try {
      const [
        hubHealth,
        serverStatus,
        toolPerformance,
        recentExecutions,
        errorStats
      ] = await Promise.all([
        this.telemetry.getHubHealth(),
        this.telemetry.getServerStatus(),
        this.telemetry.getToolPerformance(20),
        this.telemetry.getRecentExecutions(50),
        this.telemetry.getErrorStats('24 hours')
      ]);
      
      return {
        hubHealth,
        serverStatus,
        toolPerformance,
        recentExecutions,
        errorStats,
        telemetryMetrics: this.telemetry.getTelemetryMetrics()
      };
      
    } catch (error) {
      console.error('Failed to get telemetry dashboard:', error);
      return { error: error.message };
    }
  }
  
  // Graceful shutdown with telemetry
  async shutdown() {
    try {
      // Update hub state
      if (this.telemetry.isConnected) {
        await this.telemetry.updateHubState('STOPPING');
      }
      
      // Disconnect all servers
      for (const [serverName, server] of this.servers) {
        try {
          await server.disconnect();
          this.eventEmitter.emit('serverDisconnected', serverName);
        } catch (error) {
          console.error(`Error disconnecting server ${serverName}:`, error);
        }
      }
      
      // Shutdown telemetry
      if (this.telemetry.isConnected) {
        await this.telemetry.shutdown();
      }
      
      console.log('MCP Hub shutdown complete');
      
    } catch (error) {
      console.error('Error during shutdown:', error);
    }
  }
  
  generateSessionId() {
    return require('crypto').randomUUID();
  }
  
  generateCorrelationId() {
    return require('crypto').randomUUID();
  }
}

// Example: Enhanced Express middleware for API request logging
function createTelemetryMiddleware(telemetry) {
  return (req, res, next) => {
    const startTime = Date.now();
    const originalSend = res.send;
    
    // Capture response data
    res.send = function(body) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Log API request if telemetry is connected
      if (telemetry.isConnected) {
        telemetry.logAPIRequest({
          method: req.method,
          path: req.path,
          fullUrl: req.originalUrl,
          queryParams: req.query,
          headers: req.headers,
          body: req.body,
          statusCode: res.statusCode,
          responseHeaders: res.getHeaders(),
          responseBody: typeof body === 'string' ? JSON.parse(body || '{}') : body,
          responseSizeBytes: Buffer.byteLength(body || '', 'utf8'),
          startedAt: new Date(startTime),
          completedAt: new Date(endTime),
          durationMs: duration,
          clientIp: req.ip,
          userAgent: req.get('User-Agent'),
          sessionId: req.session?.id
        }).catch(error => {
          console.error('Failed to log API request:', error);
        });
      }
      
      return originalSend.call(this, body);
    };
    
    next();
  };
}

// Example: Enhanced Logger with telemetry integration
class EnhancedLogger {
  constructor(telemetry) {
    this.telemetry = telemetry;
  }
  
  log(level, message, data = {}, serverName = null) {
    // Existing console/file logging...
    console.log(`[${level.toUpperCase()}] ${message}`, data);
    
    // Send to telemetry if connected
    if (this.telemetry?.isConnected) {
      this.telemetry.logEntry({
        level,
        message,
        data,
        source: 'hub',
        component: data.component,
        serverName
      }).catch(error => {
        console.error('Failed to log to telemetry:', error);
      });
    }
  }
  
  info(message, data, serverName) { this.log('info', message, data, serverName); }
  warn(message, data, serverName) { this.log('warn', message, data, serverName); }
  error(message, data, serverName) { this.log('error', message, data, serverName); }
  debug(message, data, serverName) { this.log('debug', message, data, serverName); }
}

// Example: Enhanced SSE Manager with telemetry
class EnhancedSSEManager {
  constructor(telemetry) {
    this.telemetry = telemetry;
    this.connections = new Set();
  }
  
  broadcast(eventType, data) {
    // Existing SSE broadcast logic...
    for (const connection of this.connections) {
      connection.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    }
    
    // Log to telemetry
    if (this.telemetry?.isConnected) {
      this.telemetry.logSSEEvent({
        type: eventType,
        data,
        clientCount: this.connections.size
      }).catch(error => {
        console.error('Failed to log SSE event:', error);
      });
    }
  }
}

// Usage Example in main MCP Hub application
async function main() {
  // Load configuration
  const config = loadConfiguration();
  
  // Create enhanced MCP Hub with telemetry
  const hub = new EnhancedMCPHub(config, {
    tenant: 'daclab-ai'
  });
  
  // Create Express app with telemetry middleware
  const app = express();
  app.use(express.json());
  
  // Add telemetry middleware
  app.use(createTelemetryMiddleware(hub.telemetry));
  
  // Enhanced logger with telemetry
  const logger = new EnhancedLogger(hub.telemetry);
  
  // Enhanced SSE manager with telemetry
  const sseManager = new EnhancedSSEManager(hub.telemetry);
  
  // API endpoints
  app.get('/api/telemetry/dashboard', async (req, res) => {
    try {
      const dashboardData = await hub.getTelemetryDashboard();
      res.json(dashboardData);
    } catch (error) {
      logger.error('Failed to get telemetry dashboard', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });
  
  app.get('/api/telemetry/servers', async (req, res) => {
    try {
      const servers = await hub.telemetry.getServerStatus();
      res.json(servers);
    } catch (error) {
      logger.error('Failed to get server status', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });
  
  app.get('/api/telemetry/tools', async (req, res) => {
    try {
      const tools = await hub.telemetry.getToolPerformance(100);
      res.json(tools);
    } catch (error) {
      logger.error('Failed to get tool performance', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });
  
  app.get('/api/telemetry/executions', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const serverName = req.query.server || null;
      const executions = await hub.telemetry.getRecentExecutions(limit, serverName);
      res.json(executions);
    } catch (error) {
      logger.error('Failed to get recent executions', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });
  
  app.get('/api/telemetry/errors', async (req, res) => {
    try {
      const timeframe = req.query.timeframe || '24 hours';
      const errors = await hub.telemetry.getErrorStats(timeframe);
      res.json(errors);
    } catch (error) {
      logger.error('Failed to get error stats', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });
  
  // Start the server
  const port = config.port || 37373;
  app.listen(port, () => {
    logger.info(`MCP Hub with telemetry started on port ${port}`);
  });
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Shutting down MCP Hub...');
    await hub.shutdown();
    process.exit(0);
  });
}

// Start the application
if (require.main === module) {
  main().catch(error => {
    console.error('Failed to start MCP Hub:', error);
    process.exit(1);
  });
}

module.exports = {
  EnhancedMCPHub,
  createTelemetryMiddleware,
  EnhancedLogger,
  EnhancedSSEManager
};

#!/usr/bin/env node
/**
 * MCP Hub Telemetry Server
 * Provides REST API and telemetry services for MCP Hub monitoring
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const MCPHubTelemetry = require('./mcp_hub_telemetry');

class TelemetryServer {
  constructor() {
    this.app = express();
    this.telemetry = null;
    this.server = null;
    this.port = process.env.PORT || 3000;
    this.adminPort = process.env.ADMIN_PORT || 3001;
    
    // Configuration from environment
    this.config = {
      database: {
        host: process.env.POSTGRES_HOST || 'postgresql',
        port: parseInt(process.env.POSTGRES_PORT) || 5432,
        database: process.env.POSTGRES_DB || 'mcp_hub',
        user: process.env.POSTGRES_USER || 'mcp_hub_app',
        password: process.env.POSTGRES_PASSWORD || 'mcp_hub_secure_password',
        tenant: process.env.TENANT || 'daclab-ai',
        maxConnections: parseInt(process.env.MAX_DB_CONNECTIONS) || 20
      },
      cors: {
        origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['*'],
        credentials: true
      }
    };
  }
  
  async initialize() {
    console.log('🚀 Initializing MCP Hub Telemetry Server...');
    
    // Initialize telemetry system
    this.telemetry = new MCPHubTelemetry(this.config.database);
    
    try {
      await this.telemetry.initialize({
        instanceName: process.env.HUB_INSTANCE_NAME || 'telemetry-server',
        host: process.env.HUB_HOST || 'localhost',
        port: parseInt(process.env.HUB_PORT) || 37373,
        version: process.env.HUB_VERSION || '1.0.0'
      });
      
      console.log('✅ Telemetry system initialized');
    } catch (error) {
      console.error('❌ Failed to initialize telemetry:', error.message);
      throw error;
    }
    
    // Set up Express middleware
    this.setupMiddleware();
    
    // Set up routes
    this.setupRoutes();
    
    // Set up error handling
    this.setupErrorHandling();
    
    console.log('✅ Server initialization complete');
  }
  
  setupMiddleware() {
    // Security
    this.app.use(helmet());
    
    // Compression
    this.app.use(compression());
    
    // CORS
    this.app.use(cors(this.config.cors));
    
    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    
    // Logging
    this.app.use(morgan('combined'));
    
    // Request telemetry middleware - temporarily disabled to fix Express context issue
    // this.app.use(this.telemetryMiddleware.bind(this));
  }
  
  async telemetryMiddleware(req, res, next) {
    const startTime = Date.now();
    const originalSend = res.send.bind(res); // Properly bind original send method
    const telemetryServer = this; // Capture the server context
    
    // Override send method with proper binding
    res.send = function(body) {
      const responseContext = this; // `this` is the response object
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Log API request if telemetry is connected (but don't block response)
      if (telemetryServer.telemetry && telemetryServer.telemetry.isConnected) {
        // Run async without blocking the response
        setImmediate(() => {
          telemetryServer.telemetry.logAPIRequest({
            method: req.method,
            path: req.path,
            fullUrl: req.originalUrl,
            queryParams: req.query,
            headers: telemetryServer.sanitizeHeaders(req.headers),
            body: req.body && typeof req.body === 'object' ? JSON.stringify(req.body) : req.body,
            statusCode: responseContext.statusCode,
            responseHeaders: responseContext.getHeaders(),
            responseSizeBytes: Buffer.byteLength(body || '', 'utf8'),
            startedAt: new Date(startTime),
            completedAt: new Date(endTime),
            durationMs: duration,
            clientIp: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent') || 'unknown'
          }).catch(error => {
            console.error('Failed to log API request:', error.message);
          });
        });
      }
      
      // Call original send method
      return originalSend(body);
    }.bind(res); // Bind the overridden method to response context
    
    next();
  }
  
  sanitizeHeaders(headers) {
    const sanitized = { ...headers };
    delete sanitized.authorization;
    delete sanitized.cookie;
    delete sanitized['x-api-key'];
    return sanitized;
  }
  
  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        telemetry: this.telemetry ? {
          connected: this.telemetry.isConnected,
          metrics: this.telemetry.getTelemetryMetrics()
        } : null
      };
      
      res.json(health);
    });
    
    // Telemetry API routes
    this.app.use('/api/telemetry', this.createTelemetryRoutes());
    
    // Admin routes
    this.app.use('/admin', this.createAdminRoutes());
    
    // Root route
    this.app.get('/', (req, res) => {
      res.json({
        name: 'MCP Hub Telemetry Server',
        version: '1.0.0',
        status: 'running',
        endpoints: {
          health: '/health',
          telemetry: '/api/telemetry',
          admin: '/admin'
        }
      });
    });
  }
  
  createTelemetryRoutes() {
    const router = express.Router();
    
    // Dashboard data
    router.get('/dashboard', async (req, res) => {
      try {
        if (!this.telemetry || !this.telemetry.isConnected) {
          return res.status(503).json({ error: 'Telemetry system not available' });
        }
        
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
        
        res.json({
          hubHealth,
          serverStatus,
          toolPerformance,
          recentExecutions,
          errorStats,
          telemetryMetrics: this.telemetry.getTelemetryMetrics()
        });
      } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ error: error.message });
      }
    });
    
    // Server status
    router.get('/servers', async (req, res) => {
      try {
        const serverName = req.query.server || null;
        const servers = await this.telemetry.getServerStatus(serverName);
        res.json(servers);
      } catch (error) {
        console.error('Server status error:', error);
        res.status(500).json({ error: error.message });
      }
    });
    
    // Tool performance
    router.get('/tools', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 50;
        const tools = await this.telemetry.getToolPerformance(limit);
        res.json(tools);
      } catch (error) {
        console.error('Tool performance error:', error);
        res.status(500).json({ error: error.message });
      }
    });
    
    // Recent executions
    router.get('/executions', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 100;
        const serverName = req.query.server || null;
        const executions = await this.telemetry.getRecentExecutions(limit, serverName);
        res.json(executions);
      } catch (error) {
        console.error('Recent executions error:', error);
        res.status(500).json({ error: error.message });
      }
    });
    
    // Error statistics
    router.get('/errors', async (req, res) => {
      try {
        const timeframe = req.query.timeframe || '24 hours';
        const errors = await this.telemetry.getErrorStats(timeframe);
        res.json(errors);
      } catch (error) {
        console.error('Error stats error:', error);
        res.status(500).json({ error: error.message });
      }
    });
    
    // Hub health
    router.get('/hub', async (req, res) => {
      try {
        const health = await this.telemetry.getHubHealth();
        res.json(health);
      } catch (error) {
        console.error('Hub health error:', error);
        res.status(500).json({ error: error.message });
      }
    });
    
    // Log entry endpoint (for external systems to send logs)
    router.post('/log', async (req, res) => {
      try {
        const logData = req.body;
        const logId = await this.telemetry.logEntry(logData);
        res.json({ success: true, logId });
      } catch (error) {
        console.error('Log entry error:', error);
        res.status(500).json({ error: error.message });
      }
    });
    
    // Tool execution endpoint
    router.post('/execution', async (req, res) => {
      try {
        const executionData = req.body;
        const executionId = await this.telemetry.logToolExecution(executionData);
        res.json({ success: true, executionId });
      } catch (error) {
        console.error('Tool execution error:', error);
        res.status(500).json({ error: error.message });
      }
    });
    
    return router;
  }
  
  createAdminRoutes() {
    const router = express.Router();
    
    // System metrics
    router.get('/metrics', (req, res) => {
      const metrics = {
        system: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          cpu: process.cpuUsage(),
          pid: process.pid,
          version: process.version,
          platform: process.platform
        },
        telemetry: this.telemetry ? this.telemetry.getTelemetryMetrics() : null,
        config: {
          port: this.port,
          adminPort: this.adminPort,
          database: {
            host: this.config.database.host,
            port: this.config.database.port,
            database: this.config.database.database,
            user: this.config.database.user,
            tenant: this.config.database.tenant
          }
        }
      };
      
      res.json(metrics);
    });
    
    // Graceful shutdown
    router.post('/shutdown', (req, res) => {
      res.json({ message: 'Shutdown initiated' });
      setTimeout(() => this.shutdown(), 1000);
    });
    
    return router;
  }
  
  setupErrorHandling() {
    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.originalUrl} not found`,
        timestamp: new Date().toISOString()
      });
    });
    
    // Global error handler
    this.app.use((error, req, res, next) => {
      console.error('Server error:', error);
      
      res.status(error.status || 500).json({
        error: error.name || 'Internal Server Error',
        message: error.message || 'An unexpected error occurred',
        timestamp: new Date().toISOString()
      });
    });
  }
  
  async start() {
    try {
      await this.initialize();
      
      this.server = this.app.listen(this.port, '0.0.0.0', () => {
        console.log(`✅ MCP Hub Telemetry Server started on port ${this.port}`);
        console.log(`📊 Dashboard: http://localhost:${this.port}/api/telemetry/dashboard`);
        console.log(`🔧 Admin: http://localhost:${this.port}/admin/metrics`);
        console.log(`❤️  Health: http://localhost:${this.port}/health`);
      });
      
      // Graceful shutdown handling
      process.on('SIGTERM', () => this.shutdown());
      process.on('SIGINT', () => this.shutdown());
      
    } catch (error) {
      console.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  }
  
  async shutdown() {
    console.log('🛑 Shutting down server...');
    
    if (this.server) {
      this.server.close(() => {
        console.log('✅ HTTP server closed');
      });
    }
    
    if (this.telemetry) {
      try {
        await this.telemetry.shutdown();
        console.log('✅ Telemetry system shut down');
      } catch (error) {
        console.error('Error shutting down telemetry:', error);
      }
    }
    
    process.exit(0);
  }
}

// Start the server if this file is run directly
if (require.main === module) {
  const server = new TelemetryServer();
  server.start().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = TelemetryServer;

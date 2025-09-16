#!/usr/bin/env node
/**
 * Minimal MCP Hub Telemetry Server - Debug Version
 * Stripped down to isolate Express context pollution issue
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const MCPHubTelemetry = require('./mcp_hub_telemetry');

class MinimalTelemetryServer {
  constructor() {
    this.app = express();
    this.telemetry = null;
    this.server = null;
    this.port = process.env.PORT || 3000;
    
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
    console.log('🚀 Initializing Minimal MCP Hub Telemetry Server...');
    
    // Initialize telemetry system
    this.telemetry = new MCPHubTelemetry(this.config.database);
    
    try {
      await this.telemetry.initialize({
        instanceName: process.env.HUB_INSTANCE_NAME || 'telemetry-server-minimal',
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
    
    // NO TELEMETRY MIDDLEWARE - COMPLETELY DISABLED FOR DEBUGGING
  }
  
  setupRoutes() {
    // Health check - absolutely minimal
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
      });
    });
    
    // Root route
    this.app.get('/', (req, res) => {
      res.json({
        name: 'MCP Hub Telemetry Server - Minimal',
        version: '1.0.0',
        status: 'running'
      });
    });
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
        console.log(`✅ Minimal MCP Hub Telemetry Server started on port ${this.port}`);
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
  const server = new MinimalTelemetryServer();
  server.start().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = MinimalTelemetryServer;

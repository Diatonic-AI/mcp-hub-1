#!/usr/bin/env node

const express = require('express');
const { EnhancedMCPHub, createTelemetryMiddleware } = require('./mcp_hub_integration_example');

async function runDemo() {
  console.log('🚀 Starting MCP Hub Telemetry Integration Demo');
  
  // Mock configuration for demo
  const config = {
    instanceName: 'demo-hub',
    host: 'localhost',
    port: 37374, // Use different port for demo
    version: '1.0.0-demo',
    hubOptions: {
      metaOnly: false,
      lazyLoad: true
    }
  };
  
  try {
    // Create enhanced MCP Hub with telemetry
    const hub = new EnhancedMCPHub(config, {
      tenant: 'demo-tenant'
    });
    
    // Create Express app for demo API
    const app = express();
    app.use(express.json());
    
    // Add telemetry middleware
    app.use(createTelemetryMiddleware(hub.telemetry));
    
    // Demo API endpoints
    app.get('/api/demo/status', (req, res) => {
      res.json({
        status: 'running',
        timestamp: new Date().toISOString(),
        message: 'MCP Hub Telemetry Demo is operational'
      });
    });
    
    app.get('/api/demo/telemetry', async (req, res) => {
      try {
        const dashboard = await hub.getTelemetryDashboard();
        res.json(dashboard);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Start server
    app.listen(config.port, () => {
      console.log(`✅ Demo server started on port ${config.port}`);
      console.log(`📊 Telemetry dashboard: http://localhost:${config.port}/api/demo/telemetry`);
      console.log('Press Ctrl+C to stop');
    });
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down demo...');
      await hub.shutdown();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Demo failed to start:', error);
    process.exit(1);
  }
}

runDemo();

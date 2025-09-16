#!/usr/bin/env node

const MCPHubTelemetry = require('../src/mcp_hub_telemetry');

async function testConnection() {
  const telemetry = new MCPHubTelemetry({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: process.env.POSTGRES_PORT || 5432,
    database: process.env.POSTGRES_DB || 'mcp_hub',
    user: process.env.DB_USER || 'mcp_hub_app',
    password: process.env.MCP_HUB_DB_PASSWORD,
    tenant: 'test-tenant'
  });
  
  try {
    console.log('Testing telemetry database connection...');
    
    const result = await telemetry.initialize({
      instanceName: 'test-hub',
      host: 'localhost',
      port: 37373,
      version: '1.0.0'
    });
    
    console.log('Connection test successful:', result);
    
    // Test basic operations
    const hubHealth = await telemetry.getHubHealth();
    console.log('Hub health:', hubHealth);
    
    const metrics = telemetry.getTelemetryMetrics();
    console.log('Telemetry metrics:', metrics);
    
    await telemetry.shutdown();
    console.log('Connection test completed successfully');
    
  } catch (error) {
    console.error('Connection test failed:', error);
    process.exit(1);
  }
}

testConnection();

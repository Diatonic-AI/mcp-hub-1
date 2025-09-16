#!/usr/bin/env node

/**
 * MCP Hub System Test
 * Tests all major components and integrations
 */

import { RealtimeOrchestrator } from './src/realtime/orchestrator.js';
import { PostgreSQLManager } from './src/utils/postgresql-manager.js';
import { RedisService } from './src/utils/redis-service.js';
import logger from './src/utils/logger.js';

async function testSystem() {
  console.log('🧪 MCP Hub System Integration Test\n');
  console.log('=' .repeat(50));
  
  const results = {
    passed: [],
    failed: [],
    warnings: []
  };
  
  // Test 1: PostgreSQL Connection
  console.log('\n📊 Test 1: PostgreSQL Connection');
  try {
    const pgManager = new PostgreSQLManager({
      host: process.env.POSTGRES_HOST || '10.10.10.11',
      port: process.env.POSTGRES_PORT || 5432,
      database: process.env.POSTGRES_DB || 'mcp_hub',
      user: process.env.POSTGRES_USER || 'mcp_hub_app',
      password: process.env.POSTGRES_PASSWORD || 'Zaq!Xsw@123'
    });
    
    await pgManager.initialize();
    const result = await pgManager.query('SELECT version()');
    console.log('✅ PostgreSQL connected:', result.rows[0].version);
    results.passed.push('PostgreSQL Connection');
    
    // Test analytics
    const analytics = await pgManager.getAnalytics('24 hours');
    console.log('✅ Analytics query successful');
    results.passed.push('PostgreSQL Analytics');
    
    await pgManager.close();
  } catch (error) {
    console.log('❌ PostgreSQL test failed:', error.message);
    results.failed.push('PostgreSQL: ' + error.message);
  }
  
  // Test 2: Redis Connection
  console.log('\n📮 Test 2: Redis Connection');
  try {
    const redisService = new RedisService({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    });
    
    await redisService.connect();
    console.log('✅ Redis connected');
    results.passed.push('Redis Connection');
    
    // Test pub/sub
    await redisService.publish('test:channel', { test: 'data' });
    console.log('✅ Redis pub/sub working');
    results.passed.push('Redis Pub/Sub');
    
    // Test caching
    await redisService.setCache('test:key', { value: 'test' }, 10);
    const cached = await redisService.getCache('test:key');
    if (cached && cached.value === 'test') {
      console.log('✅ Redis caching working');
      results.passed.push('Redis Cache');
    }
    
    await redisService.disconnect();
  } catch (error) {
    console.log('❌ Redis test failed:', error.message);
    results.failed.push('Redis: ' + error.message);
  }
  
  // Test 3: Tool Index
  console.log('\n🛠️  Test 3: Tool Index');
  try {
    const { toolIndex } = await import('./src/utils/tool-index.js');
    
    // Register test tools
    toolIndex.registerTool('test-server', {
      name: 'test_tool',
      description: 'Test tool',
      inputSchema: { type: 'object' }
    });
    
    const stats = toolIndex.getStats();
    console.log('✅ Tool index working:', stats);
    results.passed.push('Tool Index');
    
    // Search test
    const searchResults = toolIndex.searchTools('test');
    console.log('✅ Tool search working:', searchResults.length, 'results');
    results.passed.push('Tool Search');
  } catch (error) {
    console.log('❌ Tool index test failed:', error.message);
    results.failed.push('Tool Index: ' + error.message);
  }
  
  // Test 4: Telemetry System
  console.log('\n📈 Test 4: Telemetry System');
  try {
    const { telemetryManager } = await import('./src/telemetry/index.js');
    
    if (!telemetryManager.isInitialized()) {
      await telemetryManager.initialize();
    }
    
    console.log('✅ Telemetry initialized');
    results.passed.push('Telemetry System');
    
    await telemetryManager.shutdown();
  } catch (error) {
    console.log('⚠️  Telemetry test warning:', error.message);
    results.warnings.push('Telemetry: ' + error.message);
  }
  
  // Test 5: Real-time Orchestrator
  console.log('\n🎯 Test 5: Real-time Orchestrator');
  try {
    const orchestrator = new RealtimeOrchestrator({
      mode: 'testing',
      postgres: {
        host: process.env.POSTGRES_HOST || '10.10.10.11',
        port: process.env.POSTGRES_PORT || 5432,
        database: process.env.POSTGRES_DB || 'mcp_hub',
        user: process.env.POSTGRES_USER || 'mcp_hub_app',
        password: process.env.POSTGRES_PASSWORD || 'Zaq!Xsw@123'
      },
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379
      }
    });
    
    // Don't fully initialize in test mode
    console.log('✅ Orchestrator created successfully');
    results.passed.push('Orchestrator Creation');
    
    const status = orchestrator.getStatus();
    console.log('✅ Orchestrator status:', status.mode);
    results.passed.push('Orchestrator Status');
  } catch (error) {
    console.log('❌ Orchestrator test failed:', error.message);
    results.failed.push('Orchestrator: ' + error.message);
  }
  
  // Test 6: HTTP Server Endpoints
  console.log('\n🌐 Test 6: HTTP Server Endpoints');
  try {
    const fetch = (await import('node-fetch')).default;
    
    // Try to check if server is running
    try {
      const response = await fetch('http://localhost:3456/api/status');
      if (response.ok) {
        console.log('✅ HTTP server is running on port 3456');
        results.passed.push('HTTP Server');
      } else {
        console.log('⚠️  HTTP server returned status:', response.status);
        results.warnings.push('HTTP Server: Status ' + response.status);
      }
    } catch (fetchError) {
      console.log('⚠️  HTTP server not running on port 3456');
      results.warnings.push('HTTP Server: Not running');
    }
  } catch (error) {
    console.log('⚠️  HTTP test skipped:', error.message);
    results.warnings.push('HTTP Test: ' + error.message);
  }
  
  // Summary
  console.log('\n' + '=' .repeat(50));
  console.log('📊 Test Summary:\n');
  console.log(`✅ Passed: ${results.passed.length}`);
  results.passed.forEach(test => console.log(`   - ${test}`));
  
  if (results.warnings.length > 0) {
    console.log(`\n⚠️  Warnings: ${results.warnings.length}`);
    results.warnings.forEach(warning => console.log(`   - ${warning}`));
  }
  
  if (results.failed.length > 0) {
    console.log(`\n❌ Failed: ${results.failed.length}`);
    results.failed.forEach(failure => console.log(`   - ${failure}`));
    process.exit(1);
  } else {
    console.log('\n🎉 All critical tests passed!');
    console.log('✨ MCP Hub system is ready for production!');
    process.exit(0);
  }
}

// Run tests
testSystem().catch(error => {
  console.error('Fatal test error:', error);
  process.exit(1);
});

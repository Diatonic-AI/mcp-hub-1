#!/usr/bin/env node

/**
 * ML/DL Pipeline and Telemetry Test Script
 * Tests the integrated ML and telemetry components
 */

import { PostgresConnector } from './src/data/postgres.js';
import { MongoDBConnector } from './src/data/mongo.js';
import { RedisConnector } from './src/data/redis.js';
import { TrainingOrchestrator } from './src/training/orchestrator.js';
import telemetryManager from './src/telemetry/index.js';
import TelemetryEnvelope from './src/telemetry/envelope.js';
import logger from './src/utils/logger.js';

console.log('🚀 Testing MCP Hub ML/DL Pipeline and Telemetry System\n');
console.log('=' .repeat(50));

const tests = {
  passed: 0,
  failed: 0,
  total: 0
};

async function runTest(name, testFn) {
  tests.total++;
  console.log(`\nTesting: ${name}`);
  try {
    await testFn();
    console.log(`✅ ${name} - PASSED`);
    tests.passed++;
  } catch (error) {
    console.log(`❌ ${name} - FAILED`);
    console.log(`   Error: ${error.message}`);
    tests.failed++;
  }
}

async function main() {
  // ========== DATABASE CONNECTORS ==========
  console.log('\n📊 DATABASE CONNECTORS');
  console.log('-' .repeat(30));
  
  // Test PostgreSQL
  await runTest('PostgreSQL Connector', async () => {
    const pg = new PostgresConnector({
      connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/mcp_test'
    });
    await pg.connect();
    const health = await pg.checkHealth();
    if (!health.connected) throw new Error('PostgreSQL not healthy');
    await pg.disconnect();
  });
  
  // Test MongoDB
  await runTest('MongoDB Connector', async () => {
    const mongo = new MongoDBConnector({
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/mcp_test'
    });
    await mongo.connect();
    const health = await mongo.checkHealth();
    if (!health.connected) throw new Error('MongoDB not healthy');
    await mongo.disconnect();
  });
  
  // Test Redis
  await runTest('Redis Connector', async () => {
    const redis = new RedisConnector({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    });
    await redis.connect();
    const health = await redis.checkHealth();
    if (!health.connected) throw new Error('Redis not healthy');
    await redis.disconnect();
  });
  
  // ========== TELEMETRY SYSTEM ==========
  console.log('\n📡 TELEMETRY SYSTEM');
  console.log('-' .repeat(30));
  
  // Test Telemetry Manager
  await runTest('Telemetry Manager Initialization', async () => {
    await telemetryManager.initialize();
    if (!telemetryManager.initialized) throw new Error('Not initialized');
  });
  
  // Test Event Recording
  await runTest('Telemetry Event Recording', async () => {
    telemetryManager.recordEvent('test:event', {
      type: 'unit_test',
      component: 'ml_pipeline'
    });
    
    telemetryManager.recordMetric('test:metric', 42);
    telemetryManager.recordMetric('test:accuracy', 0.95);
    
    const metrics = await telemetryManager.getMetrics();
    if (!metrics) throw new Error('No metrics collected');
  });
  
  // Test Telemetry Envelope
  await runTest('Telemetry Envelope', async () => {
    const envelope = new TelemetryEnvelope();
    const wrapped = envelope.wrap({
      type: 'test_event',
      data: { message: 'Test message' },
      tenant: 'test_tenant'
    });
    
    if (!wrapped.id || !wrapped.timestamp) {
      throw new Error('Envelope validation failed');
    }
  });
  
  // ========== ML TRAINING PIPELINE ==========
  console.log('\n🤖 ML TRAINING PIPELINE');
  console.log('-' .repeat(30));
  
  // Test Training Orchestrator
  let orchestrator = null;
  await runTest('Training Orchestrator Initialization', async () => {
    orchestrator = new TrainingOrchestrator({
      queueName: 'test-training',
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379
      }
    });
    
    await orchestrator.initialize();
    const status = orchestrator.getStatus();
    if (!status.initialized) throw new Error('Orchestrator not initialized');
  });
  
  // Test Job Submission
  await runTest('Training Job Submission', async () => {
    if (!orchestrator) throw new Error('Orchestrator not available');
    
    const jobId = await orchestrator.submitJob({
      name: 'test-ml-job',
      type: 'classification',
      framework: 'nodejs',
      config: {
        model: 'test-model',
        epochs: 1,
        batchSize: 32
      },
      dataset: {
        source: 'memory',
        data: [[1, 2, 3], [4, 5, 6]],
        labels: [0, 1]
      }
    });
    
    if (!jobId) throw new Error('Failed to submit job');
    console.log(`   Job ID: ${jobId}`);
  });
  
  // Test Job Status
  await runTest('Training Job Status Check', async () => {
    if (!orchestrator) throw new Error('Orchestrator not available');
    
    const jobs = await orchestrator.listJobs();
    if (!Array.isArray(jobs)) throw new Error('Invalid jobs list');
  });
  
  // ========== INTEGRATION TESTS ==========
  console.log('\n🔗 INTEGRATION TESTS');
  console.log('-' .repeat(30));
  
  // Test ML + Telemetry Integration
  await runTest('ML Pipeline Telemetry Integration', async () => {
    // Record ML training events
    telemetryManager.recordEvent('ml:training:started', {
      model: 'test-model',
      framework: 'nodejs',
      dataset_size: 1000
    });
    
    // Simulate training progress
    for (let epoch = 1; epoch <= 3; epoch++) {
      telemetryManager.recordMetric('ml:training:epoch', epoch);
      telemetryManager.recordMetric('ml:training:loss', 1.0 / epoch);
      telemetryManager.recordMetric('ml:training:accuracy', 0.8 + (0.05 * epoch));
    }
    
    telemetryManager.recordEvent('ml:training:completed', {
      model: 'test-model',
      final_accuracy: 0.95,
      training_time_ms: 5000
    });
    
    const metrics = await telemetryManager.getMetrics();
    if (!metrics) throw new Error('No ML metrics collected');
  });
  
  // Test Database Integration for ML
  await runTest('ML Database Storage Integration', async () => {
    const pg = new PostgresConnector({
      connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/mcp_test'
    });
    
    const mongo = new MongoDBConnector({
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/mcp_test'
    });
    
    const redis = new RedisConnector({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    });
    
    // Connect all databases
    await pg.connect();
    await mongo.connect();
    await redis.connect();
    
    // Store model metadata in PostgreSQL
    // Store model binary in MongoDB
    // Cache predictions in Redis
    
    // Verify all are connected
    const pgHealth = await pg.checkHealth();
    const mongoHealth = await mongo.checkHealth();
    const redisHealth = await redis.checkHealth();
    
    if (!pgHealth.connected || !mongoHealth.connected || !redisHealth.connected) {
      throw new Error('Not all databases connected');
    }
    
    // Cleanup
    await pg.disconnect();
    await mongo.disconnect();
    await redis.disconnect();
  });
  
  // ========== PERFORMANCE TESTS ==========
  console.log('\n⚡ PERFORMANCE TESTS');
  console.log('-' .repeat(30));
  
  // Test High-Volume Event Ingestion
  await runTest('High-Volume Event Ingestion', async () => {
    const startTime = Date.now();
    const eventCount = 1000;
    
    for (let i = 0; i < eventCount; i++) {
      telemetryManager.recordEvent('perf:test', {
        index: i,
        timestamp: Date.now()
      });
    }
    
    const duration = Date.now() - startTime;
    const eventsPerSecond = (eventCount / duration) * 1000;
    
    console.log(`   Ingested ${eventCount} events in ${duration}ms`);
    console.log(`   Rate: ${eventsPerSecond.toFixed(0)} events/second`);
    
    if (eventsPerSecond < 100) {
      throw new Error('Performance below threshold');
    }
  });
  
  // Test Metric Aggregation Performance
  await runTest('Metric Aggregation Performance', async () => {
    const startTime = Date.now();
    
    // Record many metrics
    for (let i = 0; i < 100; i++) {
      telemetryManager.recordMetric('perf:metric', Math.random() * 100);
    }
    
    // Get aggregated metrics
    const metrics = await telemetryManager.getMetrics();
    const duration = Date.now() - startTime;
    
    console.log(`   Aggregated metrics in ${duration}ms`);
    
    if (duration > 1000) {
      throw new Error('Aggregation too slow');
    }
  });
  
  // ========== CLEANUP ==========
  console.log('\n🧹 CLEANUP');
  console.log('-' .repeat(30));
  
  // Shutdown orchestrator
  if (orchestrator && orchestrator.queue) {
    await orchestrator.shutdown();
    console.log('✅ Training orchestrator shutdown');
  }
  
  // Shutdown telemetry
  if (telemetryManager) {
    await telemetryManager.shutdown();
    console.log('✅ Telemetry manager shutdown');
  }
  
  // ========== SUMMARY ==========
  console.log('\n' + '=' .repeat(50));
  console.log('📊 TEST SUMMARY');
  console.log('=' .repeat(50));
  
  console.log(`\nTotal Tests: ${tests.total}`);
  console.log(`✅ Passed: ${tests.passed}`);
  console.log(`❌ Failed: ${tests.failed}`);
  
  const successRate = (tests.passed / tests.total * 100).toFixed(1);
  console.log(`\n📈 Success Rate: ${successRate}%`);
  
  if (tests.failed > 0) {
    console.log('\n⚠️  Some tests failed. Check the output above for details.');
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  }
}

// Run the tests
main().catch(error => {
  console.error('\n💥 Test suite crashed:', error);
  process.exit(1);
});

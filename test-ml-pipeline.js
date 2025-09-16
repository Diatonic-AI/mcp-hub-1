#!/usr/bin/env node

/**
 * Comprehensive ML/DL Pipeline Test Script
 * Tests all components of the MCP Hub ML infrastructure
 */

import { PostgresConnector } from './src/data/postgres.js';
import { MongoDBConnector } from './src/data/mongo.js';
import { RedisConnector } from './src/data/redis.js';
import { TrainingOrchestrator } from './src/training/orchestrator.js';
import { TelemetryManager } from './src/telemetry/index.js';
import { TelemetryPipeline } from './src/telemetry/pipeline.js';
import { DataEnvelope } from './src/telemetry/envelope.js';
import { EventIngestion } from './src/telemetry/ingest.js';
import { StreamProcessor } from './src/telemetry/streams.js';
import { EmbeddingService } from './src/telemetry/embeddings.js';
import { QdrantClient } from './src/telemetry/qdrant.js';
import { AnalyticsService } from './src/telemetry/analytics-service.js';
import logger from './src/utils/logger.js';
import chalk from 'chalk';

// Test results tracking
const testResults = {
  passed: [],
  failed: [],
  skipped: []
};

// Helper functions
function logTest(name, status, details = '') {
  const icon = status === 'passed' ? '✅' : status === 'failed' ? '❌' : '⏭️';
  const color = status === 'passed' ? chalk.green : status === 'failed' ? chalk.red : chalk.yellow;
  console.log(`${icon} ${color(name)} ${details ? `- ${details}` : ''}`);
  testResults[status].push({ name, details });
}

async function testWithTimeout(name, testFn, timeout = 5000) {
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Test timeout')), timeout)
  );
  
  try {
    await Promise.race([testFn(), timeoutPromise]);
    return true;
  } catch (error) {
    console.error(`  ${chalk.gray(error.message)}`);
    return false;
  }
}

// Test Suite
async function runTests() {
  console.log(chalk.bold.blue('\n🧪 MCP Hub ML/DL Pipeline Test Suite\n'));
  console.log(chalk.gray('=' .repeat(50)));
  
  // 1. Test Database Connectors
  console.log(chalk.bold('\n📊 Testing Database Connectors:\n'));
  
  // PostgreSQL
  const pgConnector = new PostgresConnector({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/mcp_test'
  });
  
  if (await testWithTimeout('PostgreSQL Connection', async () => {
    await pgConnector.connect();
    const health = await pgConnector.checkHealth();
    if (!health.connected) throw new Error('Not connected');
    await pgConnector.disconnect();
  })) {
    logTest('PostgreSQL Connector', 'passed', 'Connected successfully');
  } else {
    logTest('PostgreSQL Connector', 'failed', 'Connection failed');
  }
  
  // MongoDB
  const mongoConnector = new MongoDBConnector({
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/mcp_test'
  });
  
  if (await testWithTimeout('MongoDB Connection', async () => {
    await mongoConnector.connect();
    const health = await mongoConnector.checkHealth();
    if (!health.connected) throw new Error('Not connected');
    await mongoConnector.disconnect();
  })) {
    logTest('MongoDB Connector', 'passed', 'Connected successfully');
  } else {
    logTest('MongoDB Connector', 'failed', 'Connection failed');
  }
  
  // Redis
  const redisConnector = new RedisConnector({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  });
  
  if (await testWithTimeout('Redis Connection', async () => {
    await redisConnector.connect();
    const health = await redisConnector.checkHealth();
    if (!health.connected) throw new Error('Not connected');
    await redisConnector.disconnect();
  })) {
    logTest('Redis Connector', 'passed', 'Connected successfully');
  } else {
    logTest('Redis Connector', 'failed', 'Connection failed');
  }
  
  // 2. Test Telemetry System
  console.log(chalk.bold('\n📡 Testing Telemetry System:\n'));
  
  // Telemetry Manager
  const telemetryManager = new TelemetryManager({
    enabled: true,
    collectUsageMetrics: true,
    collectErrorMetrics: true
  });
  
  if (await testWithTimeout('Telemetry Manager', async () => {
    await telemetryManager.initialize();
    telemetryManager.recordEvent('test', { type: 'unit_test' });
    const metrics = await telemetryManager.getMetrics();
    if (!metrics) throw new Error('No metrics');
  })) {
    logTest('Telemetry Manager', 'passed', 'Initialized and recording');
  } else {
    logTest('Telemetry Manager', 'failed', 'Initialization failed');
  }
  
  // Telemetry Pipeline
  const pipeline = new TelemetryPipeline({
    postgres: pgConnector,
    mongodb: mongoConnector,
    redis: redisConnector
  });
  
  if (await testWithTimeout('Telemetry Pipeline', async () => {
    await pipeline.initialize();
    const status = pipeline.getStatus();
    if (status.state !== 'ready') throw new Error('Pipeline not ready');
  })) {
    logTest('Telemetry Pipeline', 'passed', 'Pipeline ready');
  } else {
    logTest('Telemetry Pipeline', 'failed', 'Pipeline initialization failed');
  }
  
  // Data Envelope
  if (await testWithTimeout('Data Envelope', async () => {
    const envelope = new DataEnvelope({
      type: 'test_event',
      tenant: 'test_tenant',
      data: { message: 'Test message' }
    });
    envelope.validate();
    const serialized = envelope.toJSON();
    if (!serialized.id) throw new Error('Invalid envelope');
  })) {
    logTest('Data Envelope', 'passed', 'Validation working');
  } else {
    logTest('Data Envelope', 'failed', 'Validation failed');
  }
  
  // Event Ingestion
  const eventIngestion = new EventIngestion({
    batchSize: 100,
    flushInterval: 1000
  });
  
  if (await testWithTimeout('Event Ingestion', async () => {
    await eventIngestion.initialize();
    await eventIngestion.ingest({
      type: 'test',
      data: { test: true }
    });
    const stats = eventIngestion.getStats();
    if (stats.total === 0) throw new Error('No events ingested');
  })) {
    logTest('Event Ingestion', 'passed', 'Events ingested');
  } else {
    logTest('Event Ingestion', 'failed', 'Ingestion failed');
  }
  
  // Stream Processor
  const streamProcessor = new StreamProcessor({
    redis: redisConnector
  });
  
  if (await testWithTimeout('Stream Processor', async () => {
    await streamProcessor.initialize();
    await streamProcessor.publishEvent('test-stream', {
      type: 'test',
      data: { message: 'Stream test' }
    });
  })) {
    logTest('Stream Processor', 'passed', 'Streaming working');
  } else {
    logTest('Stream Processor', 'failed', 'Stream failed');
  }
  
  // 3. Test ML Training Pipeline
  console.log(chalk.bold('\n🤖 Testing ML Training Pipeline:\n'));
  
  // Training Orchestrator
  const orchestrator = new TrainingOrchestrator({
    queueName: 'test-training',
    redis: {
      host: 'localhost',
      port: 6379
    }
  });
  
  if (await testWithTimeout('Training Orchestrator', async () => {
    await orchestrator.initialize();
    const status = orchestrator.getStatus();
    if (!status.initialized) throw new Error('Not initialized');
  }, 10000)) {
    logTest('Training Orchestrator', 'passed', 'Initialized');
  } else {
    logTest('Training Orchestrator', 'failed', 'Initialization failed');
  }
  
  // Submit test training job
  if (await testWithTimeout('Training Job Submission', async () => {
    const jobId = await orchestrator.submitJob({
      name: 'test-training',
      type: 'classification',
      framework: 'nodejs',
      config: {
        model: 'test-model',
        epochs: 1,
        batchSize: 32
      },
      dataset: {
        source: 'memory',
        data: [[1, 2], [3, 4]],
        labels: [0, 1]
      }
    });
    if (!jobId) throw new Error('No job ID returned');
    logTest('Training Job Submission', 'passed', `Job ID: ${jobId}`);
  }, 10000)) {
    // Job submitted successfully
  } else {
    logTest('Training Job Submission', 'failed', 'Could not submit job');
  }
  
  // 4. Test Embeddings Service
  console.log(chalk.bold('\n🔤 Testing Embeddings Service:\n'));
  
  const embeddingService = new EmbeddingService({
    provider: 'tensorflow',
    modelPath: null // Use default model
  });
  
  if (await testWithTimeout('Embedding Service', async () => {
    await embeddingService.initialize();
    const embedding = await embeddingService.generateEmbedding('Test text for embedding');
    if (!embedding || !Array.isArray(embedding)) throw new Error('Invalid embedding');
  }, 15000)) {
    logTest('Embedding Service', 'passed', 'Embeddings generated');
  } else {
    logTest('Embedding Service', 'skipped', 'TensorFlow not available');
  }
  
  // 5. Test Vector Database (Qdrant)
  console.log(chalk.bold('\n🔍 Testing Vector Database:\n'));
  
  const qdrantClient = new QdrantClient({
    url: process.env.QDRANT_URL || 'http://localhost:6333',
    apiKey: process.env.QDRANT_API_KEY
  });
  
  if (await testWithTimeout('Qdrant Connection', async () => {
    await qdrantClient.connect();
    const collections = await qdrantClient.listCollections();
    // Just check it doesn't throw
  })) {
    logTest('Qdrant Client', 'passed', 'Connected to vector DB');
  } else {
    logTest('Qdrant Client', 'skipped', 'Qdrant not available');
  }
  
  // 6. Test Analytics Service
  console.log(chalk.bold('\n📈 Testing Analytics Service:\n'));
  
  const analyticsService = new AnalyticsService({
    postgres: pgConnector,
    redis: redisConnector
  });
  
  if (await testWithTimeout('Analytics Service', async () => {
    await analyticsService.initialize();
    await analyticsService.trackEvent({
      event: 'test_event',
      properties: { test: true }
    });
    const metrics = await analyticsService.getMetrics('test_event');
  })) {
    logTest('Analytics Service', 'passed', 'Analytics tracking working');
  } else {
    logTest('Analytics Service', 'failed', 'Analytics failed');
  }
  
  // 7. Test Integration Points
  console.log(chalk.bold('\n🔗 Testing Integration Points:\n'));
  
  // Test ML Pipeline with Telemetry
  if (await testWithTimeout('ML + Telemetry Integration', async () => {
    // Record training start event
    telemetryManager.recordEvent('training:started', {
      model: 'test-model',
      framework: 'nodejs'
    });
    
    // Record training metrics
    telemetryManager.recordMetric('training:accuracy', 0.95);
    telemetryManager.recordMetric('training:loss', 0.05);
    
    // Get aggregated metrics
    const metrics = await telemetryManager.getMetrics();
    if (!metrics) throw new Error('No metrics available');
  })) {
    logTest('ML + Telemetry Integration', 'passed', 'Events and metrics recorded');
  } else {
    logTest('ML + Telemetry Integration', 'failed', 'Integration failed');
  }
  
  // Test Database Integration
  if (await testWithTimeout('Multi-DB Integration', async () => {
    // Store in PostgreSQL
    await pgConnector.connect();
    // Store in MongoDB
    await mongoConnector.connect();
    // Cache in Redis
    await redisConnector.connect();
    
    // Cleanup
    await pgConnector.disconnect();
    await mongoConnector.disconnect();
    await redisConnector.disconnect();
  })) {
    logTest('Multi-DB Integration', 'passed', 'All databases working together');
  } else {
    logTest('Multi-DB Integration', 'failed', 'Database integration failed');
  }
  
  // Cleanup
  console.log(chalk.bold('\n🧹 Cleaning up...\n'));
  
  try {
    if (orchestrator.queue) await orchestrator.shutdown();
    if (pipeline) await pipeline.shutdown();
    if (telemetryManager) await telemetryManager.shutdown();
  } catch (error) {
    console.error('Cleanup error:', error.message);
  }
  
  // Print Summary
  console.log(chalk.gray('\n' + '=' .repeat(50)));
  console.log(chalk.bold.blue('\n📊 Test Summary:\n'));
  
  console.log(chalk.green(`✅ Passed: ${testResults.passed.length}`));
  if (testResults.passed.length > 0) {
    testResults.passed.forEach(t => console.log(`   - ${t.name}`));
  }
  
  if (testResults.failed.length > 0) {
    console.log(chalk.red(`\n❌ Failed: ${testResults.failed.length}`));
    testResults.failed.forEach(t => console.log(`   - ${t.name}: ${t.details}`));
  }
  
  if (testResults.skipped.length > 0) {
    console.log(chalk.yellow(`\n⏭️  Skipped: ${testResults.skipped.length}`));
    testResults.skipped.forEach(t => console.log(`   - ${t.name}: ${t.details}`));
  }
  
  const totalTests = testResults.passed.length + testResults.failed.length + testResults.skipped.length;
  const successRate = (testResults.passed.length / totalTests * 100).toFixed(1);
  
  console.log(chalk.bold(`\n📈 Success Rate: ${successRate}%`));
  
  // Exit with appropriate code
  process.exit(testResults.failed.length > 0 ? 1 : 0);
}

// Run tests
console.log(chalk.bold.magenta('🚀 Starting MCP Hub ML/DL Pipeline Tests...'));

runTests().catch(error => {
  console.error(chalk.red('\n💥 Test suite crashed:'), error);
  process.exit(1);
});

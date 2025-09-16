#!/usr/bin/env node
/**
 * Diagnostic test for MCP Hub ML/DL Pipeline
 * Tests database connectivity, telemetry flow, and training pipeline
 */

import pg from 'pg';
import { MongoClient } from 'mongodb';
import redis from 'redis';
import { v4 as uuidv4 } from 'uuid';

const { Pool } = pg;

// Configuration from environment
const config = {
  postgres: {
    host: process.env.POSTGRES_HOST || '10.10.10.11',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'mcp_hub',
    user: process.env.POSTGRES_USER || 'mcp_hub_app',
    password: process.env.POSTGRES_PASSWORD || 'mcp_hub_secure_password'
  },
  mongodb: {
    url: process.env.MONGODB_URI || 'mongodb://10.10.10.13:27017/mcp_hub_mcp_hub'
  },
  redis: {
    host: process.env.REDIS_HOST || '10.10.10.14',
    port: parseInt(process.env.REDIS_PORT || '6379')
  }
};

async function testPostgreSQL() {
  console.log('\n🔍 Testing PostgreSQL Connection...');
  const pool = new Pool(config.postgres);
  
  try {
    // Test connection
    const versionResult = await pool.query('SELECT version()');
    console.log('✅ PostgreSQL connected:', versionResult.rows[0].version);
    
    // Check ML tables
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('training_runs', 'model_registry', 'experiments', 'mcp_servers', 'mcp_tools')
      ORDER BY table_name
    `);
    console.log('📊 ML Tables found:', tablesResult.rows.map(r => r.table_name).join(', '));
    
    // Check telemetry schema
    const telemetryResult = await pool.query(`
      SELECT COUNT(*) as table_count
      FROM information_schema.tables 
      WHERE table_schema = 'telemetry'
    `);
    console.log('📈 Telemetry tables:', telemetryResult.rows[0].table_count);
    
    // Insert test server registration
    console.log('\n📝 Attempting to register test server...');
    const serverResult = await pool.query(`
      INSERT INTO mcp_servers (
        id, name, display_name, description, endpoint, 
        transport_type, status, tool_count
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8
      ) 
      ON CONFLICT (name) DO UPDATE 
      SET status = EXCLUDED.status,
          tool_count = EXCLUDED.tool_count
      RETURNING id, name, status
    `, [
      uuidv4(),
      'diagnostic-test-server',
      'Diagnostic Test Server',
      'Test server for ML/DL pipeline verification',
      'stdio://diagnostic',
      'stdio',
      'active',
      5
    ]);
    console.log('✅ Test server registered:', serverResult.rows[0]);
    
    // Insert test telemetry event
    console.log('\n📊 Inserting test telemetry event...');
    const telemetryEventResult = await pool.query(`
      INSERT INTO telemetry.events (
        id, event_type, event_name, source_system, 
        tenant_id, data, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7
      ) RETURNING id, event_type
    `, [
      uuidv4(),
      'diagnostic.test',
      'Pipeline Test Event',
      'diagnostic-script',
      'test-tenant',
      JSON.stringify({ test: true, timestamp: new Date().toISOString() }),
      JSON.stringify({ version: '1.0.0' })
    ]);
    console.log('✅ Telemetry event inserted:', telemetryEventResult.rows[0]);
    
    // Check counts
    const countsResult = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM mcp_servers) as servers,
        (SELECT COUNT(*) FROM mcp_tools) as tools,
        (SELECT COUNT(*) FROM training_runs) as training_runs,
        (SELECT COUNT(*) FROM telemetry.events) as telemetry_events
    `);
    console.log('\n📊 Database Status:');
    console.log('  - MCP Servers:', countsResult.rows[0].servers);
    console.log('  - MCP Tools:', countsResult.rows[0].tools);
    console.log('  - Training Runs:', countsResult.rows[0].training_runs);
    console.log('  - Telemetry Events:', countsResult.rows[0].telemetry_events);
    
    return true;
  } catch (error) {
    console.error('❌ PostgreSQL test failed:', error.message);
    return false;
  } finally {
    await pool.end();
  }
}

async function testMongoDB() {
  console.log('\n🔍 Testing MongoDB Connection...');
  const client = new MongoClient(config.mongodb.url);
  
  try {
    await client.connect();
    console.log('✅ MongoDB connected');
    
    const db = client.db();
    const collections = await db.listCollections().toArray();
    console.log('📁 Collections:', collections.map(c => c.name).join(', ') || 'none');
    
    return true;
  } catch (error) {
    console.error('❌ MongoDB test failed:', error.message);
    return false;
  } finally {
    await client.close();
  }
}

async function testRedis() {
  console.log('\n🔍 Testing Redis Connection...');
  const client = redis.createClient({
    socket: {
      host: config.redis.host,
      port: config.redis.port
    }
  });
  
  try {
    await client.connect();
    console.log('✅ Redis connected');
    
    // Check telemetry streams
    const streamLength = await client.xLen('telemetry:raw');
    console.log('📊 Telemetry stream length:', streamLength);
    
    // Add test event to stream
    const eventId = await client.xAdd('telemetry:raw', '*', {
      id: uuidv4(),
      type: 'diagnostic.test',
      timestamp: Date.now().toString(),
      data: JSON.stringify({ test: true })
    });
    console.log('✅ Test event added to stream:', eventId);
    
    // Check BullMQ queues
    const trainingQueueKeys = await client.keys('bull:ml-training:*');
    console.log('🎯 Training queue keys:', trainingQueueKeys.length);
    
    return true;
  } catch (error) {
    console.error('❌ Redis test failed:', error.message);
    return false;
  } finally {
    await client.quit();
  }
}

async function testTrainingPipeline() {
  console.log('\n🔍 Testing Training Pipeline...');
  const pool = new Pool(config.postgres);
  
  try {
    // Insert test training run
    const runResult = await pool.query(`
      INSERT INTO training_runs (
        id, tenant_id, run_name, model_name, model_version,
        framework, status, config, hyperparameters
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      ) RETURNING id, model_name, status
    `, [
      uuidv4(),
      'test-tenant',
      'diagnostic-test-run',
      'diagnostic-model',
      '1.0.0',
      'pytorch',
      'succeeded',
      JSON.stringify({ batch_size: 32, epochs: 10 }),
      JSON.stringify({ learning_rate: 0.001, optimizer: 'adam' })
    ]);
    console.log('✅ Test training run created:', runResult.rows[0]);
    
    // Insert test model registry entry
    const modelResult = await pool.query(`
      INSERT INTO model_registry (
        id, name, version, tenant_id, stage,
        framework, metrics, description
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8
      ) RETURNING id, name, version
    `, [
      uuidv4(),
      'diagnostic-model',
      `1.0.${Date.now()}`,
      'test-tenant',
      'development',
      'pytorch',
      JSON.stringify({ accuracy: 0.95, loss: 0.05 }),
      'Test model for ML/DL pipeline verification'
    ]);
    console.log('✅ Model registered:', modelResult.rows[0]);
    
    return true;
  } catch (error) {
    console.error('❌ Training pipeline test failed:', error.message);
    return false;
  } finally {
    await pool.end();
  }
}

async function runDiagnostics() {
  console.log('🚀 Starting MCP Hub ML/DL Pipeline Diagnostics');
  console.log('================================================\n');
  
  const results = {
    postgresql: await testPostgreSQL(),
    mongodb: await testMongoDB(),
    redis: await testRedis(),
    training: await testTrainingPipeline()
  };
  
  console.log('\n\n📋 DIAGNOSTIC SUMMARY');
  console.log('====================');
  console.log(`PostgreSQL: ${results.postgresql ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`MongoDB: ${results.mongodb ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Redis: ${results.redis ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Training Pipeline: ${results.training ? '✅ PASS' : '❌ FAIL'}`);
  
  const allPassed = Object.values(results).every(r => r);
  
  if (allPassed) {
    console.log('\n🎉 All diagnostics PASSED! The ML/DL pipeline is functional.');
  } else {
    console.log('\n⚠️  Some diagnostics FAILED. Review the output above for details.');
  }
  
  process.exit(allPassed ? 0 : 1);
}

// Run diagnostics
runDiagnostics().catch(error => {
  console.error('Fatal error:', error);
  process.exit(2);
});

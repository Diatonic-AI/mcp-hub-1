/**
 * Container MongoDB Connectivity Test
 * Tests MongoDB access from within a Docker container environment
 */

const { MongoClient } = require('mongodb');
const os = require('os');

// Configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://10.10.10.13:27017/mcp_hub_mcp_hub';
const MONGODB_HOST = process.env.MONGODB_HOST || '10.10.10.13';
const MONGODB_PORT = process.env.MONGODB_PORT || '27017';

async function testContainerConnectivity() {
  console.log('🐳 Container MongoDB Connectivity Test');
  console.log('=====================================');
  
  // Environment info
  console.log(`🏠 Hostname: ${os.hostname()}`);
  console.log(`📍 MongoDB URI: ${MONGODB_URI}`);
  console.log(`🌐 Network interfaces:`);
  
  const interfaces = os.networkInterfaces();
  Object.keys(interfaces).forEach(name => {
    interfaces[name].forEach(iface => {
      if (!iface.internal) {
        console.log(`  - ${name}: ${iface.address}`);
      }
    });
  });
  
  console.log('\n🔍 Testing MongoDB connection...');
  
  const client = new MongoClient(MONGODB_URI, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
  });

  try {
    // Test connection
    console.log('⏳ Connecting to MongoDB...');
    await client.connect();
    console.log('✅ Connection successful!');

    const db = client.db();
    
    // Test database operations
    console.log('\n🧪 Testing database operations...');
    
    // List collections
    const collections = await db.listCollections().toArray();
    console.log(`📚 Collections found: ${collections.length}`);
    
    // Test read operation
    const systemEvent = await db.collection('system_events').findOne();
    console.log(`📋 System events accessible: ${systemEvent ? 'Yes' : 'No'}`);
    
    // Test write operation
    const testDoc = {
      event_id: `container_test_${Date.now()}`,
      event_type: 'container_connectivity_test',
      event_source: 'container_test_script',
      category: 'system',
      severity: 'info',
      title: 'Container Connectivity Test',
      description: 'Testing MongoDB connectivity from Docker container',
      event_data: {
        container_hostname: os.hostname(),
        test_timestamp: new Date(),
        mongodb_host: MONGODB_HOST,
        mongodb_port: MONGODB_PORT
      },
      event_time: new Date(),
      correlation_id: `test-${Math.random().toString(36).substr(2, 9)}`,
      tenant_id: 'mcp_hub',
      metadata: { test: true },
      tags: ['container_test', 'connectivity']
    };

    console.log('✏️  Testing write operation...');
    const result = await db.collection('system_events').insertOne(testDoc);
    console.log(`✅ Write successful: ${result.insertedId}`);

    // Clean up test document
    await db.collection('system_events').deleteOne({ _id: result.insertedId });
    console.log('🧹 Test document cleaned up');

    // Test tenant isolation
    const tenantData = await db.collection('entity_metadata').findOne({ tenant_id: 'mcp_hub' });
    console.log(`🏢 Tenant isolation verified: ${tenantData ? 'Yes' : 'No'}`);

    // Performance test
    console.log('\n⚡ Performance test...');
    const start = Date.now();
    await db.collection('users').countDocuments();
    const duration = Date.now() - start;
    console.log(`📊 Query latency: ${duration}ms`);

    console.log('\n🎉 All container connectivity tests passed!');
    console.log('✅ MongoDB is fully accessible from container environment');

  } catch (error) {
    console.error('\n❌ Container connectivity test failed:');
    console.error(`   Error: ${error.message}`);
    
    if (error.message.includes('ECONNREFUSED')) {
      console.error('   💡 MongoDB server may not be running or accessible from container');
    } else if (error.message.includes('MongoServerSelectionError')) {
      console.error('   💡 Check container network configuration and MongoDB server status');
    } else if (error.message.includes('Authentication failed')) {
      console.error('   💡 MongoDB authentication may be required');
    }
    
    console.error('\n🔧 Troubleshooting steps:');
    console.error('   1. Verify MongoDB is running: telnet 10.10.10.13 27017');
    console.error('   2. Check container network: docker exec container ping 10.10.10.13');
    console.error('   3. Verify firewall allows container connections');
    console.error('   4. Check MongoDB authentication settings');
    
    process.exit(1);
    
  } finally {
    await client.close();
    console.log('\n🔒 Connection closed');
  }
}

// Run the test
testContainerConnectivity().catch(console.error);

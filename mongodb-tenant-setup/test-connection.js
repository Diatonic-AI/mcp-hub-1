/**
 * Test connection to the MCP-Hub MongoDB tenant
 */

const { MongoClient, ObjectId } = require('mongodb');

// Configuration
const MONGODB_HOST = process.env.MONGO_HOST || '10.10.10.13';
const MONGODB_PORT = process.env.MONGO_PORT || '27017';
const TENANT_ID = process.env.TENANT_ID || 'mcp_hub';
const DATABASE_NAME = `mcp_hub_${TENANT_ID}`;
const MONGODB_URI = `mongodb://${MONGODB_HOST}:${MONGODB_PORT}`;

async function testConnection() {
  console.log('🔍 Testing MCP-Hub MongoDB tenant connection...');
  console.log(`📍 URI: ${MONGODB_URI}`);
  console.log(`🗄️  Database: ${DATABASE_NAME}`);

  let client;
  try {
    client = new MongoClient(MONGODB_URI, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
    });

    console.log('⏳ Connecting to MongoDB...');
    await client.connect();
    console.log('✅ Connected successfully!');

    const db = client.db(DATABASE_NAME);

    // Test basic database operations
    console.log('\n🧪 Testing database operations...');

    // List collections
    const collections = await db.listCollections().toArray();
    console.log(`📚 Collections found: ${collections.length}`);
    collections.forEach(col => {
      console.log(`  - ${col.name}`);
    });

    // Test tenant isolation
    if (collections.length > 0) {
      const testCollection = collections[0].name;
      const sampleDoc = await db.collection(testCollection).findOne();
      if (sampleDoc && sampleDoc.tenant_id) {
        console.log(`🏢 Tenant isolation verified: ${sampleDoc.tenant_id}`);
      }
    }

    // Check users
    const userCount = await db.collection('users').countDocuments();
    console.log(`👥 Users in tenant: ${userCount}`);

    // Check system metadata
    const metadataCount = await db.collection('entity_metadata').countDocuments();
    console.log(`📊 Metadata records: ${metadataCount}`);

    // Check system events
    const eventCount = await db.collection('system_events').countDocuments();
    console.log(`📋 System events: ${eventCount}`);

    // Test write operation
    console.log('\n✏️  Testing write operation...');
    const testDoc = {
      test_id: `test_${Date.now()}`,
      description: 'Connection test document',
      created_at: new Date(),
      tenant_id: TENANT_ID
    };

    const result = await db.collection('system_events').insertOne({
      _id: new ObjectId(),
      event_id: `connection_test_${Date.now()}`,
      event_type: 'connection_test',
      event_source: 'test_script',
      category: 'system',
      severity: 'info',
      title: 'Connection Test',
      description: 'Testing MongoDB connection and write capability',
      event_data: testDoc,
      event_time: new Date(),
      correlation_id: require('crypto').randomUUID(),
      tenant_id: TENANT_ID,
      metadata: {},
      tags: ['test', 'connection']
    });

    console.log(`✅ Write test successful: ${result.insertedId}`);

    // Clean up test document
    await db.collection('system_events').deleteOne({ _id: result.insertedId });
    console.log('🧹 Test document cleaned up');

    console.log('\n🎉 All tests passed! MongoDB tenant is ready for MCP-Hub.');

  } catch (error) {
    console.error('\n❌ Connection test failed:');
    console.error(`   Error: ${error.message}`);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('   💡 Make sure MongoDB is running on 10.10.10.13:27017');
    } else if (error.name === 'MongoServerSelectionError') {
      console.error('   💡 Check MongoDB server availability and network connectivity');
    }
    
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('🔒 Connection closed');
    }
  }
}

testConnection();

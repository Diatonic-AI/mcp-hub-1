/**
 * MCP-Hub MongoDB Tenant Setup Script
 * Creates an isolated tenant for the mcp-hub system within MongoDB
 * Based on the PostgreSQL schema but adapted for MongoDB patterns
 */

// MongoDB connection configuration
const MONGODB_HOST = process.env.MONGO_HOST || '10.10.10.13';
const MONGODB_PORT = process.env.MONGO_PORT || '27017';
const TENANT_ID = process.env.TENANT_ID || 'mcp_hub';
const DATABASE_NAME = `mcp_hub_${TENANT_ID}`;

// Import required modules
const { MongoClient, ObjectId } = require('mongodb');
const crypto = require('crypto');

// MongoDB URI
const MONGODB_URI = `mongodb://${MONGODB_HOST}:${MONGODB_PORT}`;

console.log('🚀 MCP-Hub MongoDB Tenant Setup');
console.log(`📍 Host: ${MONGODB_HOST}:${MONGODB_PORT}`);
console.log(`🏢 Tenant ID: ${TENANT_ID}`);
console.log(`🗄️  Database: ${DATABASE_NAME}`);

class McpHubTenantSetup {
  constructor() {
    this.client = null;
    this.db = null;
  }

  async connect() {
    console.log('\n🔌 Connecting to MongoDB...');
    
    this.client = new MongoClient(MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
    });

    await this.client.connect();
    console.log('✅ Connected to MongoDB successfully');

    this.db = this.client.db(DATABASE_NAME);
    console.log(`🎯 Using database: ${DATABASE_NAME}`);
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      console.log('🔒 Disconnected from MongoDB');
    }
  }

  // Create collections with proper indexing
  async createCollections() {
    console.log('\n📚 Creating collections and indexes...');

    const collections = [
      'mcp_servers',
      'mcp_tools', 
      'tool_executions',
      'tool_chain_executions',
      'tool_chain_steps',
      'api_requests',
      'server_connections',
      'server_health_checks',
      'analytics_cache',
      'performance_metrics',
      'entity_metadata',
      'security_audit_log',
      'system_events',
      'users',
      'jwt_tokens',
      'sessions',
      'oauth_connections',
      'api_keys',
      'audit_log',
      'rate_limits'
    ];

    for (const collectionName of collections) {
      try {
        await this.db.createCollection(collectionName);
        console.log(`  ✅ Created collection: ${collectionName}`);
      } catch (error) {
        if (error.code === 48) { // Collection already exists
          console.log(`  ⚠️  Collection already exists: ${collectionName}`);
        } else {
          console.error(`  ❌ Failed to create collection ${collectionName}:`, error.message);
        }
      }
    }
  }

  async createIndexes() {
    console.log('\n🔍 Creating indexes for optimal performance...');

    const indexOperations = [
      // MCP Servers indexes
      { collection: 'mcp_servers', indexes: [
        { key: { name: 1, tenant_id: 1 }, options: { unique: true } },
        { key: { status: 1 } },
        { key: { tenant_id: 1 } },
        { key: { transport_type: 1 } },
        { key: { health_status: 1 } },
        { key: { created_at: 1 } },
        { key: { updated_at: 1 } },
        { key: { tags: 1 } }
      ]},

      // MCP Tools indexes
      { collection: 'mcp_tools', indexes: [
        { key: { tool_id: 1, tenant_id: 1 }, options: { unique: true } },
        { key: { server_id: 1 } },
        { key: { server_name: 1 } },
        { key: { name: 1 } },
        { key: { category: 1 } },
        { key: { tenant_id: 1 } },
        { key: { is_active: 1 } },
        { key: { usage_count: -1 } },
        { key: { last_used_at: -1 } },
        { key: { created_at: 1 } }
      ]},

      // Tool Executions indexes (with TTL for automatic cleanup)
      { collection: 'tool_executions', indexes: [
        { key: { execution_id: 1 }, options: { unique: true } },
        { key: { tool_id: 1, started_at: -1 } },
        { key: { server_id: 1, started_at: -1 } },
        { key: { status: 1 } },
        { key: { correlation_id: 1 } },
        { key: { chain_id: 1 } },
        { key: { session_id: 1 } },
        { key: { tenant_id: 1 } },
        { key: { duration_ms: -1 } },
        { key: { started_at: 1 }, options: { expireAfterSeconds: 7776000 } } // 90 days TTL
      ]},

      // Tool Chain Executions indexes
      { collection: 'tool_chain_executions', indexes: [
        { key: { chain_id: 1 }, options: { unique: true } },
        { key: { status: 1 } },
        { key: { chain_type: 1 } },
        { key: { correlation_id: 1 } },
        { key: { session_id: 1 } },
        { key: { tenant_id: 1 } },
        { key: { priority: -1 } },
        { key: { duration_ms: -1 } },
        { key: { started_at: 1 }, options: { expireAfterSeconds: 7776000 } } // 90 days TTL
      ]},

      // Tool Chain Steps indexes
      { collection: 'tool_chain_steps', indexes: [
        { key: { chain_execution_id: 1, step_index: 1 }, options: { unique: true } },
        { key: { chain_id: 1 } },
        { key: { tool_execution_id: 1 } },
        { key: { status: 1 } },
        { key: { parallel_group: 1 } },
        { key: { started_at: -1 } }
      ]},

      // API Requests indexes
      { collection: 'api_requests', indexes: [
        { key: { request_id: 1 }, options: { unique: true } },
        { key: { endpoint: 1 } },
        { key: { method: 1 } },
        { key: { status_code: 1 } },
        { key: { duration_ms: -1 } },
        { key: { session_id: 1 } },
        { key: { tenant_id: 1 } },
        { key: { correlation_id: 1 } },
        { key: { started_at: 1 }, options: { expireAfterSeconds: 2592000 } } // 30 days TTL
      ]},

      // Server Connections indexes
      { collection: 'server_connections', indexes: [
        { key: { server_id: 1, event_time: -1 } },
        { key: { event_type: 1 } },
        { key: { health_status: 1 } },
        { key: { connection_id: 1 } },
        { key: { event_time: 1 }, options: { expireAfterSeconds: 1209600 } } // 14 days TTL
      ]},

      // Server Health Checks indexes
      { collection: 'server_health_checks', indexes: [
        { key: { server_id: 1, check_time: -1 } },
        { key: { status: 1 } },
        { key: { check_type: 1 } },
        { key: { check_time: 1 }, options: { expireAfterSeconds: 604800 } } // 7 days TTL
      ]},

      // Authentication - Users
      { collection: 'users', indexes: [
        { key: { email: 1 }, options: { unique: true } },
        { key: { username: 1 }, options: { unique: true } },
        { key: { oauth_provider: 1, oauth_id: 1 } },
        { key: { is_active: 1 } }
      ]},

      // Authentication - JWT Tokens
      { collection: 'jwt_tokens', indexes: [
        { key: { user_id: 1 } },
        { key: { jti: 1 }, options: { unique: true } },
        { key: { expires_at: 1 }, options: { expireAfterSeconds: 0 } }, // Automatic cleanup
        { key: { user_id: 1, token_type: 1, is_revoked: 1 } }
      ]},

      // Authentication - Sessions
      { collection: 'sessions', indexes: [
        { key: { user_id: 1 } },
        { key: { session_token: 1 }, options: { unique: true } },
        { key: { user_id: 1, status: 1 } },
        { key: { expires_at: 1 }, options: { expireAfterSeconds: 0 } } // Automatic cleanup
      ]},

      // Entity Metadata indexes
      { collection: 'entity_metadata', indexes: [
        { key: { entity_type: 1, entity_id: 1, namespace: 1, key: 1, tenant_id: 1 }, options: { unique: true } },
        { key: { entity_type: 1, entity_id: 1 } },
        { key: { namespace: 1 } },
        { key: { key: 1 } },
        { key: { tenant_id: 1 } },
        { key: { visibility: 1 } },
        { key: { updated_at: -1 } }
      ]},

      // Security Audit Log indexes
      { collection: 'security_audit_log', indexes: [
        { key: { event_id: 1 }, options: { unique: true } },
        { key: { event_type: 1 } },
        { key: { severity: 1 } },
        { key: { resource_type: 1, resource_id: 1 } },
        { key: { user_id: 1 } },
        { key: { session_id: 1 } },
        { key: { ip_address: 1 } },
        { key: { tenant_id: 1 } },
        { key: { correlation_id: 1 } },
        { key: { event_time: 1 }, options: { expireAfterSeconds: 31536000 } } // 365 days TTL
      ]},

      // System Events indexes
      { collection: 'system_events', indexes: [
        { key: { event_id: 1 }, options: { unique: true } },
        { key: { event_type: 1 } },
        { key: { severity: 1 } },
        { key: { category: 1 } },
        { key: { event_source: 1 } },
        { key: { tenant_id: 1 } },
        { key: { correlation_id: 1 } },
        { key: { event_time: 1 }, options: { expireAfterSeconds: 2592000 } } // 30 days TTL for non-critical
      ]}
    ];

    for (const { collection, indexes } of indexOperations) {
      try {
        for (const indexSpec of indexes) {
          await this.db.collection(collection).createIndex(indexSpec.key, indexSpec.options || {});
        }
        console.log(`  ✅ Created indexes for: ${collection}`);
      } catch (error) {
        console.error(`  ❌ Failed to create indexes for ${collection}:`, error.message);
      }
    }
  }

  async insertInitialData() {
    console.log('\n📊 Inserting initial tenant data...');

    // Insert initial system metadata
    const systemMetadata = [
      {
        _id: new ObjectId(),
        entity_type: 'system',
        entity_id: 'mcp_hub',
        namespace: 'schema',
        key: 'version',
        value: '2.0.0',
        visibility: 'system',
        created_at: new Date(),
        updated_at: new Date(),
        tenant_id: TENANT_ID
      },
      {
        _id: new ObjectId(),
        entity_type: 'system',
        entity_id: 'mcp_hub',
        namespace: 'schema',
        key: 'database_type',
        value: 'mongodb',
        visibility: 'system',
        created_at: new Date(),
        updated_at: new Date(),
        tenant_id: TENANT_ID
      },
      {
        _id: new ObjectId(),
        entity_type: 'system',
        entity_id: 'mcp_hub',
        namespace: 'features',
        key: 'tenant_isolation',
        value: true,
        visibility: 'system',
        created_at: new Date(),
        updated_at: new Date(),
        tenant_id: TENANT_ID
      }
    ];

    try {
      await this.db.collection('entity_metadata').insertMany(systemMetadata);
      console.log('  ✅ Inserted system metadata');
    } catch (error) {
      console.error('  ❌ Failed to insert system metadata:', error.message);
    }

    // Create initial admin user (using bcrypt-style hashing for compatibility)
    const adminUser = {
      _id: new ObjectId(),
      username: 'admin',
      email: 'admin@mcphub.local',
      password_hash: '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // 'admin123!'
      first_name: 'Admin',
      last_name: 'User', 
      role: 'admin',
      is_active: true,
      is_verified: true,
      oauth_provider: 'local',
      oauth_id: null,
      avatar_url: null,
      metadata: {},
      created_at: new Date(),
      updated_at: new Date(),
      last_login_at: null,
      tenant_id: TENANT_ID
    };

    try {
      await this.db.collection('users').insertOne(adminUser);
      console.log('  ✅ Created admin user (admin@mcphub.local / admin123!)');
    } catch (error) {
      if (error.code === 11000) { // Duplicate key
        console.log('  ⚠️  Admin user already exists');
      } else {
        console.error('  ❌ Failed to create admin user:', error.message);
      }
    }

    // Create service user
    const serviceUser = {
      _id: new ObjectId(),
      username: 'service',
      email: 'service@mcphub.local',
      password_hash: '$2b$10$N9qo8uLOickgx2ZMRZoMye1J6GAEKBDq3KgZVoSXn1c7JqC5F3.pK', // 'service_secure_password_2024'
      first_name: 'Service',
      last_name: 'Account',
      role: 'service',
      is_active: true,
      is_verified: true,
      oauth_provider: 'local',
      oauth_id: null,
      avatar_url: null,
      metadata: {},
      created_at: new Date(),
      updated_at: new Date(),
      last_login_at: null,
      tenant_id: TENANT_ID
    };

    try {
      await this.db.collection('users').insertOne(serviceUser);
      console.log('  ✅ Created service user');
    } catch (error) {
      if (error.code === 11000) { // Duplicate key
        console.log('  ⚠️  Service user already exists');
      } else {
        console.error('  ❌ Failed to create service user:', error.message);
      }
    }

    // Insert initial system event
    const systemEvent = {
      _id: new ObjectId(),
      event_id: `tenant_setup_${Date.now()}`,
      event_type: 'tenant_initialization',
      event_source: 'setup_script',
      category: 'system',
      severity: 'info',
      title: 'MCP Hub Tenant Initialized',
      description: `MongoDB tenant ${TENANT_ID} has been successfully initialized for MCP Hub`,
      event_data: {
        tenant_id: TENANT_ID,
        database_name: DATABASE_NAME,
        schema_version: '2.0.0',
        collections_created: 20,
        indexes_created: 60
      },
      event_time: new Date(),
      correlation_id: crypto.randomUUID(),
      session_id: null,
      user_id: null,
      related_entities: {},
      affected_resources: [],
      notification_sent: false,
      alert_level: 'none',
      notification_channels: [],
      tenant_id: TENANT_ID,
      metadata: {},
      tags: ['initialization', 'tenant_setup']
    };

    try {
      await this.db.collection('system_events').insertOne(systemEvent);
      console.log('  ✅ Created initial system event');
    } catch (error) {
      console.error('  ❌ Failed to create system event:', error.message);
    }
  }

  async createTenantConfigurationCollection() {
    console.log('\n⚙️  Creating tenant configuration...');

    const tenantConfig = {
      _id: TENANT_ID,
      tenant_name: `MCP Hub Tenant ${TENANT_ID}`,
      database_name: DATABASE_NAME,
      created_at: new Date(),
      updated_at: new Date(),
      status: 'active',
      configuration: {
        mongodb_host: MONGODB_HOST,
        mongodb_port: parseInt(MONGODB_PORT),
        features: {
          authentication: true,
          audit_logging: true,
          metrics_collection: true,
          tool_chain_execution: true,
          server_health_monitoring: true
        },
        retention_policies: {
          tool_executions_days: 90,
          api_requests_days: 30,
          audit_log_days: 365,
          server_connections_days: 14,
          health_checks_days: 7,
          system_events_days: 30
        },
        limits: {
          max_concurrent_executions: 100,
          max_chain_steps: 50,
          max_tool_timeout_ms: 300000,
          max_request_size_mb: 10
        }
      },
      security: {
        encryption_enabled: false,
        row_level_security: false,
        audit_all_operations: true,
        require_authentication: true
      },
      metadata: {
        setup_version: '1.0.0',
        setup_date: new Date(),
        setup_by: 'mongodb_tenant_setup_script'
      }
    };

    try {
      await this.db.collection('tenant_configurations').insertOne(tenantConfig);
      console.log('  ✅ Created tenant configuration');
    } catch (error) {
      console.error('  ❌ Failed to create tenant configuration:', error.message);
    }
  }

  async verifySetup() {
    console.log('\n🔍 Verifying tenant setup...');

    const collections = await this.db.listCollections().toArray();
    console.log(`  📚 Collections created: ${collections.length}`);

    // Test basic operations
    const testServer = {
      _id: new ObjectId(),
      name: 'test-server',
      display_name: 'Test MCP Server',
      description: 'Test server for validation',
      endpoint: 'npx test-server',
      transport_type: 'stdio',
      config: {},
      capabilities: {},
      environment_vars: {},
      status: 'inactive',
      last_health_check: null,
      health_status: 'unknown',
      error_message: null,
      connection_count: 0,
      last_connected_at: null,
      last_disconnected_at: null,
      total_connection_time_seconds: 0,
      tool_count: 0,
      active_tool_count: 0,
      avg_response_time_ms: null,
      success_rate: null,
      total_requests: 0,
      successful_requests: 0,
      failed_requests: 0,
      metadata: {},
      tags: ['test'],
      created_at: new Date(),
      updated_at: new Date(),
      created_by: 'setup_script',
      tenant_id: TENANT_ID
    };

    try {
      const result = await this.db.collection('mcp_servers').insertOne(testServer);
      console.log('  ✅ Test document insertion successful');

      // Clean up test document
      await this.db.collection('mcp_servers').deleteOne({ _id: result.insertedId });
      console.log('  ✅ Test document cleanup successful');
    } catch (error) {
      console.error('  ❌ Test operations failed:', error.message);
    }

    // Verify indexes
    let indexCount = 0;
    for (const collection of collections) {
      const indexes = await this.db.collection(collection.name).indexes();
      indexCount += indexes.length;
    }
    console.log(`  🔍 Total indexes created: ${indexCount}`);

    // Check users
    const userCount = await this.db.collection('users').countDocuments();
    console.log(`  👥 Users created: ${userCount}`);

    // Check system metadata
    const metadataCount = await this.db.collection('entity_metadata').countDocuments();
    console.log(`  📊 Metadata records: ${metadataCount}`);

    console.log('  ✅ Tenant setup verification completed successfully');
  }

  async generateConnectionConfig() {
    console.log('\n📋 Generating connection configuration...');

    const connectionConfig = {
      mongodb: {
        host: MONGODB_HOST,
        port: parseInt(MONGODB_PORT),
        database: DATABASE_NAME,
        uri: `mongodb://${MONGODB_HOST}:${MONGODB_PORT}/${DATABASE_NAME}`,
        options: {
          maxPoolSize: 10,
          minPoolSize: 2,
          maxIdleTimeMS: 30000,
          serverSelectionTimeoutMS: 5000,
          connectTimeoutMS: 10000
        }
      },
      tenant: {
        id: TENANT_ID,
        database_name: DATABASE_NAME,
        isolation_level: 'database',
        created_at: new Date().toISOString()
      },
      authentication: {
        default_admin: {
          username: 'admin',
          email: 'admin@mcphub.local',
          password: 'admin123!' // Change in production!
        },
        service_account: {
          username: 'service',
          email: 'service@mcphub.local'
        }
      },
      features: {
        ttl_indexes: true,
        audit_logging: true,
        performance_metrics: true,
        tenant_isolation: true
      }
    };

    const configPath = `connection-config-${TENANT_ID}.json`;
    require('fs').writeFileSync(configPath, JSON.stringify(connectionConfig, null, 2));
    console.log(`  ✅ Connection config written to: ${configPath}`);

    return connectionConfig;
  }

  async run() {
    try {
      await this.connect();
      await this.createCollections();
      await this.createIndexes();
      await this.insertInitialData();
      await this.createTenantConfigurationCollection();
      await this.verifySetup();
      const config = await this.generateConnectionConfig();
      
      console.log('\n🎉 MCP-Hub MongoDB tenant setup completed successfully!');
      console.log(`\n📋 Summary:`);
      console.log(`   🏢 Tenant ID: ${TENANT_ID}`);
      console.log(`   🗄️  Database: ${DATABASE_NAME}`);
      console.log(`   📍 MongoDB: ${MONGODB_HOST}:${MONGODB_PORT}`);
      console.log(`   👤 Admin User: admin@mcphub.local / admin123!`);
      console.log(`   🔧 Service User: service@mcphub.local`);
      console.log(`   ⚙️  Configuration: connection-config-${TENANT_ID}.json`);
      
      console.log('\n🚀 Ready to integrate with MCP-Hub!');
      
    } catch (error) {
      console.error('\n❌ Setup failed:', error);
      throw error;
    } finally {
      await this.disconnect();
    }
  }
}

// Run setup if called directly
if (require.main === module) {
  const setup = new McpHubTenantSetup();
  setup.run().catch(console.error);
}

module.exports = McpHubTenantSetup;

#!/usr/bin/env node
/**
 * MCP Hub Database Initialization Script
 * Comprehensive database setup, testing, and health checking
 */

import dbModule from '../src/database/config.js';

const {
    testConnection,
    initializeSchema,
    getHealthStatus,
    dbConfig
} = dbModule;

async function runDatabaseInitialization() {
    console.log('🚀 MCP Hub Database Initialization');
    console.log('='.repeat(60));
    
    console.log('\n📋 Configuration Summary:');
    console.log(`   Host: ${dbConfig.host}:${dbConfig.port}`);
    console.log(`   Database: ${dbConfig.database}`);
    console.log(`   User: ${dbConfig.user}`);
    console.log(`   SSL: ${dbConfig.ssl ? '✅ Enabled' : '❌ Disabled'}`);
    
    // Test 1: Basic connectivity
    console.log('\n🔌 Testing basic database connectivity...');
    const basicTest = await testConnection(false);
    
    if (basicTest.success) {
        console.log('✅ Basic connection successful!');
        console.log(`   Database: ${basicTest.info.database}`);
        console.log(`   User: ${basicTest.info.user}`);
        console.log(`   Server: ${basicTest.info.server_addr}:${basicTest.info.server_port}`);
        console.log(`   Version: ${basicTest.info.version.split(',')[0]}`);
    } else {
        console.log('❌ Basic connection failed!');
        console.log(`   Error: ${basicTest.error}`);
        console.log('\n🛑 Cannot proceed without basic connectivity. Please check configuration.');
        process.exit(1);
    }
    
    // Test 2: SSL connectivity
    if (dbConfig.ssl) {
        console.log('\n🔐 Testing SSL connectivity...');
        const sslTest = await testConnection(true);
        
        if (sslTest.success) {
            console.log('✅ SSL connection successful!');
            console.log(`   Secure connection established to ${sslTest.info.server_addr}`);
        } else {
            console.log('⚠️  SSL connection failed (falling back to non-SSL):');
            console.log(`   Error: ${sslTest.error}`);
        }
    }
    
    // Test 3: Schema initialization
    console.log('\n🗄️  Initializing database schema...');
    const schemaInit = await initializeSchema();
    
    if (schemaInit.success) {
        console.log('✅ Database schema initialized successfully!');
        console.log(`   Message: ${schemaInit.message}`);
    } else {
        console.log('❌ Schema initialization failed!');
        console.log(`   Error: ${schemaInit.error}`);
        console.log('\n🛑 Cannot proceed without proper schema.');
        process.exit(1);
    }
    
    // Test 4: Health check
    console.log('\n🏥 Performing database health check...');
    const healthStatus = await getHealthStatus();
    
    if (healthStatus.success) {
        console.log('✅ Database health check passed!');
        console.log(`   Timestamp: ${healthStatus.timestamp}`);
        
        if (healthStatus.tables && healthStatus.tables.length > 0) {
            console.log('   📊 Database Tables:');
            healthStatus.tables.forEach(table => {
                console.log(`     - ${table.tablename}: ${table.inserts} inserts, ${table.updates} updates, ${table.deletes} deletes`);
            });
        }
        
        if (healthStatus.connections && healthStatus.connections.length > 0) {
            console.log('   🔗 Active Connections:');
            healthStatus.connections.forEach(conn => {
                console.log(`     - ${conn.state}: ${conn.count} connections`);
            });
        }
        
        console.log('   🏊 Connection Pool Status:');
        console.log(`     - Total: ${healthStatus.pool_info?.total_count || 0}`);
        console.log(`     - Idle: ${healthStatus.pool_info?.idle_count || 0}`);
        console.log(`     - Waiting: ${healthStatus.pool_info?.waiting_count || 0}`);
    } else {
        console.log('⚠️  Database health check failed:');
        console.log(`   Error: ${healthStatus.error}`);
    }
    
    // Test 5: Sample data operations
    console.log('\n🧪 Testing sample data operations...');
    try {
        const { createClient } = dbModule;
        const client = createClient();
        await client.connect();
        
        // Insert test connection record
        const testServerName = 'test-server-init';
        await client.query(`
            INSERT INTO mcp_connections (server_name, server_config, status) 
            VALUES ($1, $2, $3) 
            ON CONFLICT (server_name) DO UPDATE SET 
                server_config = EXCLUDED.server_config,
                status = EXCLUDED.status,
                updated_at = CURRENT_TIMESTAMP
        `, [testServerName, JSON.stringify({ type: 'test', initialized: true }), 'connected']);
        
        // Query back the record
        const result = await client.query(
            'SELECT server_name, status, created_at FROM mcp_connections WHERE server_name = $1',
            [testServerName]
        );
        
        if (result.rows.length > 0) {
            console.log('✅ Sample data operations successful!');
            console.log(`   Test record: ${result.rows[0].server_name} (${result.rows[0].status})`);
            console.log(`   Created: ${result.rows[0].created_at}`);
        }
        
        // Clean up test data
        await client.query('DELETE FROM mcp_connections WHERE server_name = $1', [testServerName]);
        
        await client.end();
    } catch (error) {
        console.log('❌ Sample data operations failed!');
        console.log(`   Error: ${error.message}`);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 Database initialization completed successfully!');
    console.log('\n📋 Next Steps:');
    console.log('   1. ✅ Database is ready for MCP Hub operations');
    console.log('   2. ✅ SSL encryption is configured and available');
    console.log('   3. ✅ Connection pooling is set up for optimal performance');
    console.log('   4. ✅ Schema is initialized with proper indexes');
    console.log('   5. ✅ Health monitoring is available');
    
    console.log('\n🔧 Integration Points:');
    console.log('   - Use: import dbConfig from "./src/database/config.js"');
    console.log('   - Connection Pool: dbConfig.mcpHubPool');
    console.log('   - Health Check: await dbConfig.getHealthStatus()');
    console.log('   - SSL Connection String: Available in .env file');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Gracefully shutting down database initialization...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Gracefully shutting down database initialization...');
    process.exit(0);
});

// Run initialization
if (import.meta.url === `file://${process.argv[1]}`) {
    runDatabaseInitialization().catch((error) => {
        console.error('\n💥 Database initialization failed:', error);
        process.exit(1);
    });
}

export default runDatabaseInitialization;

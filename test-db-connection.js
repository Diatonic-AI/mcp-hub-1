#!/usr/bin/env node
/**
 * Database Connection Test Script
 * Tests SSL and non-SSL connections to PostgreSQL
 */

import dotenv from 'dotenv';
import pkg from 'pg';
import fs from 'fs';

dotenv.config();
const { Client } = pkg;

async function testDatabaseConnection() {
    console.log('🔍 Testing MCP Hub Database Connection...');
    console.log('=' .repeat(50));
    
    const config = {
        host: process.env.POSTGRES_HOST,
        port: process.env.POSTGRES_PORT,
        database: process.env.POSTGRES_DB,
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
    };
    
    // Test 1: Basic connection
    console.log('\n📡 Testing basic connection...');
    try {
        const client = new Client(config);
        await client.connect();
        
        const result = await client.query('SELECT version(), current_user, current_database()');
        console.log('✅ Basic connection successful!');
        console.log(`   Version: ${result.rows[0].version.split(',')[0]}`);
        console.log(`   User: ${result.rows[0].current_user}`);
        console.log(`   Database: ${result.rows[0].current_database}`);
        
        await client.end();
    } catch (error) {
        console.log('❌ Basic connection failed:', error.message);
    }
    
    // Test 2: SSL connection
    console.log('\n🔐 Testing SSL connection...');
    try {
        const sslConfig = {
            ...config,
            ssl: {
                rejectUnauthorized: false, // Allow self-signed certificates
                ca: fs.readFileSync('/home/daclab-ai/dev/mcp-hub/ssl/postgresql-server.crt')
            }
        };
        
        const client = new Client(sslConfig);
        await client.connect();
        
        const result = await client.query('SELECT current_setting(\'ssl\') as ssl_enabled');
        console.log('✅ SSL connection successful!');
        console.log(`   SSL Status: ${result.rows[0].ssl_enabled}`);
        
        await client.end();
    } catch (error) {
        console.log('❌ SSL connection failed:', error.message);
    }
    
    // Test 3: Database schema check
    console.log('\n🗄️  Testing database schema...');
    try {
        const client = new Client(config);
        await client.connect();
        
        const tablesResult = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);
        
        console.log('✅ Database schema check successful!');
        console.log('   Tables found:');
        tablesResult.rows.forEach(row => {
            console.log(`     - ${row.table_name}`);
        });
        
        await client.end();
    } catch (error) {
        console.log('❌ Database schema check failed:', error.message);
    }
    
    console.log('\n' + '=' .repeat(50));
    console.log('🎉 Database connection tests completed!');
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
    testDatabaseConnection().catch(console.error);
}

export default testDatabaseConnection;

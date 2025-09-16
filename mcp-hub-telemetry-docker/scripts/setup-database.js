#!/usr/bin/env node
/**
 * Database Setup Script for MCP Hub Telemetry
 * Sets up the PostgreSQL database schema and initial data
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

class DatabaseSetup {
  constructor() {
    this.config = {
      host: process.env.POSTGRES_HOST || 'postgresql',
      port: parseInt(process.env.POSTGRES_PORT) || 5432,
      database: process.env.POSTGRES_DB || 'mcp_hub',
      user: process.env.POSTGRES_ADMIN_USER || 'postgres',
      password: process.env.POSTGRES_ADMIN_PASSWORD,
      maxConnections: 5
    };
    
    this.appConfig = {
      user: process.env.POSTGRES_USER || 'mcp_hub_app',
      password: process.env.POSTGRES_PASSWORD || 'mcp_hub_secure_password',
      tenant: process.env.TENANT || 'daclab-ai'
    };
  }
  
  async setupDatabase() {
    console.log('🔧 Setting up MCP Hub Telemetry Database...');
    console.log(`Host: ${this.config.host}:${this.config.port}`);
    console.log(`Database: ${this.config.database}`);
    console.log(`Tenant: ${this.appConfig.tenant}`);
    console.log('');
    
    const pool = new Pool(this.config);
    
    try {
      // Test connection
      console.log('📡 Testing database connection...');
      const client = await pool.connect();
      console.log('✅ Database connection successful');
      
      // Check if schema already exists
      const schemaExists = await this.checkSchemaExists(client);
      
      if (schemaExists) {
        console.log('⚠️  Schema already exists. Skipping schema creation.');
        console.log('   Use FORCE_RECREATE=true to recreate the schema.');
        
        if (process.env.FORCE_RECREATE !== 'true') {
          client.release();
          await this.verifySetup(pool);
          return;
        }
        
        console.log('🔄 Force recreating schema...');
        await client.query('DROP SCHEMA IF EXISTS mcp_hub CASCADE');
      }
      
      // Load and execute schema
      console.log('📋 Loading database schema...');
      const schemaPath = path.join(__dirname, '..', 'sql', 'mcp_hub_schema.sql');
      
      if (!fs.existsSync(schemaPath)) {
        throw new Error(`Schema file not found: ${schemaPath}`);
      }
      
      const schema = fs.readFileSync(schemaPath, 'utf8');
      
      // Execute schema in transaction
      console.log('⚡ Executing database schema...');
      await client.query('BEGIN');
      
      try {
        await client.query(schema);
        await client.query('COMMIT');
        console.log('✅ Database schema created successfully');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      
      client.release();
      
      // Verify the setup
      await this.verifySetup(pool);
      
      console.log('');
      console.log('🎉 Database setup completed successfully!');
      console.log('');
      console.log('Connection details:');
      console.log(`  Host: ${this.config.host}:${this.config.port}`);
      console.log(`  Database: ${this.config.database}`);
      console.log(`  User: ${this.appConfig.user}`);
      console.log(`  Tenant: ${this.appConfig.tenant}`);
      
    } catch (error) {
      console.error('❌ Database setup failed:', error.message);
      throw error;
    } finally {
      await pool.end();
    }
  }
  
  async checkSchemaExists(client) {
    const result = await client.query(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.schemata 
        WHERE schema_name = 'mcp_hub'
      ) as exists
    `);
    
    return result.rows[0].exists;
  }
  
  async verifySetup(pool) {
    console.log('🔍 Verifying database setup...');
    
    // Switch to app user for verification
    const appPool = new Pool({
      ...this.config,
      user: this.appConfig.user,
      password: this.appConfig.password
    });
    
    try {
      const client = await appPool.connect();
      await client.query('SET search_path TO mcp_hub, public');
      
      // Check tables
      const tables = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'mcp_hub'
        ORDER BY table_name
      `);
      
      console.log(`✅ Found ${tables.rows.length} tables in mcp_hub schema`);
      
      // Check tenants
      const tenants = await client.query('SELECT name, active FROM tenants');
      console.log(`✅ Found ${tenants.rows.length} tenant(s)`);
      
      tenants.rows.forEach(tenant => {
        console.log(`   - ${tenant.name} (Active: ${tenant.active})`);
      });
      
      // Test write permissions
      await client.query(`
        INSERT INTO log_entries (level, message, source, component) 
        VALUES ('info', 'Database setup verification', 'setup-script', 'verification')
      `);
      console.log('✅ Write permissions verified');
      
      client.release();
      
    } catch (error) {
      console.error('❌ Verification failed:', error.message);
      throw error;
    } finally {
      await appPool.end();
    }
  }
}

// Run setup if called directly
if (require.main === module) {
  const setup = new DatabaseSetup();
  setup.setupDatabase().catch(error => {
    console.error('Setup failed:', error);
    process.exit(1);
  });
}

module.exports = DatabaseSetup;

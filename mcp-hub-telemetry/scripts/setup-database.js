#!/usr/bin/env node

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function setupDatabase() {
  const config = {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: process.env.POSTGRES_PORT || 5432,
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB || 'mcp_hub'
  };
  
  const client = new Client(config);
  
  try {
    await client.connect();
    console.log('Connected to PostgreSQL');
    
    // Run schema file
    const schemaPath = path.join(__dirname, '..', 'schema', 'mcp_hub_schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      await client.query(schema);
      console.log('Database schema created successfully');
    } else {
      console.warn('Schema file not found, skipping schema creation');
    }
    
  } catch (error) {
    console.error('Database setup failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

setupDatabase();

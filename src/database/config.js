/**
 * MCP Hub Database Configuration Module
 * Provides centralized database connection and configuration management
 */

import dotenv from 'dotenv';
import pkg from 'pg';
import fs from 'fs';
import path from 'path';

dotenv.config();
const { Client, Pool } = pkg;

/**
 * Database configuration options
 */
export const dbConfig = {
    // Basic connection settings
    host: process.env.POSTGRES_HOST || '10.10.10.11',
    port: parseInt(process.env.POSTGRES_PORT) || 5432,
    database: process.env.POSTGRES_DB || 'mcp_hub_db',
    user: process.env.POSTGRES_USER || 'mcp_hub_user',
    password: process.env.POSTGRES_PASSWORD,
    
    // Admin connection settings
    adminUser: process.env.POSTGRES_ADMIN_USER || 'postgres',
    adminPassword: process.env.POSTGRES_ADMIN_PASSWORD,
    
    // SSL configuration
    ssl: process.env.POSTGRES_SSL === 'require' ? {
        rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== 'true',
        ca: process.env.POSTGRES_SSL_CA ? fs.readFileSync(process.env.POSTGRES_SSL_CA) : null
    } : process.env.POSTGRES_SSL === 'prefer' ? {
        rejectUnauthorized: false,
        ca: process.env.POSTGRES_SSL_CA ? fs.readFileSync(process.env.POSTGRES_SSL_CA) : null
    } : false,
    
    // Connection pool settings
    pool: {
        min: 2,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        acquireTimeoutMillis: 60000
    }
};

/**
 * Create a connection pool for the MCP Hub database
 */
export const createPool = () => {
    const poolConfig = {
        ...dbConfig,
        ...dbConfig.pool
    };
    
    // Remove pool settings from the main config
    delete poolConfig.pool;
    delete poolConfig.adminUser;
    delete poolConfig.adminPassword;
    
    return new Pool(poolConfig);
};

/**
 * Create a single client connection
 */
export const createClient = (useAdmin = false) => {
    const clientConfig = { ...dbConfig };
    
    if (useAdmin) {
        clientConfig.user = dbConfig.adminUser;
        clientConfig.password = dbConfig.adminPassword;
        clientConfig.database = 'postgres'; // Connect to default database for admin operations
    }
    
    // Remove non-client config properties
    delete clientConfig.adminUser;
    delete clientConfig.adminPassword;
    delete clientConfig.pool;
    
    return new Client(clientConfig);
};

/**
 * Test database connectivity
 */
export const testConnection = async (useSSL = false) => {
    const testConfig = { ...dbConfig };
    
    if (!useSSL) {
        testConfig.ssl = false;
    }
    
    // Remove non-client config properties
    delete testConfig.adminUser;
    delete testConfig.adminPassword;
    delete testConfig.pool;
    
    const client = new Client(testConfig);
    
    try {
        await client.connect();
        
        const result = await client.query(`
            SELECT 
                version() as version,
                current_user as user,
                current_database() as database,
                inet_server_addr() as server_addr,
                inet_server_port() as server_port
        `);
        
        await client.end();
        
        return {
            success: true,
            ssl: useSSL,
            info: result.rows[0]
        };
    } catch (error) {
        try {
            await client.end();
        } catch (endError) {
            // Ignore cleanup errors
        }
        
        return {
            success: false,
            ssl: useSSL,
            error: error.message
        };
    }
};

/**
 * Initialize database schema if needed
 */
export const initializeSchema = async () => {
    const client = createClient();
    
    try {
        await client.connect();
        
        // Create tables if they don't exist
        await client.query(`
            CREATE TABLE IF NOT EXISTS mcp_connections (
                id SERIAL PRIMARY KEY,
                server_name VARCHAR(255) NOT NULL UNIQUE,
                server_config JSONB NOT NULL,
                status VARCHAR(50) DEFAULT 'disconnected',
                last_connected TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS mcp_tools (
                id SERIAL PRIMARY KEY,
                tool_name VARCHAR(255) NOT NULL,
                server_name VARCHAR(255) NOT NULL,
                tool_config JSONB,
                usage_count INTEGER DEFAULT 0,
                last_used TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(tool_name, server_name)
            );
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS mcp_logs (
                id SERIAL PRIMARY KEY,
                log_level VARCHAR(20) NOT NULL,
                message TEXT NOT NULL,
                context JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        // Create indexes
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_mcp_connections_server_name ON mcp_connections(server_name);
            CREATE INDEX IF NOT EXISTS idx_mcp_connections_status ON mcp_connections(status);
            CREATE INDEX IF NOT EXISTS idx_mcp_tools_server_name ON mcp_tools(server_name);
            CREATE INDEX IF NOT EXISTS idx_mcp_tools_usage ON mcp_tools(usage_count DESC);
            CREATE INDEX IF NOT EXISTS idx_mcp_logs_created_at ON mcp_logs(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_mcp_logs_log_level ON mcp_logs(log_level);
        `);
        
        await client.end();
        
        return { success: true, message: 'Database schema initialized successfully' };
    } catch (error) {
        try {
            await client.end();
        } catch (endError) {
            // Ignore cleanup errors
        }
        
        return { success: false, error: error.message };
    }
};

/**
 * Get database health status
 */
export const getHealthStatus = async () => {
    const pool = createPool();
    
    try {
        const client = await pool.connect();
        
        // Get basic stats
        const [schemaResult, connectionsResult] = await Promise.all([
            client.query(`
                SELECT 
                    schemaname,
                    tablename,
                    n_tup_ins as inserts,
                    n_tup_upd as updates,
                    n_tup_del as deletes
                FROM pg_stat_user_tables
                WHERE schemaname = 'public'
                ORDER BY tablename
            `),
            client.query(`
                SELECT 
                    state,
                    COUNT(*) as count
                FROM pg_stat_activity 
                WHERE datname = current_database()
                GROUP BY state
                ORDER BY count DESC
            `)
        ]);
        
        client.release();
        await pool.end();
        
        return {
            success: true,
            timestamp: new Date().toISOString(),
            tables: schemaResult.rows,
            connections: connectionsResult.rows,
            pool_info: {
                total_count: pool.totalCount,
                idle_count: pool.idleCount,
                waiting_count: pool.waitingCount
            }
        };
    } catch (error) {
        try {
            await pool.end();
        } catch (endError) {
            // Ignore cleanup errors
        }
        
        return {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
};

// Export singleton pool instance
export const mcpHubPool = createPool();

export default {
    dbConfig,
    createPool,
    createClient,
    testConnection,
    initializeSchema,
    getHealthStatus,
    mcpHubPool
};

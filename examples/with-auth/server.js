#!/usr/bin/env node
/**
 * Example: Running MCP Hub with authentication enabled
 * 
 * This example shows how to start MCP Hub with:
 * - PostgreSQL database connection
 * - JWT authentication
 * - OAuth providers (Google, GitHub, Microsoft)
 * 
 * Prerequisites:
 * 1. PostgreSQL database running
 * 2. Environment variables set (see .env.example)
 * 3. OAuth providers configured (optional)
 */

import { startServer } from '../../src/server.js';
import { initializeDatabase } from '../../src/utils/database.js';
import logger from '../../src/utils/logger.js';

async function main() {
  try {
    // Initialize database connection
    let db = null;
    if (process.env.DATABASE_URL) {
      logger.info('Initializing database connection...');
      db = initializeDatabase({
        connectionString: process.env.DATABASE_URL,
        max: 10, // Connection pool size
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000
      });

      // Test connection
      const client = await db.connect();
      await client.query('SELECT NOW()');
      client.release();
      logger.info('Database connection successful');
    } else {
      logger.warn('DATABASE_URL not set - authentication will be disabled');
    }

    // Authentication configuration
    const authConfig = {
      JWT_SECRET: process.env.JWT_SECRET,
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
      JWT_ACCESS_EXPIRY: process.env.JWT_ACCESS_EXPIRY || '15m',
      JWT_REFRESH_EXPIRY: process.env.JWT_REFRESH_EXPIRY || '7d',
      JWT_ISSUER: process.env.JWT_ISSUER || 'mcp-hub',
      JWT_AUDIENCE: process.env.JWT_AUDIENCE || 'mcp-hub-users',

      // OAuth providers
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,

      GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
      GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
      GITHUB_REDIRECT_URI: process.env.GITHUB_REDIRECT_URI,

      MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
      MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
      MICROSOFT_REDIRECT_URI: process.env.MICROSOFT_REDIRECT_URI,
      MICROSOFT_TENANT: process.env.MICROSOFT_TENANT || 'common',

      BASE_URL: process.env.BASE_URL || 'http://localhost:3000',
      OAUTH_ENCRYPTION_KEY: process.env.OAUTH_ENCRYPTION_KEY
    };

    // Start MCP Hub server
    await startServer({
      port: process.env.PORT || 3000,
      host: process.env.HOST || 'localhost',
      config: './config/mcp-servers.json',
      watch: process.env.NODE_ENV === 'development',
      db, // Pass database connection
      auth: authConfig // Pass auth configuration
    });

    logger.info('MCP Hub with authentication started successfully');

  } catch (error) {
    logger.error('Failed to start MCP Hub with authentication', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { 
    reason: reason?.message || reason,
    stack: reason?.stack 
  });
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

main();

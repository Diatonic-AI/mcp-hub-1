import pg from 'pg';
import logger from './logger.js';

const { Pool } = pg;

let pool = null;

/**
 * Initialize database connection pool
 * @param {Object} config - Database configuration
 * @param {string} config.connectionString - PostgreSQL connection string
 * @param {Object} config.ssl - SSL configuration options
 * @param {number} config.max - Maximum number of connections in pool
 * @param {number} config.idleTimeoutMillis - Close idle connections after this many milliseconds
 * @param {number} config.connectionTimeoutMillis - Return error after this many milliseconds if unable to get connection
 * @returns {Object} Database pool instance
 */
export function initializeDatabase(config = {}) {
  const {
    connectionString = process.env.DATABASE_URL,
    ssl = getSslConfig(),
    max = 20,
    idleTimeoutMillis = 30000,
    connectionTimeoutMillis = 2000,
    ...otherOptions
  } = config;

  if (!connectionString) {
    throw new Error('Database connection string is required. Set DATABASE_URL environment variable.');
  }

  // Parse connection string to validate it
  try {
    new URL(connectionString);
  } catch (error) {
    throw new Error(`Invalid database connection string: ${error.message}`);
  }

  // Close existing pool if it exists
  if (pool) {
    pool.end().catch(err => logger.warn('Error closing existing database pool', { error: err.message }));
  }

  pool = new Pool({
    connectionString,
    ssl,
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    ...otherOptions
  });

  // Handle pool errors
  pool.on('error', (err) => {
    logger.error('Unexpected database pool error', { 
      error: err.message,
      code: err.code 
    });
  });

  logger.info('Database connection pool initialized', {
    host: maskConnectionString(connectionString),
    maxConnections: max,
    ssl: !!ssl
  });

  return pool;
}

/**
 * Get SSL configuration based on environment variables
 * @returns {Object|false} SSL configuration or false to disable SSL
 */
function getSslConfig() {
  const sslMode = process.env.PGSSL_MODE;
  
  if (sslMode === 'disable') {
    return false;
  }

  // Default SSL configuration for production
  if (process.env.NODE_ENV === 'production') {
    return {
      rejectUnauthorized: sslMode === 'require',
      ca: process.env.PGSSL_CA,
      cert: process.env.PGSSL_CERT,
      key: process.env.PGSSL_KEY
    };
  }

  // Development mode - allow self-signed certificates
  return {
    rejectUnauthorized: false
  };
}

/**
 * Mask connection string for logging
 * @param {string} connectionString - Full connection string
 * @returns {string} Masked connection string
 */
function maskConnectionString(connectionString) {
  try {
    const url = new URL(connectionString);
    const masked = `${url.protocol}//${url.username ? '***:***@' : ''}${url.host}${url.pathname}`;
    return masked;
  } catch {
    return '***masked***';
  }
}

/**
 * Get the current database pool
 * @returns {Object|null} Database pool instance
 */
export function getDatabase() {
  return pool;
}

/**
 * Test database connection
 * @returns {Promise<Object>} Connection test result
 */
export async function testDatabaseConnection() {
  if (!pool) {
    throw new Error('Database not initialized');
  }

  const client = await pool.connect();
  
  try {
    const start = Date.now();
    const result = await client.query('SELECT NOW() as current_time, version() as version');
    const duration = Date.now() - start;
    
    return {
      success: true,
      duration,
      currentTime: result.rows[0].current_time,
      version: result.rows[0].version.split(' ')[0] + ' ' + result.rows[0].version.split(' ')[1],
      totalConnections: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingClients: pool.waitingCount
    };
  } finally {
    client.release();
  }
}

/**
 * Execute a query with error handling and logging
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
export async function query(text, params) {
  if (!pool) {
    throw new Error('Database not initialized');
  }

  const start = Date.now();
  const client = await pool.connect();
  
  try {
    const result = await client.query(text, params);
    const duration = Date.now() - start;
    
    // Log slow queries
    if (duration > 1000) {
      logger.warn('Slow database query detected', {
        duration,
        query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        paramCount: params?.length || 0
      });
    }
    
    return result;
  } catch (error) {
    logger.error('Database query error', {
      error: error.message,
      code: error.code,
      query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
      paramCount: params?.length || 0
    });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Execute multiple queries in a transaction
 * @param {Function} callback - Function that receives a client and executes queries
 * @returns {Promise<any>} Transaction result
 */
export async function transaction(callback) {
  if (!pool) {
    throw new Error('Database not initialized');
  }

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Close database connection pool
 * @returns {Promise<void>}
 */
export async function closeDatabase() {
  if (pool) {
    logger.info('Closing database connection pool');
    await pool.end();
    pool = null;
  }
}

/**
 * Check if database is initialized and connected
 * @returns {boolean}
 */
export function isDatabaseConnected() {
  return pool !== null;
}

/**
 * Get database pool statistics
 * @returns {Object} Pool statistics
 */
export function getDatabaseStats() {
  if (!pool) {
    return { connected: false };
  }

  return {
    connected: true,
    totalConnections: pool.totalCount,
    idleConnections: pool.idleCount,
    waitingClients: pool.waitingCount
  };
}

export default {
  initializeDatabase,
  getDatabase,
  testDatabaseConnection,
  query,
  transaction,
  closeDatabase,
  isDatabaseConnected,
  getDatabaseStats
};

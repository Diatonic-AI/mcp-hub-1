/**
 * PostgreSQL Manager Fix
 * Prevents premature pool closure during shutdown
 */

import PostgreSQLManager from './postgresql-manager.js';
import logger from './logger.js';

// Track shutdown state
let isShuttingDown = false;

// Reset shutdown state on module load
isShuttingDown = false;

// Override the close method to check shutdown state
const originalClose = PostgreSQLManager.prototype.close;
PostgreSQLManager.prototype.close = async function() {
  if (isShuttingDown) {
    logger.debug('PostgreSQL Manager: Shutdown already in progress, skipping duplicate close');
    return;
  }
  
  isShuttingDown = true;
  
  // Wait for any pending operations to complete
  if (this.pool) {
    logger.info('PostgreSQL Manager: Waiting for pending operations before closing...');
    
    // Give pending queries time to complete
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check if there are active queries
    const poolStatus = this.getPoolStatus();
    if (poolStatus.waitingCount > 0) {
      logger.warn(`PostgreSQL Manager: ${poolStatus.waitingCount} queries still waiting`);
      // Wait a bit more for them to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Now close the pool
  return originalClose.call(this);
};

// Override the query method to check if shutting down
const originalQuery = PostgreSQLManager.prototype.query;
PostgreSQLManager.prototype.query = async function(text, params) {
  if (isShuttingDown) {
    logger.debug('PostgreSQL Manager: Query attempted during shutdown, skipping', {
      query: text.substring(0, 50) + '...'
    });
    // Return a mock result to prevent errors
    return { rows: [], rowCount: 0 };
  }
  
  if (!this.pool) {
    logger.warn('PostgreSQL Manager: Query attempted with no pool, initializing...');
    await this.initialize();
  }
  
  return originalQuery.call(this, text, params);
};

// Reset shutdown state on initialization
const originalInitialize = PostgreSQLManager.prototype.initialize;
PostgreSQLManager.prototype.initialize = async function() {
  isShuttingDown = false;
  return originalInitialize.call(this);
};

export { isShuttingDown };
export default PostgreSQLManager;

/**
 * Tenant Context Resolution and Enforcement
 * Ensures proper tenant isolation across PostgreSQL and MongoDB
 * Complies with WARP guidelines for security and data isolation
 */

import { ValidationError, ServerError } from './errors.js';
import logger from './logger.js';

/**
 * Tenant context sources in priority order
 */
export const TENANT_SOURCES = {
  EXPLICIT: 'explicit',      // Explicitly provided
  HEADER: 'header',          // From request headers
  CONFIG: 'config',          // From configuration
  ENV: 'environment',        // From environment variables
  DEFAULT: 'default'         // Default tenant
};

/**
 * Tenant Context Manager
 * Resolves and enforces tenant isolation across all database operations
 */
export class TenantContextManager {
  constructor() {
    this.currentTenant = null;
    this.tenantStack = [];
    this.defaultTenant = process.env.DEFAULT_TENANT || 'default';
  }

  /**
   * Resolve tenant from multiple sources
   * @param {Object} options - Resolution options
   * @returns {string} Resolved tenant
   */
  resolveTenant(options = {}) {
    // Handle null/undefined gracefully
    if (!options) {
      options = {};
    }
    
    const {
      explicit,
      headers,
      config,
      allowDefault = true
    } = options;

    let tenant = null;
    let source = null;

    // Priority 1: Explicit tenant
    if (explicit) {
      tenant = explicit;
      source = TENANT_SOURCES.EXPLICIT;
    }
    // Priority 2: Request headers
    else if (headers) {
      tenant = headers['x-tenant-id'] || headers['X-Tenant-Id'] || headers.tenant;
      if (tenant) {
        source = TENANT_SOURCES.HEADER;
      }
    }
    // Priority 3: Configuration
    else if (config && config.tenant) {
      tenant = config.tenant;
      source = TENANT_SOURCES.CONFIG;
    }
    // Priority 4: Environment variable
    else if (process.env.TENANT_ID) {
      tenant = process.env.TENANT_ID;
      source = TENANT_SOURCES.ENV;
    }
    // Priority 5: Current context
    else if (this.currentTenant) {
      tenant = this.currentTenant;
      source = 'context';
    }
    // Priority 6: Default tenant
    else if (allowDefault) {
      tenant = this.defaultTenant;
      source = TENANT_SOURCES.DEFAULT;
    }

    if (!tenant) {
      throw new ValidationError(
        'Unable to resolve tenant context'
      );
    }

    // Validate tenant format
    if (!this.isValidTenant(tenant)) {
      throw new ValidationError(
        `Invalid tenant format: ${tenant}`
      );
    }

    logger.debug('tenant_resolved', {
      tenant,
      source,
      message: `Tenant resolved from ${source}`
    });

    return tenant;
  }

  /**
   * Validate tenant identifier format
   * @param {string} tenant - Tenant to validate
   * @returns {boolean} True if valid
   */
  isValidTenant(tenant) {
    if (!tenant || typeof tenant !== 'string') {
      return false;
    }
    
    // Tenant must be alphanumeric with hyphens/underscores
    // Length between 1 and 64 characters
    const tenantRegex = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;
    return tenantRegex.test(tenant);
  }

  /**
   * Set current tenant context
   * @param {string} tenant - Tenant to set
   */
  setTenant(tenant) {
    if (!this.isValidTenant(tenant)) {
      throw new ValidationError(
        `Invalid tenant: ${tenant}`
      );
    }
    
    this.currentTenant = tenant;
    
    logger.debug('tenant_context_set', {
      tenant,
      message: 'Tenant context updated'
    });
  }

  /**
   * Get current tenant context
   * @returns {string|null} Current tenant
   */
  getTenant() {
    return this.currentTenant;
  }

  /**
   * Push tenant context onto stack
   * Useful for nested operations
   * @param {string} tenant - Tenant to push
   */
  pushTenant(tenant) {
    if (!this.isValidTenant(tenant)) {
      throw new ValidationError(
        `Invalid tenant: ${tenant}`
      );
    }
    
    this.tenantStack.push(this.currentTenant);
    this.currentTenant = tenant;
    
    logger.debug('tenant_pushed', {
      tenant,
      stackDepth: this.tenantStack.length,
      message: 'Tenant pushed to stack'
    });
  }

  /**
   * Pop tenant context from stack
   * @returns {string|null} Previous tenant
   */
  popTenant() {
    if (this.tenantStack.length === 0) {
      throw new ServerError(
        'Tenant stack underflow'
      );
    }
    
    const previousTenant = this.currentTenant;
    this.currentTenant = this.tenantStack.pop();
    
    logger.debug('tenant_popped', {
      previousTenant,
      currentTenant: this.currentTenant,
      stackDepth: this.tenantStack.length,
      message: 'Tenant popped from stack'
    });
    
    return previousTenant;
  }

  /**
   * Execute function with specific tenant context
   * @param {Function} fn - Function to execute
   * @param {string} tenant - Tenant context
   * @returns {*} Function result
   */
  async withTenant(fn, tenant) {
    if (!this.isValidTenant(tenant)) {
      throw new ValidationError(
        `Invalid tenant: ${tenant}`
      );
    }
    
    this.pushTenant(tenant);
    
    try {
      const result = await fn(tenant);
      return result;
    } finally {
      this.popTenant();
    }
  }

  /**
   * Clear tenant context
   */
  clearTenant() {
    this.currentTenant = null;
    this.tenantStack = [];
    
    logger.debug('tenant_cleared', {
      message: 'Tenant context cleared'
    });
  }
}

/**
 * PostgreSQL Tenant Isolation Helper
 * Sets tenant context for Row Level Security (RLS)
 */
export class PostgresTenantHelper {
  /**
   * Set tenant context for PostgreSQL session
   * @param {Object} client - PostgreSQL client
   * @param {string} tenant - Tenant identifier
   */
  static async setTenantContext(client, tenant) {
    if (!client) {
      throw new ValidationError(
        'PostgreSQL client required'
      );
    }
    
    if (!tenant) {
      throw new ValidationError(
        'Tenant required for PostgreSQL context'
      );
    }
    
    try {
      // Set tenant context for RLS
      // The 'true' parameter makes it transaction-local
      await client.query(
        "SELECT set_config('app.tenant', $1, true)",
        [tenant]
      );
      
      logger.debug('pg_tenant_set', {
        tenant,
        message: 'PostgreSQL tenant context set'
      });
      
      return true;
    } catch (error) {
      logger.error('pg_tenant_error', {
        tenant,
        error: error.message,
        message: 'Failed to set PostgreSQL tenant context'
      });
      
      throw new ServerError(
        `Failed to set PostgreSQL tenant: ${error.message}`
      );
    }
  }

  /**
   * Get current tenant context from PostgreSQL
   * @param {Object} client - PostgreSQL client
   * @returns {string|null} Current tenant
   */
  static async getTenantContext(client) {
    if (!client) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'PostgreSQL client required'
      );
    }
    
    try {
      const result = await client.query(
        "SELECT current_setting('app.tenant', true) as tenant"
      );
      
      return result.rows[0]?.tenant || null;
    } catch (error) {
      logger.debug('pg_tenant_get_error', {
        error: error.message,
        message: 'No PostgreSQL tenant context set'
      });
      
      return null;
    }
  }

  /**
   * Execute query with tenant context
   * @param {Object} client - PostgreSQL client
   * @param {string} tenant - Tenant identifier
   * @param {string} query - SQL query
   * @param {Array} params - Query parameters
   * @returns {Object} Query result
   */
  static async queryWithTenant(client, tenant, query, params = []) {
    await this.setTenantContext(client, tenant);
    return client.query(query, params);
  }

  /**
   * Create RLS policy for tenant isolation
   * @param {Object} client - PostgreSQL client
   * @param {string} tableName - Table name
   * @param {string} policyName - Policy name
   * @returns {boolean} Success
   */
  static async createTenantPolicy(client, tableName, policyName) {
    const policySQL = `
      CREATE POLICY ${policyName} ON ${tableName}
      FOR ALL
      USING (tenant_id = current_setting('app.tenant', true))
      WITH CHECK (tenant_id = current_setting('app.tenant', true))
    `;
    
    try {
      await client.query(policySQL);
      
      logger.info('pg_rls_policy_created', {
        tableName,
        policyName,
        message: 'RLS policy created for tenant isolation'
      });
      
      return true;
    } catch (error) {
      if (error.code === '42710') { // Policy already exists
        logger.debug('pg_rls_policy_exists', {
          tableName,
          policyName,
          message: 'RLS policy already exists'
        });
        return true;
      }
      
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create RLS policy: ${error.message}`
      );
    }
  }
}

/**
 * MongoDB Tenant Isolation Helper
 * Enforces tenant filtering in all operations
 */
export class MongoTenantHelper {
  /**
   * Add tenant filter to MongoDB query
   * @param {Object} filter - Original filter
   * @param {string} tenant - Tenant identifier
   * @returns {Object} Filter with tenant
   */
  static addTenantFilter(filter = {}, tenant) {
    if (!tenant) {
      throw new ValidationError(
        'Tenant required for MongoDB filter'
      );
    }
    
    return {
      ...filter,
      tenant
    };
  }

  /**
   * Add tenant to document
   * @param {Object} document - Document to insert/update
   * @param {string} tenant - Tenant identifier
   * @returns {Object} Document with tenant
   */
  static addTenantToDocument(document, tenant) {
    if (!tenant) {
      throw new ValidationError(
        'Tenant required for MongoDB document'
      );
    }
    
    return {
      ...document,
      tenant
    };
  }

  /**
   * Wrap MongoDB collection with tenant enforcement
   * @param {Object} collection - MongoDB collection
   * @param {string} tenant - Tenant identifier
   * @returns {Object} Wrapped collection
   */
  static wrapCollection(collection, tenant) {
    if (!tenant) {
      throw new ValidationError(
        'Tenant required for MongoDB collection wrapper'
      );
    }
    
    return {
      // Find operations
      find: (filter = {}, options) => {
        return collection.find(
          this.addTenantFilter(filter, tenant),
          options
        );
      },
      
      findOne: (filter = {}, options) => {
        return collection.findOne(
          this.addTenantFilter(filter, tenant),
          options
        );
      },
      
      // Insert operations
      insertOne: (document, options) => {
        return collection.insertOne(
          this.addTenantToDocument(document, tenant),
          options
        );
      },
      
      insertMany: (documents, options) => {
        return collection.insertMany(
          documents.map(doc => this.addTenantToDocument(doc, tenant)),
          options
        );
      },
      
      // Update operations
      updateOne: (filter, update, options) => {
        return collection.updateOne(
          this.addTenantFilter(filter, tenant),
          update,
          options
        );
      },
      
      updateMany: (filter, update, options) => {
        return collection.updateMany(
          this.addTenantFilter(filter, tenant),
          update,
          options
        );
      },
      
      replaceOne: (filter, replacement, options) => {
        return collection.replaceOne(
          this.addTenantFilter(filter, tenant),
          this.addTenantToDocument(replacement, tenant),
          options
        );
      },
      
      // Delete operations
      deleteOne: (filter, options) => {
        return collection.deleteOne(
          this.addTenantFilter(filter, tenant),
          options
        );
      },
      
      deleteMany: (filter, options) => {
        return collection.deleteMany(
          this.addTenantFilter(filter, tenant),
          options
        );
      },
      
      // Aggregation
      aggregate: (pipeline, options) => {
        // Add tenant match as first stage
        const tenantPipeline = [
          { $match: { tenant } },
          ...pipeline
        ];
        return collection.aggregate(tenantPipeline, options);
      },
      
      // Count operations
      countDocuments: (filter = {}, options) => {
        return collection.countDocuments(
          this.addTenantFilter(filter, tenant),
          options
        );
      },
      
      // Distinct
      distinct: (field, filter = {}, options) => {
        return collection.distinct(
          field,
          this.addTenantFilter(filter, tenant),
          options
        );
      },
      
      // Direct access to original collection (use with caution)
      _unsafe: collection
    };
  }

  /**
   * Validate tenant in document
   * @param {Object} document - Document to validate
   * @param {string} expectedTenant - Expected tenant
   * @returns {boolean} True if valid
   */
  static validateTenant(document, expectedTenant) {
    if (!document || !document.tenant) {
      return false;
    }
    
    return document.tenant === expectedTenant;
  }
}

// Singleton instance
let manager = null;

/**
 * Get or create Tenant Context Manager instance
 */
export function getTenantContextManager() {
  if (!manager) {
    manager = new TenantContextManager();
  }
  return manager;
}

/**
 * Express middleware for tenant context
 * @param {Object} options - Middleware options
 * @returns {Function} Express middleware
 */
export function tenantMiddleware(options = {}) {
  const { required = true } = options;
  const contextManager = getTenantContextManager();
  
  return (req, res, next) => {
    try {
      const tenant = contextManager.resolveTenant({
        headers: req.headers,
        config: req.app.locals.config,
        allowDefault: !required
      });
      
      req.tenant = tenant;
      contextManager.setTenant(tenant);
      
      // Add tenant to response locals for views
      res.locals.tenant = tenant;
      
      next();
    } catch (error) {
      if (required) {
        return res.status(400).json({
          error: 'Tenant context required',
          message: error.message
        });
      }
      
      // If not required, continue without tenant
      next();
    }
  };
}


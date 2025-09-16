// PostgresAuthStorage removed - using direct database queries instead
import { JWTService } from './jwt-service.js';
import { OAuthService } from './oauth-service.js';
import { registerAuthRoutes } from './auth-routes.js';
import { createAuthMiddleware } from './middleware.js';
import logger from '../utils/logger.js';

/**
 * Initialize and configure the authentication system
 * @param {Object} options - Configuration options
 * @param {Object} options.db - Database connection
 * @param {Object} options.config - Authentication configuration
 * @returns {Promise<Object>} Authentication services and middleware
 */
export async function initializeAuth(options) {
  const { db, config = {} } = options;

  try {
    logger.info('Initializing authentication system...');

    // 1. Initialize JWT Service
    const jwtConfig = {
      accessTokenSecret: config.JWT_SECRET || process.env.JWT_SECRET,
      refreshTokenSecret: config.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET,
      accessTokenExpiry: config.JWT_ACCESS_EXPIRY || '15m',
      refreshTokenExpiry: config.JWT_REFRESH_EXPIRY || '7d',
      issuer: config.JWT_ISSUER || 'mcp-hub',
      audience: config.JWT_AUDIENCE || 'mcp-hub-users'
    };

    if (!jwtConfig.accessTokenSecret || !jwtConfig.refreshTokenSecret) {
      throw new Error('JWT secrets are required. Set JWT_SECRET and JWT_REFRESH_SECRET environment variables.');
    }

    const jwtService = new JWTService(db, jwtConfig);

    // 2. Initialize OAuth Service
    const oauthConfig = {
      providers: {
        google: {
          clientId: config.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
          clientSecret: config.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
          redirectUri: config.GOOGLE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI
        },
        github: {
          clientId: config.GITHUB_CLIENT_ID || process.env.GITHUB_CLIENT_ID,
          clientSecret: config.GITHUB_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET,
          redirectUri: config.GITHUB_REDIRECT_URI || process.env.GITHUB_REDIRECT_URI
        },
        microsoft: {
          clientId: config.MICROSOFT_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID,
          clientSecret: config.MICROSOFT_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET,
          redirectUri: config.MICROSOFT_REDIRECT_URI || process.env.MICROSOFT_REDIRECT_URI,
          tenant: config.MICROSOFT_TENANT || process.env.MICROSOFT_TENANT || 'common'
        }
      },
      baseUrl: config.BASE_URL || process.env.BASE_URL || 'http://localhost:3000',
      encryptionKey: config.OAUTH_ENCRYPTION_KEY || process.env.OAUTH_ENCRYPTION_KEY || jwtConfig.accessTokenSecret.substring(0, 32)
    };

    // Filter out providers with missing configuration
    const availableProviders = Object.entries(oauthConfig.providers)
      .filter(([name, providerConfig]) => providerConfig.clientId && providerConfig.clientSecret)
      .reduce((acc, [name, providerConfig]) => {
        acc[name] = providerConfig;
        return acc;
      }, {});

    let oauthService = null;
    if (Object.keys(availableProviders).length > 0) {
      oauthService = new OAuthService(db, jwtService, { 
        ...oauthConfig, 
        providers: availableProviders 
      });
      logger.info('OAuth service initialized', { 
        providers: Object.keys(availableProviders) 
      });
    } else {
      logger.warn('No OAuth providers configured - OAuth features will be disabled');
    }

    // 3. Create authentication middleware factory
    const createAuth = (options = {}) => createAuthMiddleware(jwtService, options);

    // 4. Setup database schema if needed
    await initializeAuthSchema(db);

    // 5. Start token cleanup job
    startTokenCleanup(jwtService);

    const authServices = {
      jwtService,
      oauthService,
      db,
      middleware: {
        auth: createAuth,
        required: createAuth({ optional: false }),
        optional: createAuth({ optional: true }),
        adminOnly: createAuth({ requiredRole: 'admin' }),
        userOnly: createAuth({ requiredRole: 'user' })
      }
    };

    logger.info('Authentication system initialized successfully', {
      hasJWT: !!jwtService,
      hasOAuth: !!oauthService,
      oauthProviders: oauthService ? Object.keys(availableProviders) : [],
      middlewareCount: Object.keys(authServices.middleware).length
    });

    return authServices;

  } catch (error) {
    logger.error('Failed to initialize authentication system', { 
      error: error.message,
      stack: error.stack 
    });
    throw error;
  }
}

/**
 * Register authentication routes with the application
 * @param {Object} app - Express app or router
 * @param {Object} authServices - Authentication services
 */
export function setupAuthRoutes(app, authServices) {
  try {
    registerAuthRoutes(authServices);
    logger.info('Authentication routes registered successfully');
  } catch (error) {
    logger.error('Failed to register authentication routes', { 
      error: error.message 
    });
    throw error;
  }
}

/**
 * Initialize authentication database schema
 * @param {Object} db - Database connection
 */
async function initializeAuthSchema(db) {
  try {
    // Check if auth schema exists
    const schemaExists = await db.query(`
      SELECT schema_name FROM information_schema.schemata 
      WHERE schema_name = 'auth'
    `);

    if (schemaExists.rows.length === 0) {
      logger.info('Authentication schema not found, creating...');
      
      // Read and execute the schema creation script
      const { readFileSync } = await import('fs');
      const schemaSQL = readFileSync('./src/auth/schema.sql', 'utf8');
      
      await db.query(schemaSQL);
      logger.info('Authentication schema created successfully');
    } else {
      logger.info('Authentication schema already exists');
      
      // Run any pending migrations here
      await runAuthMigrations(db);
    }

  } catch (error) {
    logger.error('Failed to initialize authentication schema', { 
      error: error.message 
    });
    throw error;
  }
}

/**
 * Run authentication system migrations
 * @param {Object} db - Database connection
 */
async function runAuthMigrations(db) {
  try {
    // Create migrations table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS auth.migrations (
        id SERIAL PRIMARY KEY,
        version VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        description TEXT
      )
    `);

    // List of migrations to apply
    const migrations = [
      {
        version: '001_add_oauth_metadata',
        description: 'Add metadata column to oauth_connections',
        sql: `
          ALTER TABLE auth.oauth_connections 
          ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
        `
      },
      {
        version: '002_add_user_preferences',
        description: 'Add preferences column to users',
        sql: `
          ALTER TABLE auth.users 
          ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}';
        `
      }
    ];

    // Apply each migration if not already applied
    for (const migration of migrations) {
      const exists = await db.query(
        'SELECT id FROM auth.migrations WHERE version = $1',
        [migration.version]
      );

      if (exists.rows.length === 0) {
        await db.query('BEGIN');
        try {
          await db.query(migration.sql);
          await db.query(
            'INSERT INTO auth.migrations (version, description) VALUES ($1, $2)',
            [migration.version, migration.description]
          );
          await db.query('COMMIT');
          logger.info('Applied migration', { version: migration.version });
        } catch (error) {
          await db.query('ROLLBACK');
          throw error;
        }
      }
    }

  } catch (error) {
    logger.error('Failed to run authentication migrations', { 
      error: error.message 
    });
    throw error;
  }
}

/**
 * Start token cleanup job
 * @param {JWTService} jwtService - JWT service instance
 */
function startTokenCleanup(jwtService) {
  // Clean up expired tokens every hour
  const cleanupInterval = 60 * 60 * 1000; // 1 hour

  setInterval(async () => {
    try {
      const cleaned = await jwtService.cleanupExpiredTokens();
      if (cleaned > 0) {
        logger.info('Token cleanup completed', { tokensRemoved: cleaned });
      }
    } catch (error) {
      logger.error('Token cleanup failed', { error: error.message });
    }
  }, cleanupInterval);

  logger.info('Token cleanup job started', { 
    intervalMinutes: cleanupInterval / (60 * 1000) 
  });
}

/**
 * Middleware to check authentication status without requiring it
 * @param {Object} authServices - Authentication services
 */
export function createAuthStatusMiddleware(authServices) {
  const { middleware } = authServices;
  
  return (req, res, next) => {
    // Add auth status to all responses
    res.locals.authStatus = {
      isAuthenticated: false,
      user: null,
      hasOAuth: !!authServices.oauthService,
      oauthProviders: authServices.oauthService 
        ? authServices.oauthService.getAvailableProviders() 
        : []
    };

    // Try to authenticate if authorization header or session cookie present
    const authHeader = req.get('Authorization');
    const sessionToken = req.cookies?.session_token;

    if (authHeader || sessionToken) {
      return middleware.optional(req, res, (err) => {
        if (!err && req.user) {
          res.locals.authStatus.isAuthenticated = true;
          res.locals.authStatus.user = {
            id: req.user.id,
            username: req.user.username,
            email: req.user.email,
            role: req.user.role
          };
        }
        next();
      });
    }

    next();
  };
}

/**
 * Gracefully shutdown authentication services
 * @param {Object} authServices - Authentication services
 */
export async function shutdownAuth(authServices) {
  try {
    logger.info('Shutting down authentication services...');

    if (authServices.jwtService) {
      await authServices.jwtService.cleanupExpiredTokens();
    }

    // Close any open connections or cleanup resources here

    logger.info('Authentication services shut down successfully');
  } catch (error) {
    logger.error('Error during authentication shutdown', { error: error.message });
  }
}

// Export all authentication components
export {
  JWTService,
  OAuthService,
  registerAuthRoutes,
  createAuthMiddleware
};

export default {
  initializeAuth,
  setupAuthRoutes,
  createAuthStatusMiddleware,
  shutdownAuth
};

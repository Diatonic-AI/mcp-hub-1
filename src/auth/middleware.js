import { AuthenticationError, AuthorizationError, ValidationError } from '../utils/errors.js';
import logger from '../utils/logger.js';

/**
 * Authentication middleware factory
 * @param {Object} jwtService - JWT service instance
 * @param {Object} options - Middleware options
 * @returns {Function} Express middleware
 */
export function createAuthMiddleware(jwtService, options = {}) {
  const {
    optional = false,
    requireVerified = false,
    requiredScopes = [],
    requiredRole = null,
    allowApiKey = true,
    skipPaths = []
  } = options;

  return async (req, res, next) => {
    try {
      // Skip authentication for certain paths
      if (skipPaths.some(path => req.path.startsWith(path))) {
        return next();
      }

      let token = null;
      let authType = null;

      // Extract token from Authorization header
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
        authType = 'jwt';
      }

      // Extract API key from header or query parameter
      if (!token && allowApiKey) {
        token = req.headers['x-api-key'] || req.query.api_key;
        if (token && token.startsWith('mcp_')) {
          authType = 'api_key';
        }
      }

      // Handle missing token
      if (!token) {
        if (optional) {
          req.user = null;
          req.auth = null;
          return next();
        }
        throw new AuthenticationError('Authentication required');
      }

      let user = null;
      let authData = null;

      // Validate JWT token
      if (authType === 'jwt') {
        try {
          const decoded = await jwtService.verifyToken(token, 'access');
          
          // Get user from database to ensure they're still active
          if (jwtService.db) {
            const userResult = await jwtService.db.query(`
              SELECT id, username, email, first_name, last_name, role, 
                     is_active, is_verified, avatar_url, metadata
              FROM auth.users 
              WHERE id = $1
            `, [decoded.user_id]);

            if (userResult.rows.length === 0) {
              throw new AuthenticationError('User not found');
            }

            user = userResult.rows[0];
          } else {
            // Fallback to token data if no database
            user = {
              id: decoded.user_id,
              username: decoded.username,
              email: decoded.email,
              role: decoded.role,
              is_active: true,
              is_verified: true
            };
          }

          authData = {
            type: 'jwt',
            jti: decoded.jti,
            scopes: decoded.scopes || [],
            expires_at: new Date(decoded.exp * 1000)
          };

        } catch (error) {
          logger.warn('JWT authentication failed', { 
            error: error.message,
            ip: req.ip,
            userAgent: req.get('User-Agent')
          });
          throw error;
        }
      }

      // Validate API key
      if (authType === 'api_key') {
        try {
          const apiKeyData = await jwtService.validateApiKey(token);
          
          user = {
            id: apiKeyData.user_id,
            username: apiKeyData.username,
            email: apiKeyData.email,
            role: apiKeyData.role,
            is_active: true,
            is_verified: true
          };

          authData = {
            type: 'api_key',
            key_id: apiKeyData.id,
            key_name: apiKeyData.key_name,
            scopes: apiKeyData.scopes || [],
            usage_count: apiKeyData.usage_count
          };

        } catch (error) {
          logger.warn('API key authentication failed', { 
            error: error.message,
            ip: req.ip,
            userAgent: req.get('User-Agent')
          });
          throw error;
        }
      }

      // Check if user account is active
      if (!user.is_active) {
        throw new AuthenticationError('User account is inactive');
      }

      // Check if user email is verified (if required)
      if (requireVerified && !user.is_verified) {
        throw new AuthenticationError('Email verification required');
      }

      // Check required role
      if (requiredRole && user.role !== requiredRole && user.role !== 'admin') {
        throw new AuthorizationError(`Required role: ${requiredRole}`);
      }

      // Check required scopes
      if (requiredScopes.length > 0) {
        const userScopes = authData.scopes || [];
        const hasRequiredScopes = requiredScopes.every(scope => 
          userScopes.includes(scope) || userScopes.includes('*')
        );
        
        if (!hasRequiredScopes && user.role !== 'admin') {
          throw new AuthorizationError(`Required scopes: ${requiredScopes.join(', ')}`);
        }
      }

      // Attach user and auth data to request
      req.user = user;
      req.auth = authData;

      // Set security headers
      res.set('X-User-ID', user.id);
      res.set('X-Auth-Type', authData.type);

      // Log successful authentication
      logger.debug('Authentication successful', {
        userId: user.id,
        username: user.username,
        authType: authData.type,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      next();

    } catch (error) {
      // Log authentication failure
      logger.warn('Authentication middleware failed', {
        error: error.message,
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      // Return appropriate error response
      if (error instanceof AuthenticationError) {
        return res.status(401).json({
          error: 'Authentication failed',
          message: error.message,
          code: 'AUTHENTICATION_FAILED',
          timestamp: new Date().toISOString()
        });
      }

      if (error instanceof AuthorizationError) {
        return res.status(403).json({
          error: 'Authorization failed',
          message: error.message,
          code: 'AUTHORIZATION_FAILED',
          timestamp: new Date().toISOString()
        });
      }

      // Generic error
      return res.status(500).json({
        error: 'Authentication error',
        message: 'An error occurred during authentication',
        code: 'AUTHENTICATION_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  };
}

/**
 * Role-based authorization middleware
 * @param {string|string[]} roles - Required role(s)
 * @returns {Function} Express middleware
 */
export function requireRole(roles) {
  const requiredRoles = Array.isArray(roles) ? roles : [roles];
  
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTHENTICATION_REQUIRED',
        timestamp: new Date().toISOString()
      });
    }

    if (!requiredRoles.includes(req.user.role) && req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: `Required role: ${requiredRoles.join(' or ')}`,
        code: 'INSUFFICIENT_PERMISSIONS',
        timestamp: new Date().toISOString()
      });
    }

    next();
  };
}

/**
 * Scope-based authorization middleware
 * @param {string|string[]} scopes - Required scope(s)
 * @returns {Function} Express middleware
 */
export function requireScopes(scopes) {
  const requiredScopes = Array.isArray(scopes) ? scopes : [scopes];
  
  return (req, res, next) => {
    if (!req.user || !req.auth) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTHENTICATION_REQUIRED',
        timestamp: new Date().toISOString()
      });
    }

    const userScopes = req.auth.scopes || [];
    const hasRequiredScopes = requiredScopes.every(scope => 
      userScopes.includes(scope) || userScopes.includes('*')
    );

    if (!hasRequiredScopes && req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: `Required scopes: ${requiredScopes.join(', ')}`,
        code: 'INSUFFICIENT_SCOPES',
        timestamp: new Date().toISOString()
      });
    }

    next();
  };
}

/**
 * Rate limiting middleware
 * @param {Object} jwtService - JWT service with database access
 * @param {Object} options - Rate limiting options
 * @returns {Function} Express middleware
 */
export function createRateLimitMiddleware(jwtService, options = {}) {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100, // requests per window
    message = 'Too many requests',
    skipSuccessfulRequests = false,
    skipFailedRequests = false
  } = options;

  return async (req, res, next) => {
    if (!jwtService.db) {
      return next(); // Skip if no database
    }

    try {
      const identifier = req.user?.id || req.ip;
      const endpoint = `${req.method}:${req.route?.path || req.path}`;
      const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);

      // Check current rate limit
      const result = await jwtService.db.query(`
        INSERT INTO auth.rate_limits (identifier, endpoint, window_start, request_count)
        VALUES ($1, $2, $3, 1)
        ON CONFLICT (identifier, endpoint, window_start)
        DO UPDATE SET 
          request_count = auth.rate_limits.request_count + 1,
          updated_at = NOW()
        RETURNING request_count, blocked_until
      `, [identifier, endpoint, windowStart]);

      const { request_count, blocked_until } = result.rows[0];

      // Check if currently blocked
      if (blocked_until && new Date(blocked_until) > new Date()) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: 'You are temporarily blocked due to rate limiting',
          code: 'RATE_LIMIT_BLOCKED',
          retry_after: Math.ceil((new Date(blocked_until) - new Date()) / 1000),
          timestamp: new Date().toISOString()
        });
      }

      // Check if rate limit exceeded
      if (request_count > max) {
        // Block for the remainder of the current window + next window
        const blockUntil = new Date(windowStart.getTime() + windowMs * 2);
        
        await jwtService.db.query(`
          UPDATE auth.rate_limits 
          SET blocked_until = $1 
          WHERE identifier = $2 AND endpoint = $3 AND window_start = $4
        `, [blockUntil, identifier, endpoint, windowStart]);

        return res.status(429).json({
          error: 'Rate limit exceeded',
          message,
          code: 'RATE_LIMIT_EXCEEDED',
          limit: max,
          window_ms: windowMs,
          retry_after: Math.ceil(windowMs / 1000),
          timestamp: new Date().toISOString()
        });
      }

      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': max,
        'X-RateLimit-Remaining': Math.max(0, max - request_count),
        'X-RateLimit-Reset': new Date(windowStart.getTime() + windowMs).toISOString(),
        'X-RateLimit-Window': windowMs
      });

      next();

    } catch (error) {
      logger.error('Rate limiting error', { error: error.message });
      // Continue without rate limiting if error occurs
      next();
    }
  };
}

/**
 * Audit logging middleware
 * @param {Object} jwtService - JWT service with database access
 * @returns {Function} Express middleware
 */
export function createAuditMiddleware(jwtService) {
  return (req, res, next) => {
    // Capture original end function
    const originalEnd = res.end;

    res.end = async function(chunk, encoding) {
      // Log the request after response
      if (jwtService.db && req.user) {
        try {
          await jwtService.db.query(`
            INSERT INTO auth.audit_log (
              user_id, event_type, event_data, ip_address, 
              user_agent, success, session_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            req.user.id,
            `${req.method}:${req.path}`,
            {
              method: req.method,
              path: req.path,
              query: req.query,
              status: res.statusCode,
              auth_type: req.auth?.type
            },
            req.ip,
            req.get('User-Agent'),
            res.statusCode < 400,
            req.auth?.session_id || null
          ]);
        } catch (error) {
          logger.error('Audit logging failed', { error: error.message });
        }
      }

      // Call original end function
      originalEnd.call(this, chunk, encoding);
    };

    next();
  };
}

export default {
  createAuthMiddleware,
  requireRole,
  requireScopes,
  createRateLimitMiddleware,
  createAuditMiddleware
};

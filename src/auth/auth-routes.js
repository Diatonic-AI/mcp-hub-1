import { registerRoute } from '../utils/router.js';
import { createAuthMiddleware, requireRole, requireScopes, createRateLimitMiddleware, createAuditMiddleware } from './middleware.js';
import { AuthenticationError, ValidationError, ServerError, wrapError } from '../utils/errors.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';

/**
 * Register authentication routes
 * @param {Object} services - Service instances
 * @param {Object} services.jwtService - JWT service
 * @param {Object} services.oauthService - OAuth service
 * @param {Object} services.db - Database connection
 */
export function registerAuthRoutes(services) {
  const { jwtService, oauthService, db } = services;

  // Create middleware instances
  const authMiddleware = createAuthMiddleware(jwtService, { optional: false });
  const optionalAuth = createAuthMiddleware(jwtService, { optional: true });
  const adminAuth = createAuthMiddleware(jwtService, { requiredRole: 'admin' });
  const rateLimiter = createRateLimitMiddleware(jwtService, { max: 20, windowMs: 15 * 60 * 1000 });
  const auditLogger = createAuditMiddleware(jwtService);

  // Apply audit logging to all auth routes
  // Note: In actual implementation, this would be applied at the router level

  // 1. Login with username/password
  registerRoute(
    'POST',
    '/auth/login',
    'Authenticate user with email and password',
    [rateLimiter], // Apply rate limiting to login attempts
    async (req, res) => {
      try {
        const { email, password, remember_me = false } = req.body;

        if (!email || !password) {
          throw new ValidationError('Email and password are required');
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          throw new ValidationError('Invalid email format');
        }

        // Authenticate user
        const result = await db.query(
          'SELECT * FROM auth.authenticate_user($1, $2)',
          [email, password]
        );

        if (result.rows.length === 0) {
          // Log failed login attempt
          await db.query(`
            INSERT INTO auth.audit_log (
              event_type, event_data, ip_address, user_agent, success, error_message
            ) VALUES ($1, $2, $3, $4, $5, $6)
          `, [
            'login_failed',
            { email, reason: 'invalid_credentials' },
            req.ip,
            req.get('User-Agent'),
            false,
            'Invalid email or password'
          ]);

          throw new AuthenticationError('Invalid email or password');
        }

        const user = result.rows[0];

        if (!user.is_active) {
          throw new AuthenticationError('User account is inactive');
        }

        if (!user.is_verified) {
          throw new AuthenticationError('Please verify your email address');
        }

        // Generate JWT tokens
        const tokenOptions = {
          scopes: ['read', 'write'],
          userAgent: req.get('User-Agent'),
          ipAddress: req.ip
        };

        const tokenPair = await jwtService.generateTokenPair(user, tokenOptions);

        // Create session
        const sessionToken = crypto.randomBytes(32).toString('hex');
        const csrfToken = crypto.randomBytes(16).toString('hex');
        const expiresAt = remember_me 
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
          : new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        const sessionId = await db.query(
          'SELECT auth.create_session($1, $2, $3, $4, $5, $6)',
          [user.user_id, sessionToken, csrfToken, expiresAt, req.ip, req.get('User-Agent')]
        );

        // Log successful login
        await db.query(`
          INSERT INTO auth.audit_log (
            user_id, event_type, event_data, ip_address, user_agent, success, session_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          user.user_id,
          'login_success',
          { email, auth_method: 'password' },
          req.ip,
          req.get('User-Agent'),
          true,
          sessionId.rows[0].create_session
        ]);

        // Set secure session cookie
        res.cookie('session_token', sessionToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: remember_me ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
        });

        res.cookie('csrf_token', csrfToken, {
          httpOnly: false, // Accessible to JavaScript for CSRF protection
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: remember_me ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
        });

        res.json({
          message: 'Login successful',
          user: {
            id: user.user_id,
            username: user.username,
            email: user.email,
            role: user.role
          },
          tokens: tokenPair,
          session: {
            expires_at: expiresAt,
            remember_me
          }
        });

      } catch (error) {
        throw wrapError(error, 'LOGIN_ERROR');
      }
    }
  );

  // 2. Logout
  registerRoute(
    'POST',
    '/auth/logout',
    'Logout user and invalidate tokens',
    [authMiddleware, auditLogger],
    async (req, res) => {
      try {
        const sessionToken = req.cookies.session_token;
        const jti = req.auth?.jti;

        // Revoke session
        if (sessionToken) {
          await db.query('SELECT auth.revoke_session($1)', [sessionToken]);
        }

        // Revoke JWT token
        if (jti) {
          await jwtService.revokeToken(jti);
        }

        // Clear cookies
        res.clearCookie('session_token');
        res.clearCookie('csrf_token');

        res.json({
          message: 'Logout successful'
        });

      } catch (error) {
        throw wrapError(error, 'LOGOUT_ERROR');
      }
    }
  );

  // 3. Refresh token
  registerRoute(
    'POST',
    '/auth/refresh',
    'Refresh access token using refresh token',
    [rateLimiter],
    async (req, res) => {
      try {
        const { refresh_token } = req.body;

        if (!refresh_token) {
          throw new ValidationError('Refresh token is required');
        }

        const tokenPair = await jwtService.refreshTokenPair(refresh_token, {
          userAgent: req.get('User-Agent'),
          ipAddress: req.ip
        });

        res.json({
          message: 'Token refreshed successfully',
          tokens: tokenPair
        });

      } catch (error) {
        throw wrapError(error, 'TOKEN_REFRESH_ERROR');
      }
    }
  );

  // 4. Get current user profile
  registerRoute(
    'GET',
    '/auth/me',
    'Get current user profile',
    [authMiddleware],
    async (req, res) => {
      try {
        const userId = req.user.id;

        const result = await db.query(`
          SELECT 
            u.id, u.username, u.email, u.first_name, u.last_name, 
            u.role, u.is_active, u.is_verified, u.avatar_url, 
            u.created_at, u.last_login_at, u.metadata,
            array_agg(DISTINCT oc.provider) FILTER (WHERE oc.provider IS NOT NULL) as oauth_providers
          FROM auth.users u
          LEFT JOIN auth.oauth_connections oc ON u.id = oc.user_id
          WHERE u.id = $1
          GROUP BY u.id
        `, [userId]);

        if (result.rows.length === 0) {
          throw new AuthenticationError('User not found');
        }

        const user = result.rows[0];

        res.json({
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            role: user.role,
            is_active: user.is_active,
            is_verified: user.is_verified,
            avatar_url: user.avatar_url,
            created_at: user.created_at,
            last_login_at: user.last_login_at,
            oauth_providers: user.oauth_providers || [],
            metadata: user.metadata || {}
          },
          auth: {
            type: req.auth.type,
            scopes: req.auth.scopes,
            expires_at: req.auth.expires_at
          }
        });

      } catch (error) {
        throw wrapError(error, 'USER_PROFILE_ERROR');
      }
    }
  );

  // 5. Update user profile
  registerRoute(
    'PATCH',
    '/auth/me',
    'Update current user profile',
    [authMiddleware, auditLogger],
    async (req, res) => {
      try {
        const userId = req.user.id;
        const { first_name, last_name, avatar_url, metadata } = req.body;

        const updateFields = [];
        const updateValues = [];
        let paramCount = 1;

        if (first_name !== undefined) {
          updateFields.push(`first_name = $${paramCount++}`);
          updateValues.push(first_name);
        }

        if (last_name !== undefined) {
          updateFields.push(`last_name = $${paramCount++}`);
          updateValues.push(last_name);
        }

        if (avatar_url !== undefined) {
          updateFields.push(`avatar_url = $${paramCount++}`);
          updateValues.push(avatar_url);
        }

        if (metadata !== undefined) {
          updateFields.push(`metadata = $${paramCount++}`);
          updateValues.push(JSON.stringify(metadata));
        }

        if (updateFields.length === 0) {
          throw new ValidationError('No fields to update');
        }

        updateFields.push(`updated_at = NOW()`);
        updateValues.push(userId);

        const result = await db.query(`
          UPDATE auth.users 
          SET ${updateFields.join(', ')}
          WHERE id = $${paramCount}
          RETURNING id, username, email, first_name, last_name, 
                   avatar_url, updated_at, metadata
        `, updateValues);

        res.json({
          message: 'Profile updated successfully',
          user: result.rows[0]
        });

      } catch (error) {
        throw wrapError(error, 'PROFILE_UPDATE_ERROR');
      }
    }
  );

  // 6. OAuth providers list
  registerRoute(
    'GET',
    '/auth/oauth/providers',
    'Get list of available OAuth providers',
    [],
    async (req, res) => {
      try {
        const providers = oauthService.getAvailableProviders().map(provider => ({
          name: provider,
          display_name: provider.charAt(0).toUpperCase() + provider.slice(1),
          auth_url: `/api/auth/oauth/${provider}`
        }));

        res.json({
          providers,
          count: providers.length
        });

      } catch (error) {
        throw wrapError(error, 'OAUTH_PROVIDERS_ERROR');
      }
    }
  );

  // 7. OAuth authentication initiation
  registerRoute(
    'GET',
    '/auth/oauth/:provider',
    'Initiate OAuth authentication with provider',
    [rateLimiter],
    async (req, res) => {
      try {
        const { provider } = req.params;
        const { redirect_uri } = req.query;

        const authUrl = oauthService.getAuthUrl(provider, {
          additionalParams: redirect_uri ? { redirect_uri } : {},
          metadata: { user_ip: req.ip, user_agent: req.get('User-Agent') }
        });

        res.redirect(authUrl);

      } catch (error) {
        throw wrapError(error, 'OAUTH_INITIATION_ERROR');
      }
    }
  );

  // 8. OAuth callback handling
  registerRoute(
    'GET',
    '/auth/oauth/:provider/callback',
    'Handle OAuth callback from provider',
    [],
    async (req, res) => {
      try {
        const { provider } = req.params;
        const { code, state, error: oauthError } = req.query;

        if (oauthError) {
          throw new AuthenticationError(`OAuth error: ${oauthError}`);
        }

        if (!code || !state) {
          throw new ValidationError('Missing OAuth callback parameters');
        }

        const authResult = await oauthService.handleCallback(provider, code, state);

        // Create session
        const sessionToken = crypto.randomBytes(32).toString('hex');
        const csrfToken = crypto.randomBytes(16).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        const sessionId = await db.query(
          'SELECT auth.create_session($1, $2, $3, $4, $5, $6)',
          [authResult.user.id, sessionToken, csrfToken, expiresAt, req.ip, req.get('User-Agent')]
        );

        // Set secure session cookies
        res.cookie('session_token', sessionToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 24 * 60 * 60 * 1000
        });

        res.cookie('csrf_token', csrfToken, {
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 24 * 60 * 60 * 1000
        });

        // Return success page or redirect
        res.send(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>MCP Hub - OAuth Success</title>
              <style>
                body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; }
                .success { color: #2ed573; }
                .info { color: #747d8c; margin-top: 20px; }
              </style>
            </head>
            <body>
              <h1 class="success">Authentication Successful!</h1>
              <p>Welcome, ${authResult.user.username}!</p>
              <p class="info">You can now close this window and return to the application.</p>
              <script>
                // Post message to parent window if in popup
                if (window.opener) {
                  window.opener.postMessage({
                    type: 'OAUTH_SUCCESS',
                    user: ${JSON.stringify(authResult.user)},
                    isNewUser: ${authResult.isNewUser}
                  }, '*');
                  window.close();
                }
              </script>
            </body>
          </html>
        `);

      } catch (error) {
        logger.error('OAuth callback error', { 
          error: error.message, 
          provider: req.params.provider 
        });

        res.status(400).send(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>MCP Hub - OAuth Error</title>
              <style>
                body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; }
                .error { color: #ff4757; }
                .info { color: #747d8c; margin-top: 20px; }
              </style>
            </head>
            <body>
              <h1 class="error">Authentication Failed</h1>
              <p>Error: ${error.message}</p>
              <p class="info">Please try again or contact support if the problem persists.</p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({
                    type: 'OAUTH_ERROR',
                    error: '${error.message}'
                  }, '*');
                  window.close();
                }
              </script>
            </body>
          </html>
        `);
      }
    }
  );

  // 9. Create API key
  registerRoute(
    'POST',
    '/auth/api-keys',
    'Create new API key',
    [authMiddleware, auditLogger],
    async (req, res) => {
      try {
        const { name, scopes = ['read'], expires_at } = req.body;

        if (!name) {
          throw new ValidationError('API key name is required');
        }

        const expiresAt = expires_at ? new Date(expires_at) : null;
        
        const apiKey = await jwtService.createApiKey(req.user, name, {
          scopes,
          expiresAt,
          metadata: {
            created_via: 'api',
            user_agent: req.get('User-Agent'),
            ip_address: req.ip
          }
        });

        res.status(201).json({
          message: 'API key created successfully',
          api_key: apiKey
        });

      } catch (error) {
        throw wrapError(error, 'API_KEY_CREATION_ERROR');
      }
    }
  );

  // 10. List API keys
  registerRoute(
    'GET',
    '/auth/api-keys',
    'List user API keys',
    [authMiddleware],
    async (req, res) => {
      try {
        const result = await db.query(`
          SELECT 
            id, key_name, key_prefix, scopes, is_active,
            last_used_at, usage_count, expires_at, created_at
          FROM auth.api_keys
          WHERE user_id = $1
          ORDER BY created_at DESC
        `, [req.user.id]);

        res.json({
          api_keys: result.rows,
          count: result.rows.length
        });

      } catch (error) {
        throw wrapError(error, 'API_KEYS_LIST_ERROR');
      }
    }
  );

  // 11. Delete API key
  registerRoute(
    'DELETE',
    '/auth/api-keys/:keyId',
    'Delete API key',
    [authMiddleware, auditLogger],
    async (req, res) => {
      try {
        const { keyId } = req.params;

        const result = await db.query(`
          UPDATE auth.api_keys 
          SET is_active = false, updated_at = NOW()
          WHERE id = $1 AND user_id = $2
          RETURNING key_name
        `, [keyId, req.user.id]);

        if (result.rows.length === 0) {
          throw new ValidationError('API key not found');
        }

        res.json({
          message: 'API key deleted successfully',
          key_name: result.rows[0].key_name
        });

      } catch (error) {
        throw wrapError(error, 'API_KEY_DELETE_ERROR');
      }
    }
  );

  // 12. Admin: List all users
  registerRoute(
    'GET',
    '/auth/admin/users',
    'List all users (admin only)',
    [adminAuth],
    async (req, res) => {
      try {
        const { page = 1, limit = 20, search = '', role = '' } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        let whereClause = 'WHERE 1=1';
        const queryParams = [];
        let paramCount = 1;

        if (search) {
          whereClause += ` AND (username ILIKE $${paramCount} OR email ILIKE $${paramCount})`;
          queryParams.push(`%${search}%`);
          paramCount++;
        }

        if (role && role !== 'all') {
          whereClause += ` AND role = $${paramCount}`;
          queryParams.push(role);
          paramCount++;
        }

        const result = await db.query(`
          SELECT 
            id, username, email, first_name, last_name, role,
            is_active, is_verified, oauth_provider, created_at, last_login_at
          FROM auth.users
          ${whereClause}
          ORDER BY created_at DESC
          LIMIT $${paramCount} OFFSET $${paramCount + 1}
        `, [...queryParams, parseInt(limit), offset]);

        const countResult = await db.query(`
          SELECT COUNT(*) as total FROM auth.users ${whereClause}
        `, queryParams);

        res.json({
          users: result.rows,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: parseInt(countResult.rows[0].total),
            pages: Math.ceil(countResult.rows[0].total / parseInt(limit))
          }
        });

      } catch (error) {
        throw wrapError(error, 'ADMIN_USERS_LIST_ERROR');
      }
    }
  );

  // 13. Admin: Update user
  registerRoute(
    'PATCH',
    '/auth/admin/users/:userId',
    'Update user (admin only)',
    [adminAuth, auditLogger],
    async (req, res) => {
      try {
        const { userId } = req.params;
        const { role, is_active, is_verified } = req.body;

        const updateFields = [];
        const updateValues = [];
        let paramCount = 1;

        if (role !== undefined) {
          updateFields.push(`role = $${paramCount++}`);
          updateValues.push(role);
        }

        if (is_active !== undefined) {
          updateFields.push(`is_active = $${paramCount++}`);
          updateValues.push(is_active);
        }

        if (is_verified !== undefined) {
          updateFields.push(`is_verified = $${paramCount++}`);
          updateValues.push(is_verified);
        }

        if (updateFields.length === 0) {
          throw new ValidationError('No fields to update');
        }

        updateFields.push(`updated_at = NOW()`);
        updateValues.push(userId);

        const result = await db.query(`
          UPDATE auth.users 
          SET ${updateFields.join(', ')}
          WHERE id = $${paramCount}
          RETURNING id, username, email, role, is_active, is_verified, updated_at
        `, updateValues);

        if (result.rows.length === 0) {
          throw new ValidationError('User not found');
        }

        res.json({
          message: 'User updated successfully',
          user: result.rows[0]
        });

      } catch (error) {
        throw wrapError(error, 'ADMIN_USER_UPDATE_ERROR');
      }
    }
  );

  logger.info('Authentication routes registered', {
    routeCount: 13,
    hasOAuth: !!oauthService,
    hasJWT: !!jwtService,
    hasDB: !!db
  });
}

export default registerAuthRoutes;

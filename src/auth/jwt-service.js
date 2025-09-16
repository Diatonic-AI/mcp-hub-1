import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createHash } from 'crypto';
import { AuthenticationError, AuthorizationError, ValidationError } from '../utils/errors.js';
import logger from '../utils/logger.js';

export class JWTService {
  constructor(options = {}) {
    // JWT configuration
    this.jwtSecret = options.jwtSecret || process.env.JWT_SECRET || this.generateSecureSecret();
    this.jwtRefreshSecret = options.jwtRefreshSecret || process.env.JWT_REFRESH_SECRET || this.generateSecureSecret();
    this.jwtIssuer = options.jwtIssuer || process.env.JWT_ISSUER || 'mcp-hub';
    this.jwtAudience = options.jwtAudience || process.env.JWT_AUDIENCE || 'mcp-hub-api';
    
    // Token expiration times
    this.accessTokenExpiry = options.accessTokenExpiry || '15m';
    this.refreshTokenExpiry = options.refreshTokenExpiry || '7d';
    this.apiTokenExpiry = options.apiTokenExpiry || '30d';
    
    // Database connection will be injected
    this.db = null;
    
    if (!this.jwtSecret || this.jwtSecret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters long');
    }
    
    logger.info('JWT Service initialized', {
      issuer: this.jwtIssuer,
      audience: this.jwtAudience,
      accessTokenExpiry: this.accessTokenExpiry,
      refreshTokenExpiry: this.refreshTokenExpiry
    });
  }

  setDatabase(db) {
    this.db = db;
  }

  generateSecureSecret() {
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * Generate a JWT token
   * @param {Object} payload - Token payload
   * @param {string} type - Token type: 'access', 'refresh', 'api'
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Token data
   */
  async generateToken(payload, type = 'access', options = {}) {
    try {
      const jti = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      
      let expiresIn, secret;
      switch (type) {
        case 'access':
          expiresIn = this.accessTokenExpiry;
          secret = this.jwtSecret;
          break;
        case 'refresh':
          expiresIn = this.refreshTokenExpiry;
          secret = this.jwtRefreshSecret;
          break;
        case 'api':
          expiresIn = this.apiTokenExpiry;
          secret = this.jwtSecret;
          break;
        default:
          throw new ValidationError(`Invalid token type: ${type}`);
      }

      const tokenPayload = {
        ...payload,
        jti,
        iat: now,
        iss: this.jwtIssuer,
        aud: this.jwtAudience,
        type
      };

      const token = jwt.sign(tokenPayload, secret, {
        expiresIn,
        algorithm: 'HS256'
      });

      const decoded = jwt.decode(token);
      const expiresAt = new Date(decoded.exp * 1000);
      const tokenHash = this.hashToken(token);

      // Store token in database for blacklisting/validation
      if (this.db) {
        await this.db.query(`
          INSERT INTO auth.jwt_tokens (
            user_id, token_type, jti, token_hash, expires_at, 
            user_agent, ip_address, scopes, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          payload.user_id,
          type,
          jti,
          tokenHash,
          expiresAt,
          options.userAgent || null,
          options.ipAddress || null,
          payload.scopes || [],
          options.metadata || {}
        ]);
      }

      return {
        token,
        jti,
        expires_at: expiresAt,
        expires_in: decoded.exp - now,
        type
      };

    } catch (error) {
      logger.error('Failed to generate JWT token', { error: error.message, type });
      throw new AuthenticationError(`Failed to generate ${type} token`, { originalError: error.message });
    }
  }

  /**
   * Verify and decode a JWT token
   * @param {string} token - JWT token
   * @param {string} type - Expected token type
   * @returns {Promise<Object>} Decoded token payload
   */
  async verifyToken(token, type = 'access') {
    try {
      let secret;
      switch (type) {
        case 'access':
        case 'api':
          secret = this.jwtSecret;
          break;
        case 'refresh':
          secret = this.jwtRefreshSecret;
          break;
        default:
          throw new ValidationError(`Invalid token type: ${type}`);
      }

      // Verify JWT signature and expiration
      const decoded = jwt.verify(token, secret, {
        issuer: this.jwtIssuer,
        audience: this.jwtAudience,
        algorithms: ['HS256']
      });

      // Verify token type matches expected
      if (decoded.type !== type) {
        throw new AuthenticationError(`Token type mismatch. Expected: ${type}, Got: ${decoded.type}`);
      }

      // Check if token is blacklisted in database
      if (this.db) {
        const tokenHash = this.hashToken(token);
        const result = await this.db.query(`
          SELECT is_revoked, expires_at 
          FROM auth.jwt_tokens 
          WHERE jti = $1 AND token_hash = $2
        `, [decoded.jti, tokenHash]);

        if (result.rows.length === 0) {
          throw new AuthenticationError('Token not found in database');
        }

        const tokenRecord = result.rows[0];
        if (tokenRecord.is_revoked) {
          throw new AuthenticationError('Token has been revoked');
        }

        if (new Date(tokenRecord.expires_at) < new Date()) {
          throw new AuthenticationError('Token has expired');
        }

        // Update last used timestamp
        await this.db.query(`
          UPDATE auth.jwt_tokens 
          SET last_used_at = NOW() 
          WHERE jti = $1
        `, [decoded.jti]);
      }

      return decoded;

    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AuthenticationError('Token has expired');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AuthenticationError(`Invalid token: ${error.message}`);
      }
      if (error instanceof AuthenticationError || error instanceof ValidationError) {
        throw error;
      }
      
      logger.error('JWT verification failed', { error: error.message });
      throw new AuthenticationError('Token verification failed');
    }
  }

  /**
   * Revoke a token by JTI
   * @param {string} jti - JWT ID
   * @returns {Promise<boolean>} Success status
   */
  async revokeToken(jti) {
    if (!this.db) {
      throw new Error('Database not configured');
    }

    try {
      const result = await this.db.query(`
        UPDATE auth.jwt_tokens 
        SET is_revoked = true 
        WHERE jti = $1 
        RETURNING id
      `, [jti]);

      const revoked = result.rows.length > 0;
      
      if (revoked) {
        logger.info('JWT token revoked', { jti });
      }
      
      return revoked;

    } catch (error) {
      logger.error('Failed to revoke JWT token', { error: error.message, jti });
      throw error;
    }
  }

  /**
   * Revoke all tokens for a user
   * @param {string} userId - User ID
   * @param {string} exceptJti - JTI to exclude from revocation
   * @returns {Promise<number>} Number of tokens revoked
   */
  async revokeUserTokens(userId, exceptJti = null) {
    if (!this.db) {
      throw new Error('Database not configured');
    }

    try {
      let query = 'UPDATE auth.jwt_tokens SET is_revoked = true WHERE user_id = $1';
      let params = [userId];

      if (exceptJti) {
        query += ' AND jti != $2';
        params.push(exceptJti);
      }

      query += ' RETURNING id';

      const result = await this.db.query(query, params);
      const revokedCount = result.rows.length;

      logger.info('User JWT tokens revoked', { userId, revokedCount, exceptJti });
      return revokedCount;

    } catch (error) {
      logger.error('Failed to revoke user JWT tokens', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * Generate a token pair (access + refresh)
   * @param {Object} user - User data
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Token pair
   */
  async generateTokenPair(user, options = {}) {
    const payload = {
      user_id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      scopes: options.scopes || ['read', 'write']
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.generateToken(payload, 'access', options),
      this.generateToken(payload, 'refresh', options)
    ]);

    return {
      access_token: accessToken.token,
      refresh_token: refreshToken.token,
      token_type: 'Bearer',
      expires_in: accessToken.expires_in,
      expires_at: accessToken.expires_at,
      refresh_expires_at: refreshToken.expires_at,
      jti: accessToken.jti,
      refresh_jti: refreshToken.jti
    };
  }

  /**
   * Refresh an access token using a refresh token
   * @param {string} refreshToken - Refresh token
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} New token pair
   */
  async refreshTokenPair(refreshToken, options = {}) {
    const decoded = await this.verifyToken(refreshToken, 'refresh');
    
    // Get current user data to ensure they're still active
    if (!this.db) {
      throw new Error('Database not configured');
    }

    const userResult = await this.db.query(`
      SELECT id, username, email, role, is_active, is_verified 
      FROM auth.users 
      WHERE id = $1
    `, [decoded.user_id]);

    if (userResult.rows.length === 0) {
      throw new AuthenticationError('User not found');
    }

    const user = userResult.rows[0];
    if (!user.is_active) {
      throw new AuthenticationError('User account is inactive');
    }

    // Generate new token pair
    const newTokenPair = await this.generateTokenPair(user, {
      ...options,
      scopes: decoded.scopes
    });

    // Optionally revoke the old refresh token
    if (options.revokeOldRefresh !== false) {
      await this.revokeToken(decoded.jti);
    }

    return newTokenPair;
  }

  /**
   * Create API key for service-to-service authentication
   * @param {Object} user - User creating the API key
   * @param {string} keyName - Name for the API key
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} API key data
   */
  async createApiKey(user, keyName, options = {}) {
    const apiKey = `mcp_${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = this.hashToken(apiKey);
    const keyPrefix = apiKey.substring(0, 8);

    const expiresAt = options.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    if (!this.db) {
      throw new Error('Database not configured');
    }

    const result = await this.db.query(`
      INSERT INTO auth.api_keys (
        user_id, key_name, key_hash, key_prefix, scopes, 
        expires_at, created_by, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, created_at
    `, [
      user.id,
      keyName,
      keyHash,
      keyPrefix,
      options.scopes || ['read'],
      expiresAt,
      user.id,
      options.metadata || {}
    ]);

    logger.info('API key created', { 
      userId: user.id, 
      keyName, 
      keyPrefix,
      scopes: options.scopes || ['read']
    });

    return {
      id: result.rows[0].id,
      api_key: apiKey, // Return the plain key only once
      key_prefix: keyPrefix,
      key_name: keyName,
      scopes: options.scopes || ['read'],
      expires_at: expiresAt,
      created_at: result.rows[0].created_at
    };
  }

  /**
   * Validate API key
   * @param {string} apiKey - API key
   * @returns {Promise<Object>} API key data and user info
   */
  async validateApiKey(apiKey) {
    if (!this.db) {
      throw new Error('Database not configured');
    }

    const keyHash = this.hashToken(apiKey);

    const result = await this.db.query(`
      SELECT ak.*, u.username, u.email, u.role, u.is_active
      FROM auth.api_keys ak
      JOIN auth.users u ON ak.user_id = u.id
      WHERE ak.key_hash = $1 
      AND ak.is_active = true 
      AND (ak.expires_at IS NULL OR ak.expires_at > NOW())
      AND u.is_active = true
    `, [keyHash]);

    if (result.rows.length === 0) {
      throw new AuthenticationError('Invalid or expired API key');
    }

    const apiKeyData = result.rows[0];

    // Update usage statistics
    await this.db.query(`
      UPDATE auth.api_keys 
      SET last_used_at = NOW(), usage_count = usage_count + 1
      WHERE id = $1
    `, [apiKeyData.id]);

    return {
      id: apiKeyData.id,
      user_id: apiKeyData.user_id,
      username: apiKeyData.username,
      email: apiKeyData.email,
      role: apiKeyData.role,
      key_name: apiKeyData.key_name,
      scopes: apiKeyData.scopes,
      usage_count: apiKeyData.usage_count + 1
    };
  }

  /**
   * Hash a token for secure storage
   * @param {string} token - Token to hash
   * @returns {string} Hashed token
   */
  hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Clean expired tokens
   * @returns {Promise<number>} Number of cleaned tokens
   */
  async cleanExpiredTokens() {
    if (!this.db) {
      return 0;
    }

    try {
      const result = await this.db.query(`
        UPDATE auth.jwt_tokens 
        SET is_revoked = true 
        WHERE expires_at < NOW() AND is_revoked = false
        RETURNING id
      `);

      const cleanedCount = result.rows.length;
      
      if (cleanedCount > 0) {
        logger.info('Cleaned expired JWT tokens', { count: cleanedCount });
      }

      return cleanedCount;

    } catch (error) {
      logger.error('Failed to clean expired tokens', { error: error.message });
      throw error;
    }
  }
}

export default JWTService;

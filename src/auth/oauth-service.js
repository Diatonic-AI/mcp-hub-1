import crypto from 'crypto';
import { AuthenticationError, ValidationError } from '../utils/errors.js';
import logger from '../utils/logger.js';

export class OAuthService {
  constructor(options = {}) {
    this.providers = {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUri: process.env.GOOGLE_REDIRECT_URI || `${process.env.HUB_SERVER_URL}/api/auth/oauth/google/callback`,
        scopes: ['openid', 'email', 'profile'],
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo'
      },
      github: {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        redirectUri: process.env.GITHUB_REDIRECT_URI || `${process.env.HUB_SERVER_URL}/api/auth/oauth/github/callback`,
        scopes: ['user:email'],
        authUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userInfoUrl: 'https://api.github.com/user'
      },
      microsoft: {
        clientId: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        redirectUri: process.env.MICROSOFT_REDIRECT_URI || `${process.env.HUB_SERVER_URL}/api/auth/oauth/microsoft/callback`,
        scopes: ['openid', 'email', 'profile'],
        authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        userInfoUrl: 'https://graph.microsoft.com/v1.0/me'
      }
    };

    this.db = null;
    this.jwtService = null;
    this.encryptionKey = process.env.OAUTH_ENCRYPTION_KEY || this.generateEncryptionKey();
    
    logger.info('OAuth Service initialized', {
      providers: Object.keys(this.providers).filter(p => this.providers[p].clientId),
      hasEncryptionKey: !!this.encryptionKey
    });
  }

  setDatabase(db) {
    this.db = db;
  }

  setJwtService(jwtService) {
    this.jwtService = jwtService;
  }

  generateEncryptionKey() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Generate OAuth authorization URL
   * @param {string} provider - OAuth provider (google, github, microsoft)
   * @param {Object} options - Additional options
   * @returns {string} Authorization URL
   */
  getAuthUrl(provider, options = {}) {
    const providerConfig = this.providers[provider];
    if (!providerConfig || !providerConfig.clientId) {
      throw new ValidationError(`OAuth provider '${provider}' not configured`);
    }

    const state = crypto.randomBytes(32).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');

    const params = new URLSearchParams({
      client_id: providerConfig.clientId,
      redirect_uri: providerConfig.redirectUri,
      response_type: 'code',
      scope: providerConfig.scopes.join(' '),
      state,
      ...options.additionalParams
    });

    // Add nonce for OpenID Connect providers
    if (provider === 'google' || provider === 'microsoft') {
      params.set('nonce', nonce);
    }

    // Store state for verification
    if (this.db) {
      this.storeOAuthState(state, {
        provider,
        nonce,
        redirectUri: options.redirectUri || providerConfig.redirectUri,
        metadata: options.metadata || {}
      });
    }

    return `${providerConfig.authUrl}?${params.toString()}`;
  }

  /**
   * Handle OAuth callback and complete authentication
   * @param {string} provider - OAuth provider
   * @param {string} code - Authorization code
   * @param {string} state - State parameter
   * @returns {Promise<Object>} Authentication result
   */
  async handleCallback(provider, code, state) {
    try {
      const providerConfig = this.providers[provider];
      if (!providerConfig) {
        throw new ValidationError(`Unknown OAuth provider: ${provider}`);
      }

      // Verify state parameter
      const stateData = await this.verifyOAuthState(state);
      if (stateData.provider !== provider) {
        throw new AuthenticationError('Invalid OAuth state parameter');
      }

      // Exchange authorization code for tokens
      const tokens = await this.exchangeCodeForTokens(provider, code, providerConfig);

      // Get user profile from provider
      const profile = await this.getUserProfile(provider, tokens.access_token, providerConfig);

      // Find or create user
      const user = await this.findOrCreateUser(provider, profile, tokens);

      // Generate JWT tokens
      if (!this.jwtService) {
        throw new Error('JWT service not configured');
      }

      const tokenPair = await this.jwtService.generateTokenPair(user, {
        scopes: ['read', 'write'],
        userAgent: 'OAuth Login',
        metadata: {
          oauth_provider: provider,
          oauth_login: true
        }
      });

      // Log authentication event
      if (this.db) {
        await this.db.query(`
          INSERT INTO auth.audit_log (
            user_id, event_type, event_data, success
          ) VALUES ($1, $2, $3, $4)
        `, [
          user.id,
          'oauth_login',
          {
            provider,
            oauth_id: profile.id,
            email: profile.email
          },
          true
        ]);
      }

      return {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role,
          avatar_url: user.avatar_url
        },
        tokens: tokenPair,
        provider,
        isNewUser: user.isNewUser || false
      };

    } catch (error) {
      logger.error('OAuth callback failed', { 
        error: error.message, 
        provider, 
        hasCode: !!code, 
        hasState: !!state 
      });

      // Log failed authentication attempt
      if (this.db) {
        try {
          await this.db.query(`
            INSERT INTO auth.audit_log (
              event_type, event_data, success, error_message
            ) VALUES ($1, $2, $3, $4)
          `, [
            'oauth_login_failed',
            { provider },
            false,
            error.message
          ]);
        } catch (auditError) {
          logger.error('Failed to log OAuth failure', { error: auditError.message });
        }
      }

      throw error;
    }
  }

  /**
   * Exchange authorization code for access token
   * @private
   */
  async exchangeCodeForTokens(provider, code, providerConfig) {
    const params = new URLSearchParams({
      client_id: providerConfig.clientId,
      client_secret: providerConfig.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: providerConfig.redirectUri
    });

    const response = await fetch(providerConfig.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: params
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AuthenticationError(`Token exchange failed: ${errorText}`);
    }

    const tokens = await response.json();

    if (!tokens.access_token) {
      throw new AuthenticationError('No access token received from OAuth provider');
    }

    return tokens;
  }

  /**
   * Get user profile from OAuth provider
   * @private
   */
  async getUserProfile(provider, accessToken, providerConfig) {
    const response = await fetch(providerConfig.userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new AuthenticationError('Failed to fetch user profile from OAuth provider');
    }

    const profile = await response.json();

    // Normalize profile data across providers
    let normalizedProfile = {
      id: profile.id || profile.sub,
      email: profile.email,
      name: profile.name || profile.displayName,
      avatar_url: profile.picture || profile.avatar_url
    };

    // Provider-specific normalization
    switch (provider) {
      case 'google':
        normalizedProfile.first_name = profile.given_name;
        normalizedProfile.last_name = profile.family_name;
        break;
      case 'github':
        normalizedProfile.username = profile.login;
        if (!normalizedProfile.email) {
          // Fetch email separately for GitHub (if user email is private)
          normalizedProfile.email = await this.getGitHubUserEmail(accessToken);
        }
        break;
      case 'microsoft':
        normalizedProfile.first_name = profile.givenName;
        normalizedProfile.last_name = profile.surname;
        normalizedProfile.username = profile.userPrincipalName;
        break;
    }

    if (!normalizedProfile.email) {
      throw new AuthenticationError('Email not provided by OAuth provider');
    }

    return normalizedProfile;
  }

  /**
   * Get GitHub user email (for when email is private)
   * @private
   */
  async getGitHubUserEmail(accessToken) {
    const response = await fetch('https://api.github.com/user/emails', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      return null;
    }

    const emails = await response.json();
    const primaryEmail = emails.find(email => email.primary && email.verified);
    return primaryEmail ? primaryEmail.email : null;
  }

  /**
   * Find existing user or create new one
   * @private
   */
  async findOrCreateUser(provider, profile, tokens) {
    if (!this.db) {
      throw new Error('Database not configured');
    }

    // Try to find existing user by OAuth connection
    let result = await this.db.query(`
      SELECT u.*, oc.id as oauth_connection_id
      FROM auth.users u
      JOIN auth.oauth_connections oc ON u.id = oc.user_id
      WHERE oc.provider = $1 AND oc.provider_user_id = $2
    `, [provider, profile.id.toString()]);

    let user;
    let isNewUser = false;

    if (result.rows.length > 0) {
      // Update existing user
      user = result.rows[0];
      
      // Update OAuth connection tokens
      await this.updateOAuthConnection(user.oauth_connection_id, tokens, profile);
      
      // Update user profile if needed
      if (profile.avatar_url && profile.avatar_url !== user.avatar_url) {
        await this.db.query(`
          UPDATE auth.users 
          SET avatar_url = $1, updated_at = NOW()
          WHERE id = $2
        `, [profile.avatar_url, user.id]);
        user.avatar_url = profile.avatar_url;
      }

    } else {
      // Try to find user by email
      result = await this.db.query(`
        SELECT * FROM auth.users WHERE email = $1
      `, [profile.email]);

      if (result.rows.length > 0) {
        // Link existing user account to OAuth provider
        user = result.rows[0];
        await this.createOAuthConnection(user.id, provider, profile, tokens);
      } else {
        // Create new user
        user = await this.createNewUser(provider, profile, tokens);
        isNewUser = true;
      }
    }

    user.isNewUser = isNewUser;
    return user;
  }

  /**
   * Create new user from OAuth profile
   * @private
   */
  async createNewUser(provider, profile, tokens) {
    const username = profile.username || 
                    profile.email.split('@')[0] || 
                    `${provider}_user_${Date.now()}`;

    const result = await this.db.query(`
      INSERT INTO auth.users (
        username, email, first_name, last_name, 
        oauth_provider, oauth_id, avatar_url, is_active, is_verified
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, true)
      RETURNING *
    `, [
      username,
      profile.email,
      profile.first_name || profile.name?.split(' ')[0] || '',
      profile.last_name || profile.name?.split(' ').slice(1).join(' ') || '',
      provider,
      profile.id.toString(),
      profile.avatar_url
    ]);

    const user = result.rows[0];

    // Create OAuth connection
    await this.createOAuthConnection(user.id, provider, profile, tokens);

    logger.info('New user created via OAuth', {
      userId: user.id,
      email: profile.email,
      provider
    });

    return user;
  }

  /**
   * Create OAuth connection record
   * @private
   */
  async createOAuthConnection(userId, provider, profile, tokens) {
    const encryptedAccessToken = this.encrypt(tokens.access_token);
    const encryptedRefreshToken = tokens.refresh_token ? this.encrypt(tokens.refresh_token) : null;

    await this.db.query(`
      INSERT INTO auth.oauth_connections (
        user_id, provider, provider_user_id, provider_username, 
        provider_email, access_token, refresh_token, token_expires_at,
        scopes, raw_profile
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      userId,
      provider,
      profile.id.toString(),
      profile.username || null,
      profile.email,
      encryptedAccessToken,
      encryptedRefreshToken,
      tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
      [], // scopes would be extracted from tokens if available
      JSON.stringify(profile)
    ]);
  }

  /**
   * Update OAuth connection record
   * @private
   */
  async updateOAuthConnection(connectionId, tokens, profile) {
    const encryptedAccessToken = this.encrypt(tokens.access_token);
    const encryptedRefreshToken = tokens.refresh_token ? this.encrypt(tokens.refresh_token) : null;

    await this.db.query(`
      UPDATE auth.oauth_connections 
      SET 
        access_token = $1,
        refresh_token = $2,
        token_expires_at = $3,
        raw_profile = $4,
        updated_at = NOW()
      WHERE id = $5
    `, [
      encryptedAccessToken,
      encryptedRefreshToken,
      tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
      JSON.stringify(profile),
      connectionId
    ]);
  }

  /**
   * Store OAuth state for verification
   * @private
   */
  async storeOAuthState(state, data) {
    if (!this.db) return;

    try {
      // Store state with 10 minute expiration
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      
      await this.db.query(`
        INSERT INTO auth.oauth_states (state, data, expires_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (state) DO UPDATE SET
          data = EXCLUDED.data,
          expires_at = EXCLUDED.expires_at
      `, [state, JSON.stringify(data), expiresAt]);

    } catch (error) {
      logger.error('Failed to store OAuth state', { error: error.message });
    }
  }

  /**
   * Verify OAuth state parameter
   * @private
   */
  async verifyOAuthState(state) {
    if (!this.db) {
      throw new AuthenticationError('Cannot verify OAuth state - database not configured');
    }

    const result = await this.db.query(`
      SELECT data FROM auth.oauth_states 
      WHERE state = $1 AND expires_at > NOW()
    `, [state]);

    if (result.rows.length === 0) {
      throw new AuthenticationError('Invalid or expired OAuth state parameter');
    }

    // Clean up used state
    await this.db.query(`
      DELETE FROM auth.oauth_states WHERE state = $1
    `, [state]);

    return JSON.parse(result.rows[0].data);
  }

  /**
   * Encrypt sensitive data
   * @private
   */
  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt sensitive data
   * @private
   */
  decrypt(text) {
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKey);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Get list of configured OAuth providers
   * @returns {Array} List of available providers
   */
  getAvailableProviders() {
    return Object.keys(this.providers).filter(provider => 
      this.providers[provider].clientId && this.providers[provider].clientSecret
    );
  }

  /**
   * Clean expired OAuth states
   * @returns {Promise<number>} Number of cleaned states
   */
  async cleanExpiredStates() {
    if (!this.db) return 0;

    try {
      const result = await this.db.query(`
        DELETE FROM auth.oauth_states WHERE expires_at < NOW()
        RETURNING id
      `);

      const cleanedCount = result.rows.length;
      if (cleanedCount > 0) {
        logger.info('Cleaned expired OAuth states', { count: cleanedCount });
      }

      return cleanedCount;
    } catch (error) {
      logger.error('Failed to clean expired OAuth states', { error: error.message });
      return 0;
    }
  }
}

export default OAuthService;

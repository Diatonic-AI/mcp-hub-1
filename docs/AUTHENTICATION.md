# MCP Hub Authentication System

This document describes how to set up and use the comprehensive authentication system for MCP Hub, which includes JWT tokens, OAuth providers, user management, and database-backed sessions.

## Overview

The authentication system provides:

- **JWT-based authentication** with access and refresh tokens
- **OAuth integration** with Google, GitHub, and Microsoft
- **User management** with roles and permissions
- **API key management** for service-to-service authentication
- **Session management** with secure cookies
- **Rate limiting** and audit logging
- **PostgreSQL-backed** user storage and session management

## Quick Start

### 1. Database Setup

First, create a PostgreSQL database for MCP Hub:

```sql
CREATE DATABASE mcp_hub;
CREATE USER mcp_hub_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE mcp_hub TO mcp_hub_user;
```

### 2. Environment Configuration

Copy `.env.example` to `.env` and configure the required variables:

```bash
cp .env.example .env
```

**Required authentication variables:**

```bash
# Database connection
DATABASE_URL=postgresql://mcp_hub_user:your_secure_password@localhost:5432/mcp_hub

# JWT secrets (generate strong random keys)
JWT_SECRET=your-super-secret-jwt-key-here-make-it-long-and-secure
JWT_REFRESH_SECRET=another-super-secret-refresh-key-different-from-access
```

**Optional OAuth providers (configure only the ones you want):**

```bash
# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:37373/api/auth/oauth/google/callback

# GitHub OAuth  
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_REDIRECT_URI=http://localhost:37373/api/auth/oauth/github/callback

# Microsoft OAuth
MICROSOFT_CLIENT_ID=your-microsoft-client-id
MICROSOFT_CLIENT_SECRET=your-microsoft-client-secret
MICROSOFT_REDIRECT_URI=http://localhost:37373/api/auth/oauth/microsoft/callback
```

### 3. Start MCP Hub

The authentication system will automatically:
- Create the database schema on first run
- Initialize JWT services
- Set up OAuth providers (if configured)
- Register authentication routes

```bash
npm start
```

## OAuth Provider Setup

### Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API
4. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client IDs"
5. Set authorized redirect URIs: `http://localhost:37373/api/auth/oauth/google/callback`
6. Copy the Client ID and Client Secret to your `.env` file

### GitHub OAuth

1. Go to GitHub → Settings → Developer settings → OAuth Apps
2. Click "New OAuth App"
3. Set Authorization callback URL: `http://localhost:37373/api/auth/oauth/github/callback`
4. Copy the Client ID and Client Secret to your `.env` file

### Microsoft OAuth

1. Go to [Azure Portal](https://portal.azure.com/)
2. Navigate to Azure Active Directory → App registrations
3. Click "New registration"
4. Set redirect URI: `http://localhost:37373/api/auth/oauth/microsoft/callback`
5. Copy the Application ID and Client Secret to your `.env` file

## API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login with email/password |
| POST | `/api/auth/logout` | Logout and invalidate tokens |
| POST | `/api/auth/refresh` | Refresh access token |
| GET | `/api/auth/me` | Get current user profile |
| PATCH | `/api/auth/me` | Update user profile |

### OAuth

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/oauth/providers` | List available OAuth providers |
| GET | `/api/auth/oauth/:provider` | Initiate OAuth flow |
| GET | `/api/auth/oauth/:provider/callback` | Handle OAuth callback |

### API Keys

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/api-keys` | Create new API key |
| GET | `/api/auth/api-keys` | List user's API keys |
| DELETE | `/api/auth/api-keys/:keyId` | Delete API key |

### Admin (requires admin role)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/admin/users` | List all users |
| PATCH | `/api/auth/admin/users/:userId` | Update user |

## Using Authentication

### JWT Tokens

Include the JWT token in the Authorization header:

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     http://localhost:37373/api/auth/me
```

### API Keys

Include the API key in the Authorization header:

```bash
curl -H "Authorization: Api-Key YOUR_API_KEY" \
     http://localhost:37373/api/servers
```

### Session Cookies

The system automatically sets secure HTTP-only cookies for browser-based authentication:

```javascript
// Login via browser
fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include', // Include cookies
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'password123'
  })
});
```

## User Management

### Creating Users

Users can be created through OAuth login or by an admin. Currently, password-based registration is handled through the authentication system (you may want to add a registration endpoint).

### User Roles

The system supports flexible role-based access:

- **admin**: Full access to all resources and user management
- **user**: Standard user access to MCP tools and personal resources  
- **service**: For API-based access (useful for CI/CD, automation)

### User Permissions

Permissions are based on:
- **Roles**: admin, user, service
- **Scopes**: read, write, admin
- **Resource ownership**: users can only modify their own resources

## Security Features

### JWT Security

- Separate access (short-lived) and refresh (long-lived) tokens
- Token blacklisting for immediate revocation
- Secure token storage and transmission
- Configurable expiration times

### Session Security  

- HTTP-only cookies prevent XSS attacks
- Secure flag for HTTPS-only transmission
- CSRF protection with token validation
- Session invalidation on logout

### Database Security

- Password hashing with bcrypt
- SQL injection prevention with parameterized queries
- Row-level security for multi-tenant isolation
- Audit logging for all authentication events

### Rate Limiting

- Login attempt limiting (20 attempts per 15 minutes)
- API request throttling
- Configurable rate limits per endpoint

## Monitoring and Logging

### Health Check

Check authentication system status:

```bash
curl http://localhost:37373/api/health
```

Returns authentication status:

```json
{
  "status": "ok",
  "authentication": {
    "enabled": true,
    "hasJWT": true,
    "hasOAuth": true,
    "oauthProviders": ["google", "github"]
  }
}
```

### Audit Logs

All authentication events are logged to the database:

- Login attempts (success/failure)
- Token generation and revocation
- API key usage
- Admin actions
- OAuth authentication flows

### Metrics

The system tracks:

- Active sessions
- Token usage
- API key usage
- Failed authentication attempts
- OAuth provider usage

## Development

### Testing Authentication

For development, you can test the authentication system:

```bash
# Test database connection
npm run test:db

# Test authentication endpoints
npm run test:auth

# Run all tests
npm test
```

### Adding Custom Authentication

You can extend the authentication system:

```javascript
// Custom middleware
import { createAuthMiddleware } from './src/auth/middleware.js';

const customAuth = createAuthMiddleware(jwtService, {
  requiredScopes: ['admin'],
  requiredRole: 'service'
});

app.get('/api/admin/special', customAuth, (req, res) => {
  // Only admin service accounts can access this
  res.json({ message: 'Secret admin data' });
});
```

### Database Migrations

The system automatically runs database migrations on startup. To manually manage migrations:

```bash
# Run pending migrations
npm run migrate

# Create new migration
npm run migrate:create add_user_preferences
```

## Troubleshooting

### Common Issues

**Database connection failed:**
- Check DATABASE_URL format: `postgresql://user:pass@host:port/dbname`
- Verify PostgreSQL is running and accessible
- Check firewall settings

**OAuth provider not working:**
- Verify client ID and secret are correct
- Check redirect URI matches exactly (including protocol and port)
- Ensure OAuth app is enabled and published

**JWT tokens not working:**
- Verify JWT_SECRET and JWT_REFRESH_SECRET are set
- Check token hasn't expired
- Ensure Authorization header format: `Bearer TOKEN`

**SSL/TLS issues:**
- Set `PGSSL_MODE=disable` for local development
- For production, ensure proper SSL certificates

### Debug Mode

Enable debug logging:

```bash
export DEBUG=mcp-hub:auth:*
export LOG_LEVEL=debug
npm start
```

### Support

For issues or questions:

1. Check the logs for error details
2. Verify environment configuration
3. Test database connectivity
4. Review OAuth provider setup
5. Check firewall and network settings

## Production Deployment

### Security Checklist

- [ ] Use strong, randomly generated JWT secrets
- [ ] Enable SSL/TLS with valid certificates
- [ ] Configure proper CORS settings
- [ ] Set secure cookie options
- [ ] Enable rate limiting
- [ ] Regular database backups
- [ ] Monitor authentication logs
- [ ] Keep dependencies updated

### Environment Variables

Ensure these are set for production:

```bash
NODE_ENV=production
DATABASE_URL=postgresql://...
JWT_SECRET=...
JWT_REFRESH_SECRET=...
BASE_URL=https://yourdomain.com
```

### Database Scaling

For high-traffic deployments:

- Use connection pooling (configured by default)
- Consider read replicas for user queries
- Monitor connection pool usage
- Set appropriate pool limits

### Monitoring

Set up monitoring for:

- Database connection health
- Authentication success/failure rates
- Token generation/validation performance  
- OAuth provider response times
- Session and API key usage patterns

This completes the comprehensive authentication system for MCP Hub. The system is production-ready and provides enterprise-grade security features while remaining easy to use and extend.

# MCP Hub with Authentication Example

This example demonstrates how to run MCP Hub with the full authentication system enabled, including PostgreSQL database integration and OAuth providers.

## Prerequisites

1. **Node.js** (v18 or later)
2. **PostgreSQL** database server running
3. **OAuth provider accounts** (optional, for Google/GitHub/Microsoft login)

## Setup

### 1. Database Setup

Create a PostgreSQL database and user:

```sql
CREATE DATABASE mcp_hub;
CREATE USER mcp_hub_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE mcp_hub TO mcp_hub_user;
```

### 2. Environment Configuration

Copy the environment example and configure it:

```bash
cd examples/with-auth
cp .env.example .env
# Edit .env with your actual values
```

**Required configuration:**
- `DATABASE_URL`: Your PostgreSQL connection string
- `JWT_SECRET`: Strong random key for JWT tokens
- `JWT_REFRESH_SECRET`: Different strong random key for refresh tokens

**Optional OAuth configuration:**
- Google, GitHub, or Microsoft OAuth credentials (see main [AUTHENTICATION.md](../../docs/AUTHENTICATION.md) for setup instructions)

### 3. Install Dependencies

From the root directory:

```bash
npm install
```

### 4. Run the Example

```bash
cd examples/with-auth
node server.js
```

The server will start and:
- Initialize database connection
- Create authentication schema automatically
- Start MCP Hub with authentication enabled
- Be accessible at `http://localhost:3000`

## Testing Authentication

### Check Health Endpoint

```bash
curl http://localhost:3000/api/health
```

Should return authentication status:

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

### List OAuth Providers

```bash
curl http://localhost:3000/api/auth/oauth/providers
```

### Test OAuth Login

Visit in your browser:
- Google: `http://localhost:3000/api/auth/oauth/google`
- GitHub: `http://localhost:3000/api/auth/oauth/github` 
- Microsoft: `http://localhost:3000/api/auth/oauth/microsoft`

### Create API Key (after OAuth login)

1. First login via OAuth in browser
2. Get session cookie
3. Create API key:

```bash
curl -X POST http://localhost:3000/api/auth/api-keys \
  -H "Content-Type: application/json" \
  -H "Cookie: session_token=YOUR_SESSION_TOKEN" \
  -d '{"name": "Test API Key", "scopes": ["read", "write"]}'
```

### Use API Key

```bash
curl -H "Authorization: Api-Key YOUR_API_KEY" \
     http://localhost:3000/api/servers
```

## Features Demonstrated

This example shows:

✅ **Database Integration**: PostgreSQL connection with connection pooling  
✅ **JWT Authentication**: Access and refresh tokens  
✅ **OAuth Providers**: Google, GitHub, Microsoft login  
✅ **API Keys**: Service-to-service authentication  
✅ **Session Management**: Secure cookie-based sessions  
✅ **User Management**: Profile management and roles  
✅ **Rate Limiting**: Protection against abuse  
✅ **Audit Logging**: All authentication events logged  
✅ **Automatic Schema**: Database schema created on startup  

## Troubleshooting

**Database connection error:**
- Check if PostgreSQL is running
- Verify DATABASE_URL format and credentials
- Ensure database exists and user has permissions

**OAuth not working:**
- Check client ID/secret configuration
- Verify redirect URIs match exactly
- Ensure OAuth apps are enabled and published

**Port already in use:**
- Change PORT in .env file
- Update OAuth redirect URIs to match new port

**JWT errors:**
- Ensure JWT_SECRET and JWT_REFRESH_SECRET are set
- Check tokens haven't expired
- Verify Authorization header format

## Next Steps

After running this example successfully:

1. **Integrate with your MCP servers** - Configure `./config/mcp-servers.json`
2. **Set up OAuth providers** - Follow [OAuth setup guide](../../docs/AUTHENTICATION.md#oauth-provider-setup)
3. **Configure production deployment** - See [production checklist](../../docs/AUTHENTICATION.md#production-deployment)
4. **Add custom authentication** - Extend middleware and routes as needed

## Files Overview

- `server.js` - Main server file with authentication integration
- `.env.example` - Environment configuration template  
- `README.md` - This documentation

For complete authentication system documentation, see [AUTHENTICATION.md](../../docs/AUTHENTICATION.md).

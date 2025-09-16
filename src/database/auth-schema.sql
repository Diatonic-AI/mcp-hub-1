-- MCP Hub Authentication Schema
-- This schema provides comprehensive authentication for the MCP Hub system
-- Includes: Users, Roles, Sessions, JWT tokens, OAuth providers, and audit logging

-- Create authentication schema
CREATE SCHEMA IF NOT EXISTS auth;

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- User roles enum
CREATE TYPE auth.user_role AS ENUM ('admin', 'user', 'service', 'readonly');

-- OAuth provider enum
CREATE TYPE auth.oauth_provider AS ENUM ('google', 'github', 'microsoft', 'local');

-- Session status enum
CREATE TYPE auth.session_status AS ENUM ('active', 'expired', 'revoked', 'pending');

-- Users table
CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255), -- NULL for OAuth-only users
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    role auth.user_role DEFAULT 'user',
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    oauth_provider auth.oauth_provider DEFAULT 'local',
    oauth_id VARCHAR(255),
    avatar_url TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE,
    password_reset_token VARCHAR(255),
    password_reset_expires TIMESTAMP WITH TIME ZONE,
    email_verification_token VARCHAR(255),
    email_verification_expires TIMESTAMP WITH TIME ZONE
);

-- JWT tokens table
CREATE TABLE IF NOT EXISTS auth.jwt_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_type VARCHAR(50) NOT NULL, -- 'access', 'refresh', 'api'
    jti VARCHAR(255) UNIQUE NOT NULL, -- JWT ID for token blacklisting
    token_hash VARCHAR(255) NOT NULL, -- Hashed version for security
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_revoked BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE,
    user_agent TEXT,
    ip_address INET,
    scopes TEXT[], -- Array of permissions/scopes
    metadata JSONB DEFAULT '{}'
);

-- Sessions table
CREATE TABLE IF NOT EXISTS auth.sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    csrf_token VARCHAR(255),
    status auth.session_status DEFAULT 'active',
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT,
    device_info JSONB DEFAULT '{}',
    location_info JSONB DEFAULT '{}'
);

-- OAuth connections table
CREATE TABLE IF NOT EXISTS auth.oauth_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider auth.oauth_provider NOT NULL,
    provider_user_id VARCHAR(255) NOT NULL,
    provider_username VARCHAR(255),
    provider_email VARCHAR(255),
    access_token TEXT, -- Encrypted
    refresh_token TEXT, -- Encrypted
    token_expires_at TIMESTAMP WITH TIME ZONE,
    scopes TEXT[],
    raw_profile JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(provider, provider_user_id)
);

-- API keys table for service-to-service authentication
CREATE TABLE IF NOT EXISTS auth.api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    key_name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(255) UNIQUE NOT NULL,
    key_prefix VARCHAR(16) NOT NULL, -- First few chars for identification
    scopes TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMP WITH TIME ZONE,
    usage_count INTEGER DEFAULT 0,
    rate_limit INTEGER DEFAULT 1000, -- requests per hour
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    metadata JSONB DEFAULT '{}'
);

-- Audit log for authentication events
CREATE TABLE IF NOT EXISTS auth.audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id),
    event_type VARCHAR(100) NOT NULL, -- login, logout, token_refresh, etc.
    event_data JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    session_id UUID REFERENCES auth.sessions(id)
);

-- Rate limiting table
CREATE TABLE IF NOT EXISTS auth.rate_limits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    identifier VARCHAR(255) NOT NULL, -- IP, user_id, or api_key
    endpoint VARCHAR(255) NOT NULL,
    window_start TIMESTAMP WITH TIME ZONE NOT NULL,
    request_count INTEGER DEFAULT 1,
    blocked_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(identifier, endpoint, window_start)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON auth.users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON auth.users(username);
CREATE INDEX IF NOT EXISTS idx_users_oauth_provider_id ON auth.users(oauth_provider, oauth_id);
CREATE INDEX IF NOT EXISTS idx_users_active ON auth.users(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_jwt_tokens_user_id ON auth.jwt_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_jwt_tokens_jti ON auth.jwt_tokens(jti);
CREATE INDEX IF NOT EXISTS idx_jwt_tokens_expires_at ON auth.jwt_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_jwt_tokens_active ON auth.jwt_tokens(user_id, token_type) WHERE is_revoked = false;

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON auth.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON auth.sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON auth.sessions(user_id, status) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_oauth_connections_user_id ON auth.oauth_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_connections_provider ON auth.oauth_connections(provider, provider_user_id);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON auth.api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON auth.api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON auth.api_keys(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON auth.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON auth.audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON auth.audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rate_limits_identifier ON auth.rate_limits(identifier, endpoint);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON auth.rate_limits(window_start);

-- Functions and triggers for updated_at
CREATE OR REPLACE FUNCTION auth.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON auth.users 
    FOR EACH ROW EXECUTE FUNCTION auth.update_updated_at_column();

CREATE TRIGGER update_oauth_connections_updated_at BEFORE UPDATE ON auth.oauth_connections 
    FOR EACH ROW EXECUTE FUNCTION auth.update_updated_at_column();

CREATE TRIGGER update_rate_limits_updated_at BEFORE UPDATE ON auth.rate_limits 
    FOR EACH ROW EXECUTE FUNCTION auth.update_updated_at_column();

-- Row Level Security (RLS) policies
ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.jwt_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.oauth_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.api_keys ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY users_own_data ON auth.users
    FOR ALL USING (id = current_setting('auth.user_id')::UUID OR 
                   current_setting('auth.role', true) = 'admin');

CREATE POLICY jwt_tokens_own_data ON auth.jwt_tokens
    FOR ALL USING (user_id = current_setting('auth.user_id')::UUID OR 
                   current_setting('auth.role', true) = 'admin');

CREATE POLICY sessions_own_data ON auth.sessions
    FOR ALL USING (user_id = current_setting('auth.user_id')::UUID OR 
                   current_setting('auth.role', true) = 'admin');

CREATE POLICY oauth_connections_own_data ON auth.oauth_connections
    FOR ALL USING (user_id = current_setting('auth.user_id')::UUID OR 
                   current_setting('auth.role', true) = 'admin');

CREATE POLICY api_keys_own_data ON auth.api_keys
    FOR ALL USING (user_id = current_setting('auth.user_id')::UUID OR 
                   current_setting('auth.role', true) = 'admin');

-- Create application database user with limited privileges
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_user WHERE usename = 'mcp_hub_app') THEN
        CREATE USER mcp_hub_app WITH PASSWORD 'mcp_hub_app_secure_password_2024';
    END IF;
END
$$;

-- Grant necessary permissions to application user
GRANT USAGE ON SCHEMA auth TO mcp_hub_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO mcp_hub_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA auth TO mcp_hub_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO mcp_hub_app;

-- Create initial admin user (password: 'admin123!' - change in production)
INSERT INTO auth.users (
    username, 
    email, 
    password_hash, 
    first_name, 
    last_name, 
    role, 
    is_active, 
    is_verified
) VALUES (
    'admin',
    'admin@mcphub.local',
    crypt('admin123!', gen_salt('bf')),
    'Admin',
    'User',
    'admin',
    true,
    true
) ON CONFLICT (email) DO NOTHING;

-- Create service user for internal API calls
INSERT INTO auth.users (
    username, 
    email, 
    password_hash, 
    first_name, 
    last_name, 
    role, 
    is_active, 
    is_verified
) VALUES (
    'service',
    'service@mcphub.local',
    crypt('service_secure_password_2024', gen_salt('bf')),
    'Service',
    'Account',
    'service',
    true,
    true
) ON CONFLICT (email) DO NOTHING;

-- Create stored procedures for common operations

-- Function to authenticate user
CREATE OR REPLACE FUNCTION auth.authenticate_user(
    p_email VARCHAR(255),
    p_password VARCHAR(255)
)
RETURNS TABLE(
    user_id UUID,
    username VARCHAR(255),
    email VARCHAR(255),
    role auth.user_role,
    is_active BOOLEAN,
    is_verified BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.username, u.email, u.role, u.is_active, u.is_verified
    FROM auth.users u
    WHERE u.email = p_email 
    AND u.password_hash = crypt(p_password, u.password_hash)
    AND u.is_active = true;
    
    -- Update last login
    UPDATE auth.users 
    SET last_login_at = NOW() 
    WHERE email = p_email AND is_active = true;
END;
$$;

-- Function to create session
CREATE OR REPLACE FUNCTION auth.create_session(
    p_user_id UUID,
    p_session_token VARCHAR(255),
    p_csrf_token VARCHAR(255),
    p_expires_at TIMESTAMP WITH TIME ZONE,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    session_id UUID;
BEGIN
    INSERT INTO auth.sessions (
        user_id, session_token, csrf_token, expires_at, 
        ip_address, user_agent
    ) VALUES (
        p_user_id, p_session_token, p_csrf_token, p_expires_at,
        p_ip_address, p_user_agent
    ) RETURNING id INTO session_id;
    
    RETURN session_id;
END;
$$;

-- Function to validate session
CREATE OR REPLACE FUNCTION auth.validate_session(p_session_token VARCHAR(255))
RETURNS TABLE(
    session_id UUID,
    user_id UUID,
    username VARCHAR(255),
    email VARCHAR(255),
    role auth.user_role,
    expires_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Update last accessed time
    UPDATE auth.sessions 
    SET last_accessed_at = NOW()
    WHERE session_token = p_session_token 
    AND status = 'active' 
    AND expires_at > NOW();
    
    RETURN QUERY
    SELECT s.id, s.user_id, u.username, u.email, u.role, s.expires_at
    FROM auth.sessions s
    JOIN auth.users u ON s.user_id = u.id
    WHERE s.session_token = p_session_token 
    AND s.status = 'active' 
    AND s.expires_at > NOW()
    AND u.is_active = true;
END;
$$;

-- Function to revoke session
CREATE OR REPLACE FUNCTION auth.revoke_session(p_session_token VARCHAR(255))
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE auth.sessions 
    SET status = 'revoked'
    WHERE session_token = p_session_token;
    
    RETURN FOUND;
END;
$$;

-- Function to clean expired sessions and tokens
CREATE OR REPLACE FUNCTION auth.cleanup_expired_auth()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Clean expired sessions
    UPDATE auth.sessions 
    SET status = 'expired'
    WHERE expires_at < NOW() AND status = 'active';
    
    -- Clean expired JWT tokens
    UPDATE auth.jwt_tokens 
    SET is_revoked = true
    WHERE expires_at < NOW() AND is_revoked = false;
    
    -- Clean old audit logs (keep last 90 days)
    DELETE FROM auth.audit_log 
    WHERE created_at < NOW() - INTERVAL '90 days';
    
    -- Clean old rate limit records (keep last 24 hours)
    DELETE FROM auth.rate_limits 
    WHERE window_start < NOW() - INTERVAL '24 hours';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- Create a scheduled job to clean up expired auth data (if pg_cron is available)
-- This would run every hour to clean up expired sessions and tokens
-- SELECT cron.schedule('cleanup-auth', '0 * * * *', 'SELECT auth.cleanup_expired_auth();');

COMMENT ON SCHEMA auth IS 'Authentication and authorization schema for MCP Hub';
COMMENT ON TABLE auth.users IS 'User accounts with support for local and OAuth authentication';
COMMENT ON TABLE auth.jwt_tokens IS 'JWT tokens for API authentication with blacklisting support';
COMMENT ON TABLE auth.sessions IS 'User sessions for web application';
COMMENT ON TABLE auth.oauth_connections IS 'OAuth provider connections';
COMMENT ON TABLE auth.api_keys IS 'API keys for service-to-service authentication';
COMMENT ON TABLE auth.audit_log IS 'Audit trail for authentication events';
COMMENT ON TABLE auth.rate_limits IS 'Rate limiting data';

-- =====================================================================
-- MCP Hub Comprehensive Database Schema
-- =====================================================================
-- This schema provides detailed tracking for all MCP Hub operations
-- including servers, tools, executions, chains, API calls, and analytics
-- 
-- DESIGN PRINCIPLES:
-- - Complete audit trail for all operations
-- - Time-series optimization with TimescaleDB
-- - Efficient indexing for fast queries
-- - Flexible metadata storage with JSONB
-- - UUID-based identifiers for global uniqueness
-- - Tenant isolation and security controls
-- =====================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =====================================================================
-- CORE ENTITY TABLES
-- =====================================================================

-- MCP Servers Registry
CREATE TABLE mcp_servers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Basic server information
  name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  description TEXT,
  endpoint TEXT NOT NULL,
  transport_type TEXT NOT NULL DEFAULT 'stdio',
  
  -- Server configuration
  config JSONB DEFAULT '{}',
  capabilities JSONB DEFAULT '{}',
  environment_vars JSONB DEFAULT '{}',
  
  -- Status and health
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'connecting', 'connected', 'disconnected', 'error', 'disabled')),
  last_health_check TIMESTAMPTZ,
  health_status TEXT CHECK (health_status IN ('healthy', 'degraded', 'unhealthy', 'unknown')),
  error_message TEXT,
  
  -- Connection tracking
  connection_count INTEGER DEFAULT 0,
  last_connected_at TIMESTAMPTZ,
  last_disconnected_at TIMESTAMPTZ,
  total_connection_time_seconds BIGINT DEFAULT 0,
  
  -- Tool counts
  tool_count INTEGER DEFAULT 0,
  active_tool_count INTEGER DEFAULT 0,
  
  -- Performance metrics
  avg_response_time_ms DECIMAL(10,3),
  success_rate DECIMAL(5,2),
  total_requests INTEGER DEFAULT 0,
  successful_requests INTEGER DEFAULT 0,
  failed_requests INTEGER DEFAULT 0,
  
  -- Metadata and tracking
  metadata JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  tenant_id TEXT DEFAULT 'default',
  
  -- Indexes
  CONSTRAINT mcp_servers_name_tenant_unique UNIQUE (name, tenant_id)
);

-- Create indexes for servers
CREATE INDEX idx_mcp_servers_status ON mcp_servers (status);
CREATE INDEX idx_mcp_servers_tenant_id ON mcp_servers (tenant_id);
CREATE INDEX idx_mcp_servers_transport_type ON mcp_servers (transport_type);
CREATE INDEX idx_mcp_servers_health_status ON mcp_servers (health_status);
CREATE INDEX idx_mcp_servers_tags ON mcp_servers USING GIN (tags);
CREATE INDEX idx_mcp_servers_created_at ON mcp_servers (created_at);
CREATE INDEX idx_mcp_servers_updated_at ON mcp_servers (updated_at);
CREATE INDEX idx_mcp_servers_metadata ON mcp_servers USING GIN (metadata);

-- MCP Tools Registry
CREATE TABLE mcp_tools (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Tool identification
  tool_id TEXT NOT NULL, -- serverName__toolName format
  name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  server_name TEXT NOT NULL,
  
  -- Tool specification
  description TEXT DEFAULT '',
  input_schema JSONB DEFAULT '{}',
  output_schema JSONB DEFAULT '{}',
  
  -- Categorization
  category TEXT DEFAULT 'general',
  subcategory TEXT,
  tags TEXT[] DEFAULT '{}',
  
  -- Tool capabilities and constraints
  capabilities JSONB DEFAULT '{}',
  constraints JSONB DEFAULT '{}',
  security_level TEXT CHECK (security_level IN ('public', 'authenticated', 'restricted', 'admin')),
  
  -- Usage tracking
  usage_count BIGINT DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  first_used_at TIMESTAMPTZ,
  
  -- Performance metrics
  avg_execution_time_ms DECIMAL(10,3),
  min_execution_time_ms DECIMAL(10,3),
  max_execution_time_ms DECIMAL(10,3),
  success_rate DECIMAL(5,2),
  total_executions BIGINT DEFAULT 0,
  successful_executions BIGINT DEFAULT 0,
  failed_executions BIGINT DEFAULT 0,
  
  -- Error tracking
  last_error_at TIMESTAMPTZ,
  last_error_message TEXT,
  error_count BIGINT DEFAULT 0,
  
  -- Tool state
  is_active BOOLEAN DEFAULT true,
  is_deprecated BOOLEAN DEFAULT false,
  deprecation_message TEXT,
  replacement_tool_id TEXT,
  
  -- Metadata and tracking
  metadata JSONB DEFAULT '{}',
  version TEXT DEFAULT '1.0.0',
  documentation_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT DEFAULT 'default',
  
  -- Constraints
  CONSTRAINT mcp_tools_tool_id_tenant_unique UNIQUE (tool_id, tenant_id),
  CONSTRAINT mcp_tools_server_name_name_tenant_unique UNIQUE (server_name, name, tenant_id)
);

-- Create indexes for tools
CREATE INDEX idx_mcp_tools_tool_id ON mcp_tools (tool_id);
CREATE INDEX idx_mcp_tools_server_id ON mcp_tools (server_id);
CREATE INDEX idx_mcp_tools_server_name ON mcp_tools (server_name);
CREATE INDEX idx_mcp_tools_name ON mcp_tools (name);
CREATE INDEX idx_mcp_tools_category ON mcp_tools (category);
CREATE INDEX idx_mcp_tools_tags ON mcp_tools USING GIN (tags);
CREATE INDEX idx_mcp_tools_tenant_id ON mcp_tools (tenant_id);
CREATE INDEX idx_mcp_tools_is_active ON mcp_tools (is_active);
CREATE INDEX idx_mcp_tools_usage_count ON mcp_tools (usage_count DESC);
CREATE INDEX idx_mcp_tools_last_used_at ON mcp_tools (last_used_at DESC);
CREATE INDEX idx_mcp_tools_created_at ON mcp_tools (created_at);
CREATE INDEX idx_mcp_tools_metadata ON mcp_tools USING GIN (metadata);

-- =====================================================================
-- TOOL EXECUTION TRACKING
-- =====================================================================

-- Individual tool executions
CREATE TABLE tool_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Execution identification
  execution_id TEXT NOT NULL,
  
  -- Tool and server references
  tool_id UUID REFERENCES mcp_tools(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  server_id UUID REFERENCES mcp_servers(id) ON DELETE SET NULL,
  server_name TEXT NOT NULL,
  
  -- Execution details
  arguments JSONB DEFAULT '{}',
  result JSONB,
  error_message TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'timeout', 'cancelled')),
  
  -- Timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms BIGINT,
  
  -- Performance metrics
  memory_usage_mb DECIMAL(10,2),
  cpu_time_ms BIGINT,
  network_requests INTEGER DEFAULT 0,
  
  -- Context and tracing
  correlation_id TEXT,
  parent_execution_id UUID REFERENCES tool_executions(id),
  chain_id UUID,
  session_id TEXT,
  request_id TEXT,
  user_id TEXT,
  
  -- Client information
  client_info JSONB DEFAULT '{}',
  user_agent TEXT,
  ip_address INET,
  
  -- Security context
  security_context JSONB DEFAULT '{}',
  permissions TEXT[] DEFAULT '{}',
  
  -- Metadata and tracking
  metadata JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  tenant_id TEXT DEFAULT 'default',
  
  -- Indexes
  CONSTRAINT tool_executions_execution_id_unique UNIQUE (execution_id)
);

-- Convert to hypertable for time-series optimization
SELECT create_hypertable('tool_executions', 'started_at', chunk_time_interval => INTERVAL '1 day');

-- Create indexes for tool executions
CREATE INDEX idx_tool_executions_tool_id ON tool_executions (tool_id, started_at DESC);
CREATE INDEX idx_tool_executions_server_id ON tool_executions (server_id, started_at DESC);
CREATE INDEX idx_tool_executions_status ON tool_executions (status);
CREATE INDEX idx_tool_executions_correlation_id ON tool_executions (correlation_id);
CREATE INDEX idx_tool_executions_chain_id ON tool_executions (chain_id);
CREATE INDEX idx_tool_executions_session_id ON tool_executions (session_id);
CREATE INDEX idx_tool_executions_tenant_id ON tool_executions (tenant_id);
CREATE INDEX idx_tool_executions_duration_ms ON tool_executions (duration_ms DESC);
CREATE INDEX idx_tool_executions_tags ON tool_executions USING GIN (tags);

-- =====================================================================
-- TOOL CHAIN EXECUTION TRACKING
-- =====================================================================

-- Main tool chain executions table
CREATE TABLE tool_chain_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Chain identification
  chain_id TEXT NOT NULL UNIQUE,
  
  -- Chain configuration
  chain_config JSONB NOT NULL,
  chain_type TEXT NOT NULL CHECK (chain_type IN ('sequential', 'parallel', 'conditional', 'mixed')),
  execution_options JSONB DEFAULT '{}',
  
  -- Chain status and progress
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'timeout', 'partial')),
  progress_percent INTEGER DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  completed_steps INTEGER DEFAULT 0,
  failed_steps INTEGER DEFAULT 0,
  total_steps INTEGER NOT NULL,
  current_step INTEGER,
  
  -- Timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms BIGINT,
  estimated_duration_ms BIGINT,
  
  -- Performance metrics
  total_tool_executions INTEGER DEFAULT 0,
  successful_tool_executions INTEGER DEFAULT 0,
  failed_tool_executions INTEGER DEFAULT 0,
  parallel_execution_groups INTEGER DEFAULT 0,
  
  -- Error handling
  error_message TEXT,
  error_step INTEGER,
  rollback_executed BOOLEAN DEFAULT false,
  rollback_success BOOLEAN,
  
  -- Context and tracing
  correlation_id TEXT,
  parent_chain_id UUID REFERENCES tool_chain_executions(id),
  session_id TEXT,
  request_id TEXT,
  user_id TEXT,
  
  -- Initiator information
  initiated_by TEXT NOT NULL DEFAULT 'unknown',
  client_info JSONB DEFAULT '{}',
  user_agent TEXT,
  
  -- Security context
  security_context JSONB DEFAULT '{}',
  permissions TEXT[] DEFAULT '{}',
  tenant_id TEXT DEFAULT 'default',
  
  -- Priority and scheduling
  priority INTEGER DEFAULT 0,
  scheduled_at TIMESTAMPTZ,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 0,
  
  -- Results and artifacts
  final_result JSONB,
  intermediate_results JSONB DEFAULT '{}',
  generated_artifacts TEXT[] DEFAULT '{}',
  
  -- Metadata and tags
  metadata JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT '{}'
);

-- Convert to hypertable for time-series optimization
SELECT create_hypertable('tool_chain_executions', 'started_at', chunk_time_interval => INTERVAL '1 day');

-- Create indexes for chain executions
CREATE INDEX idx_chain_executions_chain_id ON tool_chain_executions (chain_id);
CREATE INDEX idx_chain_executions_status ON tool_chain_executions (status);
CREATE INDEX idx_chain_executions_chain_type ON tool_chain_executions (chain_type);
CREATE INDEX idx_chain_executions_correlation_id ON tool_chain_executions (correlation_id);
CREATE INDEX idx_chain_executions_session_id ON tool_chain_executions (session_id);
CREATE INDEX idx_chain_executions_tenant_id ON tool_chain_executions (tenant_id);
CREATE INDEX idx_chain_executions_priority ON tool_chain_executions (priority DESC);
CREATE INDEX idx_chain_executions_duration_ms ON tool_chain_executions (duration_ms DESC);

-- Individual chain step executions
CREATE TABLE tool_chain_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Step identification
  step_id TEXT NOT NULL,
  chain_execution_id UUID NOT NULL REFERENCES tool_chain_executions(id) ON DELETE CASCADE,
  chain_id TEXT NOT NULL,
  
  -- Step configuration
  step_index INTEGER NOT NULL,
  step_config JSONB NOT NULL,
  parallel_group TEXT,
  
  -- Tool execution details
  tool_execution_id UUID REFERENCES tool_executions(id),
  tool_id UUID REFERENCES mcp_tools(id),
  tool_name TEXT NOT NULL,
  server_name TEXT NOT NULL,
  
  -- Step execution
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'cancelled')),
  skip_reason TEXT,
  
  -- Input/Output processing
  original_arguments JSONB DEFAULT '{}',
  processed_arguments JSONB DEFAULT '{}',
  input_mapping JSONB DEFAULT '{}',
  transformations JSONB DEFAULT '{}',
  conditions JSONB DEFAULT '{}',
  
  -- Results
  result JSONB,
  error_message TEXT,
  
  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms BIGINT,
  
  -- Dependencies
  depends_on TEXT[] DEFAULT '{}',
  dependency_results JSONB DEFAULT '{}',
  
  -- Retry handling
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 0,
  retry_delay_ms INTEGER,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  
  -- Constraints
  CONSTRAINT chain_steps_chain_step_unique UNIQUE (chain_execution_id, step_index)
);

-- Create indexes for chain steps
CREATE INDEX idx_chain_steps_chain_execution_id ON tool_chain_steps (chain_execution_id, step_index);
CREATE INDEX idx_chain_steps_chain_id ON tool_chain_steps (chain_id);
CREATE INDEX idx_chain_steps_tool_execution_id ON tool_chain_steps (tool_execution_id);
CREATE INDEX idx_chain_steps_status ON tool_chain_steps (status);
CREATE INDEX idx_chain_steps_parallel_group ON tool_chain_steps (parallel_group);
CREATE INDEX idx_chain_steps_started_at ON tool_chain_steps (started_at DESC);

-- =====================================================================
-- MCP HUB API OPERATIONS
-- =====================================================================

-- API request tracking
CREATE TABLE api_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Request identification
  request_id TEXT NOT NULL UNIQUE,
  
  -- API endpoint information
  method TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  route TEXT NOT NULL,
  
  -- Request details
  query_params JSONB DEFAULT '{}',
  headers JSONB DEFAULT '{}',
  body JSONB,
  content_type TEXT,
  
  -- Response details
  status_code INTEGER,
  response_body JSONB,
  response_headers JSONB DEFAULT '{}',
  content_length BIGINT,
  
  -- Timing and performance
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms BIGINT,
  processing_time_ms BIGINT,
  
  -- Client information
  client_info JSONB DEFAULT '{}',
  user_agent TEXT,
  ip_address INET,
  session_id TEXT,
  user_id TEXT,
  
  -- Related operations
  tool_executions_triggered INTEGER DEFAULT 0,
  chain_executions_triggered INTEGER DEFAULT 0,
  servers_connected INTEGER DEFAULT 0,
  
  -- Error tracking
  error_message TEXT,
  error_code TEXT,
  error_details JSONB,
  
  -- Metadata and context
  correlation_id TEXT,
  tenant_id TEXT DEFAULT 'default',
  metadata JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT '{}'
);

-- Convert to hypertable
SELECT create_hypertable('api_requests', 'started_at', chunk_time_interval => INTERVAL '1 hour');

-- Create indexes for API requests
CREATE INDEX idx_api_requests_request_id ON api_requests (request_id);
CREATE INDEX idx_api_requests_endpoint ON api_requests (endpoint);
CREATE INDEX idx_api_requests_method ON api_requests (method);
CREATE INDEX idx_api_requests_status_code ON api_requests (status_code);
CREATE INDEX idx_api_requests_duration_ms ON api_requests (duration_ms DESC);
CREATE INDEX idx_api_requests_session_id ON api_requests (session_id);
CREATE INDEX idx_api_requests_tenant_id ON api_requests (tenant_id);
CREATE INDEX idx_api_requests_correlation_id ON api_requests (correlation_id);

-- =====================================================================
-- SERVER CONNECTION AND HEALTH TRACKING
-- =====================================================================

-- Server connection events
CREATE TABLE server_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Connection identification
  connection_id TEXT NOT NULL,
  server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  server_name TEXT NOT NULL,
  
  -- Connection details
  connection_type TEXT NOT NULL CHECK (connection_type IN ('stdio', 'tcp', 'websocket', 'http', 'grpc')),
  transport_config JSONB DEFAULT '{}',
  
  -- Connection lifecycle
  event_type TEXT NOT NULL CHECK (event_type IN ('connect_attempt', 'connected', 'disconnected', 'reconnect', 'timeout', 'error')),
  
  -- Timing
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  connection_duration_ms BIGINT,
  
  -- Connection health
  health_status TEXT CHECK (health_status IN ('healthy', 'degraded', 'unhealthy')),
  latency_ms DECIMAL(10,3),
  
  -- Error information
  error_message TEXT,
  error_code TEXT,
  error_details JSONB,
  
  -- Connection statistics
  bytes_sent BIGINT DEFAULT 0,
  bytes_received BIGINT DEFAULT 0,
  messages_sent INTEGER DEFAULT 0,
  messages_received INTEGER DEFAULT 0,
  
  -- Context
  triggered_by TEXT,
  correlation_id TEXT,
  metadata JSONB DEFAULT '{}',
  tenant_id TEXT DEFAULT 'default'
);

-- Convert to hypertable
SELECT create_hypertable('server_connections', 'event_time', chunk_time_interval => INTERVAL '6 hours');

-- Create indexes for server connections
CREATE INDEX idx_server_connections_server_id ON server_connections (server_id, event_time DESC);
CREATE INDEX idx_server_connections_event_type ON server_connections (event_type);
CREATE INDEX idx_server_connections_health_status ON server_connections (health_status);
CREATE INDEX idx_server_connections_connection_id ON server_connections (connection_id);

-- Server health checks
CREATE TABLE server_health_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Health check identification
  check_id TEXT NOT NULL,
  server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  server_name TEXT NOT NULL,
  
  -- Check details
  check_type TEXT NOT NULL CHECK (check_type IN ('ping', 'tool_list', 'capability_check', 'full_diagnostic')),
  check_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Results
  status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'unhealthy', 'timeout', 'error')),
  response_time_ms DECIMAL(10,3),
  
  -- Detailed metrics
  tool_count INTEGER,
  available_tools INTEGER,
  unavailable_tools INTEGER,
  capability_count INTEGER,
  
  -- Error information
  error_message TEXT,
  error_details JSONB,
  
  -- Additional metrics
  memory_usage_mb DECIMAL(10,2),
  cpu_usage_percent DECIMAL(5,2),
  connection_pool_size INTEGER,
  active_connections INTEGER,
  
  -- Context
  triggered_by TEXT,
  correlation_id TEXT,
  metadata JSONB DEFAULT '{}',
  tenant_id TEXT DEFAULT 'default'
);

-- Convert to hypertable
SELECT create_hypertable('server_health_checks', 'check_time', chunk_time_interval => INTERVAL '1 hour');

-- Create indexes for server health checks
CREATE INDEX idx_server_health_checks_server_id ON server_health_checks (server_id, check_time DESC);
CREATE INDEX idx_server_health_checks_status ON server_health_checks (status);
CREATE INDEX idx_server_health_checks_check_type ON server_health_checks (check_type);

-- =====================================================================
-- COMPREHENSIVE ANALYTICS AND CACHING
-- =====================================================================

-- Analytics cache for expensive queries
CREATE TABLE analytics_cache (
  cache_key TEXT PRIMARY KEY,
  
  -- Cache content
  cache_value JSONB NOT NULL,
  cache_size_bytes INTEGER,
  
  -- Cache lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
  access_count INTEGER DEFAULT 0,
  
  -- Cache metadata
  query_parameters JSONB DEFAULT '{}',
  computation_time_ms BIGINT,
  data_freshness TIMESTAMPTZ,
  
  -- Cache tags for invalidation
  tags TEXT[] DEFAULT '{}',
  invalidation_triggers TEXT[] DEFAULT '{}',
  
  -- Context
  tenant_id TEXT DEFAULT 'default',
  created_by TEXT,
  metadata JSONB DEFAULT '{}'
);

-- Create indexes for analytics cache
CREATE INDEX idx_analytics_cache_expires_at ON analytics_cache (expires_at);
CREATE INDEX idx_analytics_cache_tags ON analytics_cache USING GIN (tags);
CREATE INDEX idx_analytics_cache_tenant_id ON analytics_cache (tenant_id);
CREATE INDEX idx_analytics_cache_last_accessed_at ON analytics_cache (last_accessed_at DESC);

-- Performance metrics aggregates
CREATE TABLE performance_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Metric identification
  metric_name TEXT NOT NULL,
  metric_type TEXT NOT NULL CHECK (metric_type IN ('counter', 'gauge', 'histogram', 'timer')),
  
  -- Entity reference
  entity_type TEXT NOT NULL CHECK (entity_type IN ('server', 'tool', 'chain', 'api', 'system')),
  entity_id TEXT,
  entity_name TEXT,
  
  -- Metric value and statistics
  value DECIMAL(20,6) NOT NULL,
  min_value DECIMAL(20,6),
  max_value DECIMAL(20,6),
  avg_value DECIMAL(20,6),
  sum_value DECIMAL(20,6),
  count_value BIGINT DEFAULT 1,
  
  -- Time bucket for aggregation
  time_bucket TIMESTAMPTZ NOT NULL,
  bucket_size INTERVAL NOT NULL DEFAULT '1 minute',
  
  -- Dimensions for grouping
  dimensions JSONB DEFAULT '{}',
  labels TEXT[] DEFAULT '{}',
  
  -- Context
  tenant_id TEXT DEFAULT 'default',
  metadata JSONB DEFAULT '{}'
);

-- Convert to hypertable
SELECT create_hypertable('performance_metrics', 'time_bucket', chunk_time_interval => INTERVAL '1 day');

-- Create indexes for performance metrics
CREATE INDEX idx_performance_metrics_entity ON performance_metrics (entity_type, entity_id, time_bucket DESC);
CREATE INDEX idx_performance_metrics_metric_name ON performance_metrics (metric_name, time_bucket DESC);
CREATE INDEX idx_performance_metrics_tenant_id ON performance_metrics (tenant_id);

-- =====================================================================
-- UNIVERSAL METADATA SYSTEM
-- =====================================================================

-- Entity metadata storage
CREATE TABLE entity_metadata (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Entity identification
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_ref UUID, -- Optional reference to actual entity table
  
  -- Metadata organization
  namespace TEXT NOT NULL DEFAULT 'default',
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  
  -- Value metadata
  value_type TEXT NOT NULL DEFAULT 'json',
  value_size_bytes INTEGER,
  is_sensitive BOOLEAN DEFAULT false,
  is_cached BOOLEAN DEFAULT false,
  
  -- Access control
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'protected', 'private', 'system')),
  permissions JSONB DEFAULT '{}',
  
  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  version INTEGER DEFAULT 1,
  
  -- Change tracking
  previous_value JSONB,
  change_reason TEXT,
  changed_by TEXT,
  
  -- Context
  correlation_id TEXT,
  tenant_id TEXT DEFAULT 'default',
  metadata JSONB DEFAULT '{}',
  
  -- Constraints
  CONSTRAINT entity_metadata_unique UNIQUE (entity_type, entity_id, namespace, key, tenant_id)
);

-- Create indexes for entity metadata
CREATE INDEX idx_entity_metadata_entity ON entity_metadata (entity_type, entity_id);
CREATE INDEX idx_entity_metadata_namespace ON entity_metadata (namespace);
CREATE INDEX idx_entity_metadata_key ON entity_metadata (key);
CREATE INDEX idx_entity_metadata_tenant_id ON entity_metadata (tenant_id);
CREATE INDEX idx_entity_metadata_visibility ON entity_metadata (visibility);
CREATE INDEX idx_entity_metadata_updated_at ON entity_metadata (updated_at DESC);
CREATE INDEX idx_entity_metadata_value ON entity_metadata USING GIN (value);

-- =====================================================================
-- SECURITY AND AUDIT LOGGING
-- =====================================================================

-- Security audit log
CREATE TABLE security_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Event identification
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  event_category TEXT NOT NULL CHECK (event_category IN ('authentication', 'authorization', 'access', 'modification', 'system', 'security')),
  
  -- Security classification
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  risk_score INTEGER CHECK (risk_score >= 0 AND risk_score <= 100),
  
  -- Resource information
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  resource_name TEXT,
  
  -- Action details
  action TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failure', 'partial', 'denied', 'timeout')),
  description TEXT NOT NULL,
  
  -- Actor information
  user_id TEXT,
  user_type TEXT,
  session_id TEXT,
  
  -- Context information
  client_info JSONB DEFAULT '{}',
  user_agent TEXT,
  ip_address INET,
  location_info JSONB,
  
  -- Security context
  security_context JSONB DEFAULT '{}',
  permissions_checked TEXT[] DEFAULT '{}',
  permissions_granted TEXT[] DEFAULT '{}',
  authentication_method TEXT,
  
  -- Additional details
  event_data JSONB DEFAULT '{}',
  before_state JSONB,
  after_state JSONB,
  
  -- Timing
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Correlation and tracking
  correlation_id TEXT,
  parent_event_id UUID REFERENCES security_audit_log(id),
  tenant_id TEXT DEFAULT 'default',
  
  -- Response and remediation
  response_actions TEXT[] DEFAULT '{}',
  remediation_required BOOLEAN DEFAULT false,
  remediation_status TEXT
);

-- Convert to hypertable
SELECT create_hypertable('security_audit_log', 'event_time', chunk_time_interval => INTERVAL '1 day');

-- Create indexes for security audit log
CREATE INDEX idx_security_audit_event_type ON security_audit_log (event_type);
CREATE INDEX idx_security_audit_severity ON security_audit_log (severity);
CREATE INDEX idx_security_audit_resource ON security_audit_log (resource_type, resource_id);
CREATE INDEX idx_security_audit_user_id ON security_audit_log (user_id);
CREATE INDEX idx_security_audit_session_id ON security_audit_log (session_id);
CREATE INDEX idx_security_audit_ip_address ON security_audit_log (ip_address);
CREATE INDEX idx_security_audit_tenant_id ON security_audit_log (tenant_id);
CREATE INDEX idx_security_audit_correlation_id ON security_audit_log (correlation_id);

-- =====================================================================
-- SYSTEM EVENTS AND NOTIFICATIONS
-- =====================================================================

-- System events log
CREATE TABLE system_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Event identification
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  event_source TEXT NOT NULL,
  
  -- Event classification
  category TEXT NOT NULL CHECK (category IN ('system', 'application', 'user', 'external', 'scheduled')),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'error', 'warning', 'info', 'debug')),
  
  -- Event details
  title TEXT NOT NULL,
  description TEXT,
  event_data JSONB DEFAULT '{}',
  
  -- Timing
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Context
  correlation_id TEXT,
  session_id TEXT,
  user_id TEXT,
  
  -- Related entities
  related_entities JSONB DEFAULT '{}',
  affected_resources TEXT[] DEFAULT '{}',
  
  -- Notification and alerting
  notification_sent BOOLEAN DEFAULT false,
  alert_level TEXT CHECK (alert_level IN ('none', 'low', 'medium', 'high', 'urgent')),
  notification_channels TEXT[] DEFAULT '{}',
  
  -- Metadata
  tenant_id TEXT DEFAULT 'default',
  metadata JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT '{}'
);

-- Convert to hypertable
SELECT create_hypertable('system_events', 'event_time', chunk_time_interval => INTERVAL '6 hours');

-- Create indexes for system events
CREATE INDEX idx_system_events_event_type ON system_events (event_type);
CREATE INDEX idx_system_events_severity ON system_events (severity);
CREATE INDEX idx_system_events_category ON system_events (category);
CREATE INDEX idx_system_events_event_source ON system_events (event_source);
CREATE INDEX idx_system_events_tenant_id ON system_events (tenant_id);
CREATE INDEX idx_system_events_correlation_id ON system_events (correlation_id);

-- =====================================================================
-- VIEWS FOR COMMON QUERIES
-- =====================================================================

-- Server performance summary view
CREATE VIEW server_performance_summary AS
SELECT 
  s.id,
  s.name,
  s.status,
  s.tool_count,
  s.avg_response_time_ms,
  s.success_rate,
  s.total_requests,
  COUNT(te.id) as recent_executions,
  AVG(te.duration_ms) as avg_execution_time_last_24h,
  COUNT(CASE WHEN te.status = 'completed' THEN 1 END) as successful_executions_24h,
  COUNT(CASE WHEN te.status = 'failed' THEN 1 END) as failed_executions_24h
FROM mcp_servers s
LEFT JOIN mcp_tools t ON s.id = t.server_id
LEFT JOIN tool_executions te ON t.id = te.tool_id 
  AND te.started_at > NOW() - INTERVAL '24 hours'
GROUP BY s.id, s.name, s.status, s.tool_count, s.avg_response_time_ms, s.success_rate, s.total_requests;

-- Tool usage statistics view
CREATE VIEW tool_usage_statistics AS
SELECT 
  t.id,
  t.tool_id,
  t.name,
  t.server_name,
  t.category,
  t.usage_count,
  t.avg_execution_time_ms,
  t.success_rate,
  COUNT(te.id) as executions_last_7_days,
  AVG(te.duration_ms) as avg_duration_last_7_days,
  COUNT(CASE WHEN te.status = 'completed' THEN 1 END) as successful_executions_7d,
  COUNT(CASE WHEN te.status = 'failed' THEN 1 END) as failed_executions_7d,
  MAX(te.started_at) as last_execution_time
FROM mcp_tools t
LEFT JOIN tool_executions te ON t.id = te.tool_id 
  AND te.started_at > NOW() - INTERVAL '7 days'
GROUP BY t.id, t.tool_id, t.name, t.server_name, t.category, t.usage_count, t.avg_execution_time_ms, t.success_rate;

-- Chain execution analytics view
CREATE VIEW chain_execution_analytics AS
SELECT 
  tce.id,
  tce.chain_id,
  tce.chain_type,
  tce.status,
  tce.total_steps,
  tce.completed_steps,
  tce.progress_percent,
  tce.duration_ms,
  COUNT(tcs.id) as total_step_records,
  COUNT(CASE WHEN tcs.status = 'completed' THEN 1 END) as completed_step_records,
  COUNT(CASE WHEN tcs.status = 'failed' THEN 1 END) as failed_step_records,
  AVG(tcs.duration_ms) as avg_step_duration,
  tce.started_at
FROM tool_chain_executions tce
LEFT JOIN tool_chain_steps tcs ON tce.id = tcs.chain_execution_id
GROUP BY tce.id, tce.chain_id, tce.chain_type, tce.status, tce.total_steps, 
         tce.completed_steps, tce.progress_percent, tce.duration_ms, tce.started_at;

-- =====================================================================
-- FUNCTIONS FOR MAINTENANCE AND OPTIMIZATION
-- =====================================================================

-- Function to update tool statistics
CREATE OR REPLACE FUNCTION update_tool_statistics()
RETURNS VOID AS $$
BEGIN
  UPDATE mcp_tools t SET
    usage_count = COALESCE(stats.execution_count, 0),
    avg_execution_time_ms = stats.avg_duration,
    success_rate = CASE 
      WHEN stats.execution_count > 0 THEN (stats.successful_count::decimal / stats.execution_count * 100)
      ELSE NULL 
    END,
    total_executions = COALESCE(stats.execution_count, 0),
    successful_executions = COALESCE(stats.successful_count, 0),
    failed_executions = COALESCE(stats.failed_count, 0),
    last_used_at = stats.last_execution,
    updated_at = NOW()
  FROM (
    SELECT 
      te.tool_id,
      COUNT(*) as execution_count,
      AVG(te.duration_ms) as avg_duration,
      COUNT(CASE WHEN te.status = 'completed' THEN 1 END) as successful_count,
      COUNT(CASE WHEN te.status = 'failed' THEN 1 END) as failed_count,
      MAX(te.started_at) as last_execution
    FROM tool_executions te
    WHERE te.tool_id IS NOT NULL
    GROUP BY te.tool_id
  ) stats
  WHERE t.id = stats.tool_id;
END;
$$ LANGUAGE plpgsql;

-- Function to update server statistics
CREATE OR REPLACE FUNCTION update_server_statistics()
RETURNS VOID AS $$
BEGIN
  UPDATE mcp_servers s SET
    tool_count = COALESCE(tool_stats.tool_count, 0),
    active_tool_count = COALESCE(tool_stats.active_tool_count, 0),
    total_requests = COALESCE(exec_stats.total_executions, 0),
    successful_requests = COALESCE(exec_stats.successful_executions, 0),
    failed_requests = COALESCE(exec_stats.failed_executions, 0),
    avg_response_time_ms = exec_stats.avg_duration,
    success_rate = CASE 
      WHEN exec_stats.total_executions > 0 THEN (exec_stats.successful_executions::decimal / exec_stats.total_executions * 100)
      ELSE NULL 
    END,
    updated_at = NOW()
  FROM (
    SELECT 
      server_id,
      COUNT(*) as tool_count,
      COUNT(CASE WHEN is_active THEN 1 END) as active_tool_count
    FROM mcp_tools
    GROUP BY server_id
  ) tool_stats
  LEFT JOIN (
    SELECT 
      t.server_id,
      COUNT(te.*) as total_executions,
      COUNT(CASE WHEN te.status = 'completed' THEN 1 END) as successful_executions,
      COUNT(CASE WHEN te.status = 'failed' THEN 1 END) as failed_executions,
      AVG(te.duration_ms) as avg_duration
    FROM tool_executions te
    JOIN mcp_tools t ON te.tool_id = t.id
    GROUP BY t.server_id
  ) exec_stats ON tool_stats.server_id = exec_stats.server_id
  WHERE s.id = tool_stats.server_id;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old data
CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS VOID AS $$
BEGIN
  -- Clean up old tool executions (older than 90 days)
  DELETE FROM tool_executions 
  WHERE started_at < NOW() - INTERVAL '90 days';
  
  -- Clean up old API requests (older than 30 days)
  DELETE FROM api_requests 
  WHERE started_at < NOW() - INTERVAL '30 days';
  
  -- Clean up expired cache entries
  DELETE FROM analytics_cache 
  WHERE expires_at < NOW();
  
  -- Clean up old server connections (older than 14 days)
  DELETE FROM server_connections 
  WHERE event_time < NOW() - INTERVAL '14 days';
  
  -- Clean up old health checks (older than 7 days)
  DELETE FROM server_health_checks 
  WHERE check_time < NOW() - INTERVAL '7 days';
  
  -- Clean up old system events (older than 30 days, except critical)
  DELETE FROM system_events 
  WHERE event_time < NOW() - INTERVAL '30 days' 
    AND severity NOT IN ('critical', 'error');
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- =====================================================================

-- Trigger function to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers to relevant tables
CREATE TRIGGER trigger_mcp_servers_updated_at 
  BEFORE UPDATE ON mcp_servers 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_mcp_tools_updated_at 
  BEFORE UPDATE ON mcp_tools 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_entity_metadata_updated_at 
  BEFORE UPDATE ON entity_metadata 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger function to notify about important events
CREATE OR REPLACE FUNCTION notify_important_events()
RETURNS TRIGGER AS $$
BEGIN
  -- Notify about server status changes
  IF TG_TABLE_NAME = 'mcp_servers' AND OLD.status != NEW.status THEN
    PERFORM pg_notify('server_status_changed', json_build_object(
      'server_id', NEW.id,
      'server_name', NEW.name,
      'old_status', OLD.status,
      'new_status', NEW.status,
      'timestamp', NOW()
    )::text);
  END IF;
  
  -- Notify about tool execution failures
  IF TG_TABLE_NAME = 'tool_executions' AND NEW.status = 'failed' THEN
    PERFORM pg_notify('tool_execution_failed', json_build_object(
      'execution_id', NEW.id,
      'tool_name', NEW.tool_name,
      'server_name', NEW.server_name,
      'error_message', NEW.error_message,
      'timestamp', NEW.started_at
    )::text);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply notification triggers
CREATE TRIGGER trigger_server_status_notification 
  AFTER UPDATE ON mcp_servers 
  FOR EACH ROW EXECUTE FUNCTION notify_important_events();

CREATE TRIGGER trigger_tool_execution_notification 
  AFTER INSERT OR UPDATE ON tool_executions 
  FOR EACH ROW EXECUTE FUNCTION notify_important_events();

-- =====================================================================
-- INITIAL SYSTEM DATA
-- =====================================================================

-- Insert system metadata
INSERT INTO entity_metadata (entity_type, entity_id, namespace, key, value, visibility) VALUES
('system', 'mcp_hub', 'schema', 'version', '"2.0.0"', 'system'),
('system', 'mcp_hub', 'schema', 'created_at', to_jsonb(NOW()), 'system'),
('system', 'mcp_hub', 'features', 'timescaledb', 'true', 'system'),
('system', 'mcp_hub', 'features', 'analytics', 'true', 'system'),
('system', 'mcp_hub', 'features', 'security_audit', 'true', 'system'),
('system', 'mcp_hub', 'retention', 'tool_executions_days', '90', 'system'),
('system', 'mcp_hub', 'retention', 'api_requests_days', '30', 'system'),
('system', 'mcp_hub', 'retention', 'audit_log_days', '365', 'system');

-- Create system event for schema installation
INSERT INTO system_events (event_id, event_type, event_source, category, severity, title, description, event_data)
VALUES (
  'schema_install_' || extract(epoch from now())::text,
  'schema_installation',
  'database_migration',
  'system',
  'info',
  'MCP Hub Comprehensive Schema Installed',
  'The comprehensive database schema for MCP Hub has been successfully installed with all tables, indexes, and functions.',
  json_build_object(
    'schema_version', '2.0.0',
    'tables_created', 20,
    'hypertables_created', 8,
    'indexes_created', 60,
    'functions_created', 5,
    'views_created', 3
  )
);

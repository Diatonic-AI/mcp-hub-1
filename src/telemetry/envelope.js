/**
 * Universal Data Envelope for MCP Hub Telemetry
 * Implements normalization, redaction, and versioning for telemetry events
 * Complies with WARP.md security guidelines: zero secret leakage
 */

import crypto from 'crypto';
import { v7 as uuidv7 } from 'uuid';
import logger from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';

// Current envelope version
const ENVELOPE_VERSION = 1;

// Sensitive keys to redact (case-insensitive)
const SENSITIVE_KEYS = new Set([
  'token', 'api_key', 'apikey', 'api-key',
  'authorization', 'auth', 'bearer',
  'cookie', 'cookies', 'session',
  'secret', 'secrets', 'credential',
  'password', 'passwd', 'pwd',
  'private_key', 'privatekey', 'private-key',
  'access_token', 'accesstoken', 'access-token',
  'refresh_token', 'refreshtoken', 'refresh-token',
  'client_secret', 'clientsecret', 'client-secret',
  'x-api-key', 'x_api_key', 'x-auth-token',
  'jwt', 'oauth', 'key', 'cert', 'certificate'
]);

// Headers to redact (case-insensitive)
const SENSITIVE_HEADERS = new Set([
  'authorization', 'cookie', 'x-api-key',
  'x-auth-token', 'x-access-token', 'proxy-authorization'
]);

// Maximum text size before truncation (characters)
const MAX_TEXT_SIZE = 10000;
const TRUNCATE_PREVIEW_SIZE = 500;

/**
 * Universal Data Envelope class
 * Creates standardized, redacted telemetry envelopes
 */
export class TelemetryEnvelope {
  constructor() {
    this.version = ENVELOPE_VERSION;
    this.redactionMap = new Map(
      Array.from(SENSITIVE_KEYS).map(k => [k.toLowerCase(), true])
    );
  }

  /**
   * Create a new telemetry envelope
   * @param {Object} data - Raw telemetry data
   * @returns {Object} Normalized and redacted envelope
   */
  create(data) {
    const now = new Date();
    
    // Generate IDs
    const id = data.id || uuidv7();
    const gid = this.generateGID(data);
    
    // Build envelope
    const envelope = {
      // Identity
      id,
      gid,
      tenant: data.tenant || process.env.DEFAULT_TENANT || 'default',
      type: data.type || 'mcp.call',
      
      // Temporal
      time: now.toISOString(),
      created: data.created || now.toISOString(),
      timestamp_ms: now.getTime(),
      
      // Session context
      session_id: data.session_id || data.sessionId || null,
      user_agent: data.user_agent || data.userAgent || null,
      correlation_id: data.correlation_id || data.correlationId || null,
      
      // MCP context
      server: data.server || null,
      tool: data.tool || null,
      tool_id: this.formatToolId(data.server, data.tool),
      
      // Execution metadata (redacted)
      args_meta: this.extractMetadata(data.args || data.arguments),
      output_meta: this.extractMetadata(data.output || data.result),
      error_meta: this.extractErrorMetadata(data.error),
      
      // Performance metrics
      latency_ms: data.latency_ms || data.latency || null,
      status: data.status || (data.error ? 'error' : 'success'),
      
      // Chain context
      chain_id: data.chain_id || data.chainId || null,
      parent_id: data.parent_id || data.parentId || null,
      chain_length: data.chain_length || data.chainLength || null,
      
      // Classification
      classification: data.classification || 'internal',
      tags: data.tags || [],
      
      // Flexible attributes (redacted)
      attrs: this.redactObject(data.attrs || data.attributes || {}),
      
      // Versioning
      version: this.version,
      
      // Source tracking
      source: data.source || 'telemetry',
      source_version: data.source_version || null
    };
    
    return envelope;
  }

  /**
   * Generate Global ID (GID) for the envelope
   * Format: TYPE:YYYY-MM-DD:TENANT:SUFFIX
   */
  generateGID(data) {
    const date = new Date().toISOString().split('T')[0];
    const type = (data.type || 'mcp.call').replace(/\./g, '_');
    const tenant = (data.tenant || 'default').substring(0, 20);
    const suffix = crypto.randomBytes(4).toString('hex');
    
    return `${type}:${date}:${tenant}:${suffix}`;
  }

  /**
   * Format tool ID with namespace delimiter
   * Follows WARP.md convention: <serverName>__<capabilityName>
   */
  formatToolId(server, tool) {
    if (!server || !tool) return null;
    return `${server}__${tool}`;
  }

  /**
   * Extract metadata from arguments/outputs (size, type, redacted preview)
   */
  extractMetadata(data) {
    if (data === undefined || data === null) {
      return { exists: false };
    }
    
    const metadata = {
      exists: true,
      type: typeof data,
      size: 0,
      truncated: false,
      hash: null,
      preview: null
    };
    
    // Calculate size
    if (typeof data === 'string') {
      metadata.size = data.length;
      
      // Truncate if too large
      if (data.length > MAX_TEXT_SIZE) {
        metadata.truncated = true;
        metadata.preview = this.redactString(data.substring(0, TRUNCATE_PREVIEW_SIZE)) + '...';
        metadata.hash = this.hashString(data);
      } else {
        metadata.preview = this.redactString(data.substring(0, TRUNCATE_PREVIEW_SIZE));
      }
    } else if (typeof data === 'object') {
      const json = JSON.stringify(data);
      metadata.size = json.length;
      metadata.type = Array.isArray(data) ? 'array' : 'object';
      
      // Store redacted object preview
      const redacted = this.redactObject(data);
      metadata.preview = JSON.stringify(redacted).substring(0, TRUNCATE_PREVIEW_SIZE);
      
      if (json.length > MAX_TEXT_SIZE) {
        metadata.truncated = true;
        metadata.hash = this.hashString(json);
      }
    } else {
      metadata.size = JSON.stringify(data).length;
      metadata.preview = String(data).substring(0, 100);
    }
    
    return metadata;
  }

  /**
   * Extract error metadata with redaction
   */
  extractErrorMetadata(error) {
    if (!error) return null;
    
    const metadata = {
      exists: true,
      code: error.code || null,
      class: error.name || error.constructor?.name || 'Error',
      message: this.redactString(error.message || ''),
      stack_preview: null
    };
    
    // Include redacted stack trace preview
    if (error.stack) {
      const lines = error.stack.split('\n').slice(0, 3);
      metadata.stack_preview = lines.map(l => this.redactString(l)).join('\n');
    }
    
    return metadata;
  }

  /**
   * Redact sensitive information from an object
   */
  redactObject(obj, depth = 0) {
    if (depth > 10) return '[MAX_DEPTH]'; // Prevent infinite recursion
    if (!obj || typeof obj !== 'object') return obj;
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.redactObject(item, depth + 1));
    }
    
    const redacted = {};
    
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      
      // Check if key is sensitive
      if (this.isSensitiveKey(lowerKey)) {
        redacted[key] = '[REDACTED]';
        continue;
      }
      
      // Check for Authorization header specifically
      if (lowerKey === 'headers' && typeof value === 'object') {
        redacted[key] = this.redactHeaders(value);
        continue;
      }
      
      // Recursively redact nested objects
      if (typeof value === 'object' && value !== null) {
        redacted[key] = this.redactObject(value, depth + 1);
      } else if (typeof value === 'string') {
        // Check if value looks like a secret
        redacted[key] = this.redactString(value);
      } else {
        redacted[key] = value;
      }
    }
    
    return redacted;
  }

  /**
   * Redact sensitive headers
   */
  redactHeaders(headers) {
    if (!headers || typeof headers !== 'object') return headers;
    
    const redacted = {};
    
    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      
      if (SENSITIVE_HEADERS.has(lowerKey)) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = value;
      }
    }
    
    return redacted;
  }

  /**
   * Redact sensitive patterns from strings
   */
  redactString(str) {
    if (typeof str !== 'string') return str;
    
    // Redact JWT tokens
    str = str.replace(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT_REDACTED]');
    
    // Redact API keys (common patterns)
    str = str.replace(/([A-Za-z0-9]{32,})/g, (match) => {
      // Only redact if it looks like a key (mixed case or has special chars)
      if (/^[a-z0-9]+$/.test(match) || /^[A-Z0-9]+$/.test(match)) {
        return match; // Probably not a key
      }
      return '[KEY_REDACTED]';
    });
    
    // Redact Bearer tokens
    str = str.replace(/Bearer\s+[A-Za-z0-9_-]+/gi, 'Bearer [REDACTED]');
    
    // Redact Basic auth
    str = str.replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [REDACTED]');
    
    // Redact URLs with credentials
    str = str.replace(
      /(https?:\/\/)([^:]+):([^@]+)@/gi,
      '$1[REDACTED]:[REDACTED]@'
    );
    
    return str;
  }

  /**
   * Check if a key name is sensitive
   */
  isSensitiveKey(key) {
    const lowerKey = key.toLowerCase();
    
    // Direct match
    if (this.redactionMap.has(lowerKey)) {
      return true;
    }
    
    // Partial match for compound keys
    for (const sensitive of SENSITIVE_KEYS) {
      if (lowerKey.includes(sensitive)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Hash a string for comparison/deduplication
   */
  hashString(str) {
    return crypto
      .createHash('sha256')
      .update(str)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Validate an envelope structure
   */
  validate(envelope) {
    const required = ['id', 'gid', 'tenant', 'type', 'time', 'version'];
    const missing = required.filter(field => !envelope[field]);
    
    if (missing.length > 0) {
      throw new ValidationError(
        `Invalid telemetry envelope: missing required fields: ${missing.join(', ')}`
      );
    }
    
    // Validate version compatibility
    if (envelope.version > this.version) {
      logger.warn('TELEMETRY_ENVELOPE_VERSION', 
        `Envelope version ${envelope.version} is newer than current version ${this.version}`,
        { envelope_id: envelope.id }
      );
    }
    
    return true;
  }

  /**
   * Serialize envelope for storage/transmission
   */
  serialize(envelope) {
    return JSON.stringify(envelope);
  }

  /**
   * Deserialize envelope from storage/transmission
   */
  deserialize(data) {
    if (typeof data === 'string') {
      return JSON.parse(data);
    }
    return data;
  }

  /**
   * Create a sparse envelope for real-time transmission (minimal fields)
   */
  createSparse(data) {
    return {
      id: data.id || uuidv7(),
      tenant: data.tenant || 'default',
      server: data.server,
      tool: data.tool,
      tool_id: this.formatToolId(data.server, data.tool),
      session_id: data.session_id,
      timestamp_ms: Date.now(),
      event: data.event || 'start' // 'start' or 'complete'
    };
  }
}

// Export singleton instance
export const telemetryEnvelope = new TelemetryEnvelope();

// Export for testing
export default TelemetryEnvelope;

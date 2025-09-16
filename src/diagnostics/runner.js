/**
 * MCP Hub ML/DL Pipeline Diagnostics Runner
 * 
 * Comprehensive diagnostic tool for verifying the entire MCP Hub ML/DL pipeline
 * including database connectivity, telemetry streaming, tool registration,
 * training orchestration, and feedback loops.
 * 
 * Safety: Read-only by default, write operations require explicit flags
 * Security: All secrets are redacted in outputs
 * 
 * @module diagnostics/runner
 */

import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import logger from '../utils/logger.js';
import { wrapError, McpError, ErrorCode } from '../utils/errors.js';

// Diagnostic status constants
export const DiagnosticStatus = {
  PASS: 'pass',
  FAIL: 'fail',
  WARN: 'warn',
  SKIP: 'skip'
};

// Diagnostic categories
export const DiagnosticCategory = {
  CONNECTIVITY: 'connectivity',
  DATABASE: 'database',
  SERVER: 'server',
  TELEMETRY: 'telemetry',
  ML_PIPELINE: 'ml_pipeline',
  FEATURE_ENGINEERING: 'feature_engineering',
  FEEDBACK: 'feedback',
  CONFIGURATION: 'configuration'
};

/**
 * Diagnostic result type
 */
export class DiagnosticResult {
  constructor({
    id,
    name,
    category,
    status = DiagnosticStatus.SKIP,
    durationMs = 0,
    details = {},
    error = null,
    remediation = [],
    artifacts = []
  }) {
    this.id = id;
    this.name = name;
    this.category = category;
    this.status = status;
    this.durationMs = durationMs;
    this.details = details;
    this.error = error;
    this.remediation = remediation;
    this.artifacts = artifacts;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Diagnostic context provided to checks
 */
export class DiagnosticContext {
  constructor({
    config = {},
    clients = {},
    allowWrites = false,
    timeout = 30000,
    verbose = false
  }) {
    this.config = config;
    this.clients = clients;
    this.allowWrites = allowWrites;
    this.timeout = timeout;
    this.verbose = verbose;
    this.artifacts = [];
    this.abortController = new AbortController();
    
    // Setup timeout
    this.timeoutId = setTimeout(() => {
      this.abortController.abort();
    }, timeout);
  }

  cleanup() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  log(level, message, data = {}) {
    if (this.verbose || level !== 'debug') {
      logger[level](message, data);
    }
  }

  info(message, data) {
    this.log('info', message, data);
  }

  warn(message, data) {
    this.log('warn', message, data);
  }

  error(message, data) {
    this.log('error', message, data);
  }

  debug(message, data) {
    this.log('debug', message, data);
  }

  addArtifact(path) {
    this.artifacts.push(path);
  }
}

/**
 * Main Diagnostics Runner
 */
export class DiagnosticsRunner extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      allowWrites: options.allowWrites || false,
      timeout: options.timeout || 30000,
      verbose: options.verbose || false,
      parallel: options.parallel || false,
      ...options
    };
    
    this.checks = new Map();
    this.results = [];
    this.startTime = null;
    this.endTime = null;
  }

  /**
   * Register a diagnostic check
   */
  register(id, check) {
    if (typeof check !== 'function') {
      throw new McpError(ErrorCode.InvalidParams, 'Check must be a function');
    }
    
    this.checks.set(id, check);
    return this;
  }

  /**
   * Run a single check
   */
  async runCheck(id, check, context) {
    const startTime = performance.now();
    let result;
    
    try {
      context.info(`Running check: ${id}`);
      result = await check(context);
      
      if (!(result instanceof DiagnosticResult)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Check must return a DiagnosticResult'
        );
      }
      
      result.durationMs = performance.now() - startTime;
      
      // Emit check completion
      this.emit('checkCompleted', result);
      
      // Log result
      const emoji = {
        [DiagnosticStatus.PASS]: '✅',
        [DiagnosticStatus.FAIL]: '❌',
        [DiagnosticStatus.WARN]: '⚠️',
        [DiagnosticStatus.SKIP]: '⏭️'
      }[result.status] || '❓';
      
      context.info(`${emoji} ${result.name}: ${result.status.toUpperCase()}`, {
        duration: `${result.durationMs.toFixed(2)}ms`
      });
      
    } catch (error) {
      result = new DiagnosticResult({
        id,
        name: id,
        category: DiagnosticCategory.CONFIGURATION,
        status: DiagnosticStatus.FAIL,
        durationMs: performance.now() - startTime,
        error: {
          code: error.code || 'UNKNOWN',
          message: error.message
        },
        remediation: ['Check runner logs for details']
      });
      
      context.error(`Check failed with error: ${error.message}`, {
        id,
        error: error.stack
      });
    }
    
    return result;
  }

  /**
   * Run all registered checks
   */
  async runAll(contextOptions = {}) {
    this.startTime = performance.now();
    this.results = [];
    
    // Create context
    const context = new DiagnosticContext({
      ...contextOptions,
      allowWrites: this.options.allowWrites,
      timeout: this.options.timeout,
      verbose: this.options.verbose
    });
    
    try {
      // Emit start event
      this.emit('started', {
        checkCount: this.checks.size,
        options: this.options
      });
      
      // Run checks
      if (this.options.parallel) {
        // Run checks in parallel
        const promises = [];
        for (const [id, check] of this.checks) {
          promises.push(this.runCheck(id, check, context));
        }
        this.results = await Promise.all(promises);
      } else {
        // Run checks sequentially
        for (const [id, check] of this.checks) {
          const result = await this.runCheck(id, check, context);
          this.results.push(result);
        }
      }
      
      this.endTime = performance.now();
      
      // Generate summary
      const summary = this.generateSummary();
      
      // Emit completion event
      this.emit('completed', {
        results: this.results,
        summary
      });
      
      return {
        results: this.results,
        summary,
        artifacts: context.artifacts
      };
      
    } finally {
      context.cleanup();
    }
  }

  /**
   * Generate summary statistics
   */
  generateSummary() {
    const summary = {
      total: this.results.length,
      passed: 0,
      failed: 0,
      warned: 0,
      skipped: 0,
      durationMs: this.endTime - this.startTime
    };
    
    for (const result of this.results) {
      switch (result.status) {
        case DiagnosticStatus.PASS:
          summary.passed++;
          break;
        case DiagnosticStatus.FAIL:
          summary.failed++;
          break;
        case DiagnosticStatus.WARN:
          summary.warned++;
          break;
        case DiagnosticStatus.SKIP:
          summary.skipped++;
          break;
      }
    }
    
    summary.successRate = summary.total > 0 
      ? ((summary.passed / summary.total) * 100).toFixed(1)
      : 0;
    
    return summary;
  }

  /**
   * Get exit code based on results
   */
  getExitCode() {
    const summary = this.generateSummary();
    
    if (summary.failed > 0) {
      return 1; // Failures detected
    }
    
    return 0; // Success or only warnings/skips
  }

  /**
   * Filter checks by pattern
   */
  filterChecks(only, skip) {
    if (only) {
      const regex = new RegExp(only);
      for (const id of this.checks.keys()) {
        if (!regex.test(id)) {
          this.checks.delete(id);
        }
      }
    }
    
    if (skip) {
      const regex = new RegExp(skip);
      for (const id of this.checks.keys()) {
        if (regex.test(id)) {
          this.checks.delete(id);
        }
      }
    }
  }
}

/**
 * Security: Redact sensitive values
 */
export function redactSecrets(obj, depth = 0) {
  if (depth > 10) return obj; // Prevent infinite recursion
  
  const sensitiveKeys = [
    'password', 'token', 'api_key', 'apikey', 'secret',
    'authorization', 'cookie', 'sas', 'jwt', 'key',
    'credential', 'auth', 'pwd', 'passwd', 'access_token',
    'refresh_token', 'private_key', 'client_secret'
  ];
  
  if (typeof obj === 'string') {
    // Redact connection strings
    if (obj.includes('://') && obj.includes('@')) {
      return obj.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@');
    }
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => redactSecrets(item, depth + 1));
  }
  
  if (obj && typeof obj === 'object') {
    const redacted = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      
      if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
        redacted[key] = '***REDACTED***';
      } else if (typeof value === 'object') {
        redacted[key] = redactSecrets(value, depth + 1);
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }
  
  return obj;
}

/**
 * Common remediation suggestions
 */
export const REMEDIATION_CATALOG = {
  ECONNREFUSED: [
    'Check if the service is running',
    'Verify host and port are correct',
    'Check firewall rules and network connectivity',
    'Ensure VPN is connected if required',
    'Check container network configuration if using Docker/LXD'
  ],
  ETIMEDOUT: [
    'Check network connectivity to the host',
    'Verify DNS resolution is working',
    'Check for proxy configuration issues',
    'Increase connection timeout if network is slow',
    'Check if service is overloaded'
  ],
  AUTH_FAILED: [
    'Verify credentials are correct',
    'Check user permissions and roles',
    'Review pg_hba.conf for PostgreSQL',
    'Check authentication method (SCRAM vs MD5)',
    'Ensure user exists in the database'
  ],
  SCHEMA_MISSING: [
    'Run database migrations',
    'Check migration files: migrations/005-010',
    'Verify database search_path',
    'Check if user has schema creation permissions',
    'Review migration logs for errors'
  ],
  QUEUE_STALLED: [
    'Check if worker processes are running',
    'Verify Redis connection for BullMQ',
    'Check BullMQ prefix configuration',
    'Review Redis ACL permissions',
    'Inspect dead letter queue for failed jobs'
  ],
  SSE_TIMEOUT: [
    'Check SSE endpoint path and port',
    'Disable proxy buffering for SSE',
    'Verify heartbeat interval configuration',
    'Check for network timeouts',
    'Review SSE manager logs'
  ],
  PROVIDER_MISSING: [
    'Set EMBEDDINGS_PROVIDER=mock for offline testing',
    'Install local model assets if using local provider',
    'Verify provider API credentials (do not log)',
    'Check provider service availability',
    'Review provider configuration in .env'
  ]
};

/**
 * Get remediation suggestions for an error code
 */
export function getRemediation(errorCode) {
  return REMEDIATION_CATALOG[errorCode] || [
    'Check application logs for details',
    'Verify configuration is correct',
    'Ensure all dependencies are installed',
    'Review documentation for this component'
  ];
}

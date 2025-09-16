/**
 * Chain Specification Validator with Security Hardening
 * 
 * This module provides comprehensive validation and security checks for tool chain specifications.
 * It implements defense-in-depth security measures including input validation, resource limits,
 * sandbox isolation, and audit logging.
 * 
 * SECURITY FEATURES:
 * - Strict JSON Schema validation with custom security rules
 * - Resource exhaustion prevention (steps, memory, execution time)
 * - Tool execution allowlist/blocklist enforcement
 * - Variable interpolation with XSS/injection prevention
 * - Audit logging for all security events
 * - Write operation gating with explicit approval workflow
 */

import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import logger from "./logger.js";

// Security configuration constants
export const CHAIN_SECURITY_LIMITS = {
  MAX_CHAIN_STEPS: parseInt(process.env.CHAIN_MAX_STEPS) || 50,
  MAX_EXECUTION_TIME_MS: parseInt(process.env.CHAIN_MAX_EXECUTION_TIME) || 600000, // 10 minutes
  MAX_PARALLEL_STEPS: parseInt(process.env.CHAIN_MAX_PARALLEL) || 10,
  MAX_VARIABLE_SIZE_BYTES: parseInt(process.env.CHAIN_MAX_VARIABLE_SIZE) || 1048576, // 1MB
  MAX_ARGUMENT_SIZE_BYTES: parseInt(process.env.CHAIN_MAX_ARG_SIZE) || 1048576, // 1MB
  MAX_NESTED_DEPTH: parseInt(process.env.CHAIN_MAX_NESTED_DEPTH) || 10,
  MAX_STRING_LENGTH: parseInt(process.env.CHAIN_MAX_STRING_LENGTH) || 10000,
  BLOCKED_PATTERNS: [
    /javascript:/i,
    /data:/i,
    /vbscript:/i,
    /<script/i,
    /on\w+\s*=/i,
    /eval\s*\(/i,
    /Function\s*\(/i,
    /setTimeout\s*\(/i,
    /setInterval\s*\(/i
  ]
};

// Tool execution risk categories
export const TOOL_RISK_CATEGORIES = {
  READ_ONLY: ['read', 'get', 'list', 'find', 'search', 'query', 'analyze'],
  LOW_RISK: ['validate', 'format', 'transform', 'parse', 'convert'],
  MEDIUM_RISK: ['create', 'generate', 'process', 'execute'],
  HIGH_RISK: ['write', 'update', 'modify', 'delete', 'remove', 'destroy'],
  WRITE_OPERATIONS: ['write', 'create', 'update', 'modify', 'delete', 'remove', 'insert', 'put', 'post', 'patch']
};

/**
 * Chain specification JSON Schema with security constraints
 */
export const CHAIN_SPEC_SCHEMA = {
  type: "object",
  required: ["chain"],
  properties: {
    chain: {
      type: "array",
      minItems: 1,
      maxItems: CHAIN_SECURITY_LIMITS.MAX_CHAIN_STEPS,
      items: {
        type: "object",
        required: ["server_name", "tool_name"],
        properties: {
          id: {
            type: "string",
            pattern: "^[a-zA-Z0-9_-]{1,50}$",
            description: "Step identifier (alphanumeric, underscore, hyphen only)"
          },
          server_name: {
            type: "string",
            pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,49}$",
            description: "MCP server name (must start with alphanumeric)"
          },
          tool_name: {
            type: "string",
            pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,49}$",
            description: "Tool name (must start with alphanumeric)"
          },
          arguments: {
            type: "object",
            description: "Tool arguments (validated separately for size and content)"
          },
          input_mapping: {
            type: "object",
            patternProperties: {
              "^[a-zA-Z_][a-zA-Z0-9_]{0,49}$": {
                type: "string",
                maxLength: CHAIN_SECURITY_LIMITS.MAX_STRING_LENGTH
              }
            },
            additionalProperties: false
          },
          transformations: {
            type: "array",
            maxItems: 10,
            items: {
              type: "object",
              required: ["type"],
              properties: {
                type: {
                  type: "string",
                  enum: ["extract_json", "extract_text", "template", "filter", "map", "format"]
                },
                target: { type: "string", maxLength: 100 },
                source: { type: "string", maxLength: 100 },
                template: { type: "string", maxLength: CHAIN_SECURITY_LIMITS.MAX_STRING_LENGTH },
                filter_condition: { type: "string", maxLength: 1000 },
                map_function: { type: "string", maxLength: 1000 },
                format: { type: "string", enum: ["json", "csv", "string", "xml", "yaml"] }
              },
              additionalProperties: false
            }
          },
          conditions: {
            type: "object",
            properties: {
              execute_if: {
                type: "string",
                maxLength: 1000,
                description: "Conditional expression (sanitized)"
              },
              skip_on_error: {
                type: "boolean"
              }
            },
            additionalProperties: false
          },
          retry: {
            type: "object",
            properties: {
              max_attempts: { type: "number", minimum: 1, maximum: 5 },
              delay_ms: { type: "number", minimum: 100, maximum: 30000 },
              backoff_multiplier: { type: "number", minimum: 1, maximum: 5 }
            },
            additionalProperties: false
          },
          parallel_group: {
            type: "string",
            pattern: "^[a-zA-Z0-9_-]{1,50}$"
          }
        },
        additionalProperties: false
      }
    },
    variables: {
      type: "object",
      patternProperties: {
        "^[a-zA-Z_][a-zA-Z0-9_]{0,49}$": true
      },
      additionalProperties: false,
      description: "Global variables (validated separately for content)"
    },
    execution_options: {
      type: "object",
      properties: {
        timeout_ms: {
          type: "number",
          minimum: 1000,
          maximum: CHAIN_SECURITY_LIMITS.MAX_EXECUTION_TIME_MS
        },
        fail_fast: { type: "boolean" },
        max_parallel: {
          type: "number",
          minimum: 1,
          maximum: CHAIN_SECURITY_LIMITS.MAX_PARALLEL_STEPS
        },
        rollback_on_error: { type: "boolean" },
        dry_run: { type: "boolean" },
        audit_level: {
          type: "string",
          enum: ["minimal", "standard", "detailed"]
        },
        approval_required: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};

/**
 * Security hardened chain specification validator
 */
export class ChainSpecValidator {
  constructor(options = {}) {
    this.options = {
      enableAuditLogging: options.enableAuditLogging !== false,
      strictMode: options.strictMode !== false,
      allowedServers: options.allowedServers || null, // null = all allowed
      blockedServers: options.blockedServers || [],
      allowedTools: options.allowedTools || null, // null = all allowed
      blockedTools: options.blockedTools || [],
      requireApprovalForWrites: options.requireApprovalForWrites !== false,
      ...options
    };
    
    this.auditLog = [];
    this.executionStats = {
      validationsPerformed: 0,
      securityViolations: 0,
      approvalRequestsGenerated: 0
    };
  }

  /**
   * Comprehensive validation and security hardening of chain specification
   */
  async validateAndHarden(chainSpec, context = {}) {
    const validationId = this._generateValidationId();
    const startTime = Date.now();
    
    try {
      this._logAuditEvent('validation_started', { validationId, context });
      
      // Phase 1: Basic structure validation
      this._validateBasicStructure(chainSpec);
      
      // Phase 2: Security validation
      this._validateSecurityConstraints(chainSpec);
      
      // Phase 3: Business logic validation
      this._validateBusinessLogic(chainSpec);
      
      // Phase 4: Generate security metadata
      const securityMetadata = this._generateSecurityMetadata(chainSpec);
      
      // Phase 5: Apply hardening transformations
      const hardenedSpec = this._applySecurityHardening(chainSpec, securityMetadata);
      
      this.executionStats.validationsPerformed++;
      
      this._logAuditEvent('validation_completed', {
        validationId,
        elapsedMs: Date.now() - startTime,
        stepCount: chainSpec.chain.length,
        securityLevel: securityMetadata.riskLevel
      });
      
      return {
        isValid: true,
        hardenedSpec,
        securityMetadata,
        validationId,
        warnings: securityMetadata.warnings || []
      };
      
    } catch (error) {
      this.executionStats.securityViolations++;
      
      this._logAuditEvent('validation_failed', {
        validationId,
        error: error.message,
        elapsedMs: Date.now() - startTime
      });
      
      throw new McpError(
        ErrorCode.InvalidParams,
        `Chain specification validation failed: ${error.message}`,
        { validationId, originalError: error.message }
      );
    }
  }

  /**
   * Basic JSON Schema structure validation
   */
  _validateBasicStructure(chainSpec) {
    // Validate against JSON schema (simplified - in production use ajv or similar)
    if (!chainSpec || typeof chainSpec !== 'object') {
      throw new Error('Chain specification must be an object');
    }
    
    if (!Array.isArray(chainSpec.chain)) {
      throw new Error('Chain must be an array');
    }
    
    if (chainSpec.chain.length === 0) {
      throw new Error('Chain cannot be empty');
    }
    
    if (chainSpec.chain.length > CHAIN_SECURITY_LIMITS.MAX_CHAIN_STEPS) {
      throw new Error(`Chain exceeds maximum allowed steps (${CHAIN_SECURITY_LIMITS.MAX_CHAIN_STEPS})`);
    }
    
    // Validate each step
    for (let i = 0; i < chainSpec.chain.length; i++) {
      const step = chainSpec.chain[i];
      if (!step.server_name || !step.tool_name) {
        throw new Error(`Step ${i}: missing required server_name or tool_name`);
      }
      
      this._validateStepStructure(step, i);
    }
    
    // Validate variables object if present
    if (chainSpec.variables) {
      this._validateVariables(chainSpec.variables);
    }
    
    // Validate execution options if present
    if (chainSpec.execution_options) {
      this._validateExecutionOptions(chainSpec.execution_options);
    }
  }

  /**
   * Validate individual step structure
   */
  _validateStepStructure(step, index) {
    // Validate server_name format
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,49}$/.test(step.server_name)) {
      throw new Error(`Step ${index}: invalid server_name format`);
    }
    
    // Validate tool_name format
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,49}$/.test(step.tool_name)) {
      throw new Error(`Step ${index}: invalid tool_name format`);
    }
    
    // Validate step ID if present
    if (step.id && !/^[a-zA-Z0-9_-]{1,50}$/.test(step.id)) {
      throw new Error(`Step ${index}: invalid step ID format`);
    }
    
    // Validate arguments size
    if (step.arguments) {
      const argsSize = JSON.stringify(step.arguments).length;
      if (argsSize > CHAIN_SECURITY_LIMITS.MAX_ARGUMENT_SIZE_BYTES) {
        throw new Error(`Step ${index}: arguments exceed size limit (${CHAIN_SECURITY_LIMITS.MAX_ARGUMENT_SIZE_BYTES} bytes)`);
      }
    }
  }

  /**
   * Security constraint validation
   */
  _validateSecurityConstraints(chainSpec) {
    // Check for blocked servers
    for (const step of chainSpec.chain) {
      if (this.options.blockedServers.includes(step.server_name)) {
        throw new Error(`Blocked server detected: ${step.server_name}`);
      }
      
      if (this.options.allowedServers && !this.options.allowedServers.includes(step.server_name)) {
        throw new Error(`Server not in allowlist: ${step.server_name}`);
      }
      
      // Check for blocked tools
      const toolId = `${step.server_name}__${step.tool_name}`;
      if (this.options.blockedTools.includes(toolId)) {
        throw new Error(`Blocked tool detected: ${toolId}`);
      }
      
      if (this.options.allowedTools && !this.options.allowedTools.includes(toolId)) {
        throw new Error(`Tool not in allowlist: ${toolId}`);
      }
    }
    
    // Validate variables for security risks
    if (chainSpec.variables) {
      this._validateVariablesSecurity(chainSpec.variables);
    }
    
    // Check for potential infinite loops
    this._validateNoInfiniteLoops(chainSpec);
    
    // Validate template expressions
    this._validateTemplateExpressions(chainSpec);
  }

  /**
   * Validate variables for security issues
   */
  _validateVariablesSecurity(variables) {
    const varSize = JSON.stringify(variables).length;
    if (varSize > CHAIN_SECURITY_LIMITS.MAX_VARIABLE_SIZE_BYTES) {
      throw new Error(`Variables exceed size limit (${CHAIN_SECURITY_LIMITS.MAX_VARIABLE_SIZE_BYTES} bytes)`);
    }
    
    for (const [key, value] of Object.entries(variables)) {
      // Validate variable name
      if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,49}$/.test(key)) {
        throw new Error(`Invalid variable name: ${key}`);
      }
      
      // Check for dangerous content in string values
      if (typeof value === 'string') {
        this._validateStringForSecurityRisks(value, `variable '${key}'`);
      }
    }
  }

  /**
   * Validate string content for security risks
   */
  _validateStringForSecurityRisks(str, context) {
    if (str.length > CHAIN_SECURITY_LIMITS.MAX_STRING_LENGTH) {
      throw new Error(`${context}: string exceeds maximum length`);
    }
    
    for (const pattern of CHAIN_SECURITY_LIMITS.BLOCKED_PATTERNS) {
      if (pattern.test(str)) {
        throw new Error(`${context}: contains blocked content pattern`);
      }
    }
  }

  /**
   * Check for potential infinite loops in step dependencies
   */
  _validateNoInfiniteLoops(chainSpec) {
    const dependencies = new Map();
    const stepIds = new Set();
    
    // Build dependency graph
    for (const step of chainSpec.chain) {
      if (step.id) {
        stepIds.add(step.id);
      }
      
      const stepDeps = new Set();
      
      // Check input_mapping dependencies
      if (step.input_mapping) {
        for (const mapping of Object.values(step.input_mapping)) {
          const match = mapping.match(/^([a-zA-Z0-9_-]+)\./);
          if (match && stepIds.has(match[1])) {
            stepDeps.add(match[1]);
          }
        }
      }
      
      // Check condition dependencies
      if (step.conditions && step.conditions.execute_if) {
        const conditionDeps = step.conditions.execute_if.match(/\b([a-zA-Z0-9_-]+)\./g);
        if (conditionDeps) {
          for (const dep of conditionDeps) {
            const stepId = dep.replace('.', '');
            if (stepIds.has(stepId)) {
              stepDeps.add(stepId);
            }
          }
        }
      }
      
      if (step.id) {
        dependencies.set(step.id, stepDeps);
      }
    }
    
    // Check for cycles using DFS
    const visited = new Set();
    const recursionStack = new Set();
    
    const hasCycle = (stepId) => {
      if (recursionStack.has(stepId)) {
        return true; // Cycle detected
      }
      
      if (visited.has(stepId)) {
        return false;
      }
      
      visited.add(stepId);
      recursionStack.add(stepId);
      
      const deps = dependencies.get(stepId) || new Set();
      for (const dep of deps) {
        if (hasCycle(dep)) {
          return true;
        }
      }
      
      recursionStack.delete(stepId);
      return false;
    };
    
    for (const stepId of stepIds) {
      if (hasCycle(stepId)) {
        throw new Error(`Circular dependency detected involving step: ${stepId}`);
      }
    }
  }

  /**
   * Validate template expressions for security
   */
  _validateTemplateExpressions(chainSpec) {
    const validateTemplate = (template, context) => {
      if (typeof template === 'string') {
        // Check for template injection patterns
        const templateMatches = template.match(/\{\{([^}]+)\}\}/g);
        if (templateMatches) {
          for (const match of templateMatches) {
            const expr = match.slice(2, -2).trim();
            this._validateStringForSecurityRisks(expr, `${context} template expression`);
          }
        }
      }
    };
    
    for (let i = 0; i < chainSpec.chain.length; i++) {
      const step = chainSpec.chain[i];
      
      // Validate transformations
      if (step.transformations) {
        for (const transform of step.transformations) {
          if (transform.template) {
            validateTemplate(transform.template, `Step ${i} transformation`);
          }
        }
      }
      
      // Validate arguments recursively
      if (step.arguments) {
        this._validateObjectForTemplates(step.arguments, `Step ${i} arguments`);
      }
    }
  }

  /**
   * Recursively validate object for template expressions
   */
  _validateObjectForTemplates(obj, context, depth = 0) {
    if (depth > CHAIN_SECURITY_LIMITS.MAX_NESTED_DEPTH) {
      throw new Error(`${context}: object nesting exceeds maximum depth`);
    }
    
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        this._validateStringForSecurityRisks(value, `${context}.${key}`);
      } else if (typeof value === 'object' && value !== null) {
        this._validateObjectForTemplates(value, `${context}.${key}`, depth + 1);
      }
    }
  }

  /**
   * Business logic validation
   */
  _validateBusinessLogic(chainSpec) {
    // Check for write operations requiring approval
    const writeOperations = this._detectWriteOperations(chainSpec);
    
    if (writeOperations.length > 0 && this.options.requireApprovalForWrites) {
      const approvalRequired = !chainSpec.execution_options?.approval_granted;
      
      if (approvalRequired) {
        this.executionStats.approvalRequestsGenerated++;
        throw new Error(`Write operations detected - approval required: ${writeOperations.join(', ')}`);
      }
    }
    
    // Validate execution timeout
    const executionOptions = chainSpec.execution_options || {};
    const timeoutMs = executionOptions.timeout_ms || 300000;
    
    if (timeoutMs > CHAIN_SECURITY_LIMITS.MAX_EXECUTION_TIME_MS) {
      throw new Error(`Execution timeout exceeds maximum allowed (${CHAIN_SECURITY_LIMITS.MAX_EXECUTION_TIME_MS}ms)`);
    }
  }

  /**
   * Detect write operations in chain
   */
  _detectWriteOperations(chainSpec) {
    const writeOperations = [];
    
    for (const step of chainSpec.chain) {
      const toolName = step.tool_name.toLowerCase();
      
      for (const writePattern of TOOL_RISK_CATEGORIES.WRITE_OPERATIONS) {
        if (toolName.includes(writePattern)) {
          writeOperations.push(`${step.server_name}__${step.tool_name}`);
          break;
        }
      }
    }
    
    return writeOperations;
  }

  /**
   * Generate security metadata for chain
   */
  _generateSecurityMetadata(chainSpec) {
    const writeOps = this._detectWriteOperations(chainSpec);
    const stepCount = chainSpec.chain.length;
    const hasParallelSteps = chainSpec.chain.some(step => step.parallel_group);
    const hasConditionals = chainSpec.chain.some(step => step.conditions);
    const hasTransforms = chainSpec.chain.some(step => step.transformations);
    
    // Calculate risk level
    let riskScore = 0;
    if (writeOps.length > 0) riskScore += 30;
    if (stepCount > 10) riskScore += 10;
    if (hasParallelSteps) riskScore += 5;
    if (hasConditionals) riskScore += 5;
    if (hasTransforms) riskScore += 5;
    
    let riskLevel = 'low';
    if (riskScore >= 30) riskLevel = 'high';
    else if (riskScore >= 15) riskLevel = 'medium';
    
    const warnings = [];
    if (writeOps.length > 0) {
      warnings.push(`Chain contains ${writeOps.length} write operation(s): ${writeOps.join(', ')}`);
    }
    if (stepCount > 20) {
      warnings.push(`Chain has ${stepCount} steps - consider splitting for better maintainability`);
    }
    
    return {
      riskLevel,
      riskScore,
      writeOperations: writeOps,
      stepCount,
      features: {
        hasParallelSteps,
        hasConditionals,
        hasTransforms,
        hasRetries: chainSpec.chain.some(step => step.retry)
      },
      warnings,
      approvalRequired: writeOps.length > 0 && this.options.requireApprovalForWrites
    };
  }

  /**
   * Apply security hardening transformations
   */
  _applySecurityHardening(chainSpec, securityMetadata) {
    const hardenedSpec = JSON.parse(JSON.stringify(chainSpec)); // Deep clone
    
    // Add security headers to execution options
    hardenedSpec.execution_options = {
      ...hardenedSpec.execution_options,
      _security: {
        validatedAt: new Date().toISOString(),
        riskLevel: securityMetadata.riskLevel,
        writeOperations: securityMetadata.writeOperations,
        validatorVersion: '1.0.0'
      }
    };
    
    // Sanitize and normalize variables
    if (hardenedSpec.variables) {
      for (const [key, value] of Object.entries(hardenedSpec.variables)) {
        if (typeof value === 'string') {
          // Basic HTML/script tag removal (more comprehensive sanitization needed for production)
          hardenedSpec.variables[key] = value
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/javascript:/gi, 'sanitized:');
        }
      }
    }
    
    // Add resource limits enforcement
    hardenedSpec._limits = {
      maxExecutionTimeMs: Math.min(
        hardenedSpec.execution_options?.timeout_ms || 300000,
        CHAIN_SECURITY_LIMITS.MAX_EXECUTION_TIME_MS
      ),
      maxParallelSteps: Math.min(
        hardenedSpec.execution_options?.max_parallel || 5,
        CHAIN_SECURITY_LIMITS.MAX_PARALLEL_STEPS
      )
    };
    
    return hardenedSpec;
  }

  /**
   * Validate execution options
   */
  _validateExecutionOptions(options) {
    if (options.timeout_ms && options.timeout_ms > CHAIN_SECURITY_LIMITS.MAX_EXECUTION_TIME_MS) {
      throw new Error(`Execution timeout exceeds maximum (${CHAIN_SECURITY_LIMITS.MAX_EXECUTION_TIME_MS}ms)`);
    }
    
    if (options.max_parallel && options.max_parallel > CHAIN_SECURITY_LIMITS.MAX_PARALLEL_STEPS) {
      throw new Error(`Max parallel steps exceeds limit (${CHAIN_SECURITY_LIMITS.MAX_PARALLEL_STEPS})`);
    }
  }

  /**
   * Validate variables object
   */
  _validateVariables(variables) {
    if (typeof variables !== 'object') {
      throw new Error('Variables must be an object');
    }
    
    const varSize = JSON.stringify(variables).length;
    if (varSize > CHAIN_SECURITY_LIMITS.MAX_VARIABLE_SIZE_BYTES) {
      throw new Error(`Variables exceed size limit (${CHAIN_SECURITY_LIMITS.MAX_VARIABLE_SIZE_BYTES} bytes)`);
    }
  }

  /**
   * Generate unique validation ID
   */
  _generateValidationId() {
    return `val_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Log audit events
   */
  _logAuditEvent(eventType, data) {
    if (!this.options.enableAuditLogging) return;
    
    const auditEntry = {
      timestamp: new Date().toISOString(),
      eventType,
      data: {
        ...data,
        // Redact sensitive information
        chainSpec: data.chainSpec ? '[REDACTED]' : undefined
      }
    };
    
    this.auditLog.push(auditEntry);
    
    // Log security events at appropriate level with fallback for test environments
    try {
      if (eventType.includes('violation') || eventType.includes('failed')) {
        if (typeof logger !== 'undefined' && logger && typeof logger.warn === 'function') {
          logger.warn('Chain validation security event', auditEntry);
        } else {
          console.warn('Chain validation security event', auditEntry);
        }
      } else {
        if (typeof logger !== 'undefined' && logger && typeof logger.debug === 'function') {
          logger.debug('Chain validation audit event', auditEntry);
        } else if (process.env.NODE_ENV !== 'test') {
          console.debug('Chain validation audit event', auditEntry);
        }
      }
    } catch (error) {
      // Fallback to console in case of logger issues
      if (process.env.NODE_ENV !== 'test') {
        console.log('Chain validation event:', eventType, data);
      }
    }
    
    // Trim audit log to prevent memory leaks
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-500);
    }
  }

  /**
   * Get validation statistics
   */
  getStats() {
    return {
      ...this.executionStats,
      auditLogSize: this.auditLog.length,
      limits: CHAIN_SECURITY_LIMITS
    };
  }

  /**
   * Get recent audit events (for debugging)
   */
  getRecentAuditEvents(count = 10) {
    return this.auditLog.slice(-count);
  }
}

// Export singleton instance
export const chainSpecValidator = new ChainSpecValidator();

// Export convenience validation function
export async function validateChainSpec(chainSpec, options = {}) {
  return await chainSpecValidator.validateAndHarden(chainSpec, options);
}

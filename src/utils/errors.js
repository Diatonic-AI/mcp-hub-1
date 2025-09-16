/**
 * Base error class for MCP Hub errors
 * All errors should extend from this to ensure consistent structure
 */
export class MCPHubError extends Error {
  constructor(code, message, data = {}) {
    super(message);
    this.code = code;
    this.data = data;
    this.name = "MCPHubError";

    // Preserve the proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Format error for logging
   */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      data: this.data,
      stack: this.stack,
    };
  }
}

/**
 * Configuration related errors
 */
export class ConfigError extends MCPHubError {
  constructor(message, data = {}) {
    super("CONFIG_ERROR", message, data);
    this.name = "ConfigError";
  }
}

/**
 * Server connection related errors
 */
export class ConnectionError extends MCPHubError {
  constructor(message, data = {}) {
    super("CONNECTION_ERROR", message, data);
    this.name = "ConnectionError";
  }
}

/**
 * Server startup/initialization errors
 */
export class ServerError extends MCPHubError {
  constructor(message, data = {}) {
    super("SERVER_ERROR", message, data);
    this.name = "ServerError";
  }
}

/**
 * Tool execution related errors
 */
export class ToolError extends MCPHubError {
  constructor(message, data = {}) {
    super("TOOL_ERROR", message, data);
    this.name = "ToolError";
  }
}

/**
 * Resource access related errors
 */
export class ResourceError extends MCPHubError {
  constructor(message, data = {}) {
    super("RESOURCE_ERROR", message, data);
    this.name = "ResourceError";
  }
}

/**
 * Request validation errors
 */
export class ValidationError extends MCPHubError {
  constructor(message, data = {}) {
    super("VALIDATION_ERROR", message, data);
    this.name = "ValidationError";
  }
}

/**
 * Authentication related errors
 */
export class AuthenticationError extends MCPHubError {
  constructor(message, data = {}) {
    super("AUTHENTICATION_ERROR", message, data);
    this.name = "AuthenticationError";
  }
}

/**
 * Authorization related errors
 */
export class AuthorizationError extends MCPHubError {
  constructor(message, data = {}) {
    super("AUTHORIZATION_ERROR", message, data);
    this.name = "AuthorizationError";
  }
}

/**
 * Rate limiting errors
 */
export class RateLimitError extends MCPHubError {
  constructor(message, data = {}) {
    super("RATE_LIMIT_ERROR", message, data);
    this.name = "RateLimitError";
  }
}

/**
 * Helper function to determine if error is one of our custom errors
 */
export function isMCPHubError(error) {
  return error instanceof MCPHubError;
}

/**
 * Helper function to wrap unknown errors as MCPHubError
 */
export function wrapError(error, code = "UNEXPECTED_ERROR", data = {}) {
  if (isMCPHubError(error)) {
    return error;
  }

  return new MCPHubError(error.code || code, error.message, {
    ...data,
    originalError: error,
  });
}

/**
 * McpError class for compatibility with MCP SDK patterns
 * Extends ValidationError and maps error codes
 */
export class McpError extends ValidationError {
  constructor(code, message, data = {}) {
    super(message, { ...data, errorCode: code });
    this.name = "McpError";
    this.errorCode = code;
  }
}

/**
 * MCP SDK Error Codes for compatibility
 */
export const ErrorCode = {
  InvalidParams: "INVALID_PARAMS",
  InternalError: "INTERNAL_ERROR",
  ConnectionError: "CONNECTION_ERROR",
  InvalidRequest: "INVALID_REQUEST",
  MethodNotFound: "METHOD_NOT_FOUND",
  NotAuthorized: "NOT_AUTHORIZED"
};

/**
 * Database related errors
 */
export class DatabaseError extends MCPHubError {
  constructor(message, data = {}) {
    super("DATABASE_ERROR", message, data);
    this.name = "DatabaseError";
  }
}

// ============= ML/DL Pipeline Specific Errors =============

/**
 * Training pipeline related errors
 */
export class TrainingError extends MCPHubError {
  constructor(message, data = {}) {
    super("TRAINING_ERROR", message, data);
    this.name = "TrainingError";
  }
}

/**
 * Model registry and versioning errors
 */
export class ModelRegistryError extends MCPHubError {
  constructor(message, data = {}) {
    super("MODEL_REGISTRY_ERROR", message, data);
    this.name = "ModelRegistryError";
  }
}

/**
 * Inference service related errors
 */
export class InferenceError extends MCPHubError {
  constructor(message, data = {}) {
    super("INFERENCE_ERROR", message, data);
    this.name = "InferenceError";
  }
}

/**
 * Feature engineering and computation errors
 */
export class FeatureEngineeringError extends MCPHubError {
  constructor(message, data = {}) {
    super("FEATURE_ENGINEERING_ERROR", message, data);
    this.name = "FeatureEngineeringError";
  }
}

/**
 * Batch prediction job errors
 */
export class BatchPredictionError extends MCPHubError {
  constructor(message, data = {}) {
    super("BATCH_PREDICTION_ERROR", message, data);
    this.name = "BatchPredictionError";
  }
}

/**
 * Hyperparameter optimization errors
 */
export class HPOError extends MCPHubError {
  constructor(message, data = {}) {
    super("HPO_ERROR", message, data);
    this.name = "HPOError";
  }
}

/**
 * A/B testing and experiment errors
 */
export class ExperimentError extends MCPHubError {
  constructor(message, data = {}) {
    super("EXPERIMENT_ERROR", message, data);
    this.name = "ExperimentError";
  }
}

/**
 * Model monitoring and drift detection errors
 */
export class MonitoringError extends MCPHubError {
  constructor(message, data = {}) {
    super("MONITORING_ERROR", message, data);
    this.name = "MonitoringError";
  }
}

/**
 * Model explainability errors
 */
export class ExplainabilityError extends MCPHubError {
  constructor(message, data = {}) {
    super("EXPLAINABILITY_ERROR", message, data);
    this.name = "ExplainabilityError";
  }
}

/**
 * AutoML process errors
 */
export class AutoMLError extends MCPHubError {
  constructor(message, data = {}) {
    super("AUTOML_ERROR", message, data);
    this.name = "AutoMLError";
  }
}

/**
 * Map ML errors to HTTP status codes
 */
export function mapMLErrorToStatus(error) {
  if (error instanceof ValidationError || error instanceof FeatureEngineeringError) {
    return 400; // Bad Request
  }
  if (error instanceof AuthenticationError) {
    return 401; // Unauthorized
  }
  if (error instanceof AuthorizationError) {
    return 403; // Forbidden
  }
  if (error instanceof ModelRegistryError && error.data?.notFound) {
    return 404; // Not Found
  }
  if (error instanceof TrainingError && error.data?.conflict) {
    return 409; // Conflict
  }
  if (error instanceof RateLimitError) {
    return 429; // Too Many Requests
  }
  if (error instanceof InferenceError && error.data?.timeout) {
    return 504; // Gateway Timeout
  }
  if (error instanceof DatabaseError) {
    return 503; // Service Unavailable
  }
  
  // Default to 500 for all other ML errors
  return 500; // Internal Server Error
}

/**
 * Wrap error with proper type and redaction
 */
export function wrapMLError(error, ErrorClass = TrainingError, message = null) {
  if (error instanceof MCPHubError) {
    return error;
  }
  
  // Redact sensitive information
  const safeMessage = message || error.message;
  const safeData = {
    originalCode: error.code,
    // Never include these in error data
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  };
  
  // Remove sensitive patterns from message
  const redactedMessage = safeMessage
    .replace(/password=([^\s]+)/gi, 'password=***')
    .replace(/token=([^\s]+)/gi, 'token=***')
    .replace(/key=([^\s]+)/gi, 'key=***')
    .replace(/secret=([^\s]+)/gi, 'secret=***');
  
  return new ErrorClass(redactedMessage, safeData);
}

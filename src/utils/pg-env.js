/**
 * PostgreSQL Integration Environment Variable Resolver
 * 
 * Provides consistent parsing and resolution of PostgreSQL integration
 * environment variables with backward compatibility, aliases, and safe defaults.
 * 
 * Key Features:
 * - Canonical variable names with backward-compatible aliases
 * - Safe defaults that prevent restart loops on missing password
 * - Proper precedence rules (DISABLE_* wins over ENABLE_*)
 * - Flexible boolean parsing for various formats
 * - Security-conscious logging (no password leakage)
 */

import logger from './logger.js';

/**
 * Parse a value as a boolean with flexible format support
 * @param {any} val - The value to parse
 * @returns {boolean|undefined} - true, false, or undefined if invalid
 */
export function parseBooleanEnv(val) {
  if (val == null) return undefined;
  
  const v = String(val).trim().toLowerCase();
  
  // Truthy values
  if (['1', 'true', 'yes', 'on', 'enable', 'enabled'].includes(v)) {
    return true;
  }
  
  // Falsy values
  if (['0', 'false', 'no', 'off', 'disable', 'disabled'].includes(v)) {
    return false;
  }
  
  // Invalid/unrecognized value
  return undefined;
}

/**
 * Resolve PostgreSQL integration settings from environment variables
 * @param {object} env - Environment variables object (defaults to process.env)
 * @returns {object} - Resolution result with enabled flag, reason, and metadata
 */
export function resolvePostgresIntegrationEnv(env = process.env) {
  // Extract raw values from all supported variable names
  const disableRaw = env.DISABLE_POSTGRESQL_INTEGRATION ?? env.DISABLE_POSTGRES_INTEGRATION;
  const enableRaw = env.ENABLE_POSTGRESQL_INTEGRATION ?? env.ENABLE_POSTGRES_INTEGRATION ?? env.ENABLE_POSTGRES ?? env.PG_INTEGRATION_ENABLED;
  
  // Parse boolean values
  const disable = parseBooleanEnv(disableRaw);
  const enable = parseBooleanEnv(enableRaw);
  
  // Check for password presence (without logging the value)
  const hasPassword = !!(env.POSTGRES_PASSWORD && String(env.POSTGRES_PASSWORD).length > 0);
  
  // Redacted flags for logging (no sensitive data)
  const flagsUsed = {
    disableFlag: disableRaw ? 'set' : 'unset',
    enableFlag: enableRaw ? 'set' : 'unset', 
    hasPassword: hasPassword
  };
  
  // Rule 1: Explicit disable wins over everything
  if (disable === true) {
    return {
      enabled: false,
      reason: 'disabled_by_flag',
      flagsUsed
    };
  }
  
  // Rule 2: Explicit enable, but check password requirement
  if (enable === true) {
    if (!hasPassword) {
      // Auto-disable to prevent restart loops
      return {
        enabled: false,
        reason: 'password_missing_auto_disabled',
        flagsUsed
      };
    }
    return {
      enabled: true,
      reason: 'enabled_by_flag',
      flagsUsed
    };
  }
  
  // Rule 3: Explicit disable (enable=false)
  if (enable === false) {
    return {
      enabled: false,
      reason: 'disabled_by_flag',
      flagsUsed
    };
  }
  
  // Rule 4: No explicit flags - safe default based on password presence
  if (!hasPassword) {
    return {
      enabled: false,
      reason: 'no_flags_password_missing',
      flagsUsed
    };
  }
  
  return {
    enabled: true,
    reason: 'no_flags_password_present',
    flagsUsed
  };
}

/**
 * Log the PostgreSQL integration resolution result
 * @param {object} resolution - Result from resolvePostgresIntegrationEnv
 */
export function logPostgresIntegrationResolution(resolution) {
  const { enabled, reason, flagsUsed } = resolution;
  
  const logData = {
    enabled,
    reason,
    flags: {
      disable: flagsUsed.disableFlag,
      enable: flagsUsed.enableFlag,
      hasPassword: flagsUsed.hasPassword
    }
  };
  
  if (enabled) {
    logger.info('PostgreSQL integration enabled', logData);
  } else {
    logger.info('PostgreSQL integration disabled', logData);
    
    // Provide helpful guidance for common scenarios
    if (reason === 'password_missing_auto_disabled') {
      logger.info('To enable PostgreSQL integration, set POSTGRES_PASSWORD environment variable');
    } else if (reason === 'no_flags_password_missing') {
      logger.info('PostgreSQL integration auto-disabled due to missing password. Set ENABLE_POSTGRESQL_INTEGRATION=true and POSTGRES_PASSWORD to enable');
    }
  }
}

/**
 * Get human-readable description of the resolution result
 * @param {object} resolution - Result from resolvePostgresIntegrationEnv
 * @returns {string} - Human-readable description
 */
export function getResolutionDescription(resolution) {
  const { enabled, reason } = resolution;
  
  switch (reason) {
    case 'disabled_by_flag':
      return enabled ? 'Enabled by environment flag' : 'Disabled by environment flag';
    case 'enabled_by_flag':
      return 'Enabled by environment flag with password present';
    case 'password_missing_auto_disabled':
      return 'Auto-disabled due to missing PostgreSQL password (prevents restart loops)';
    case 'no_flags_password_missing':
      return 'Auto-disabled due to missing password (no explicit flags)';
    case 'no_flags_password_present':
      return 'Auto-enabled due to password presence (no explicit flags)';
    default:
      return `${enabled ? 'Enabled' : 'Disabled'} (${reason})`;
  }
}

export default {
  parseBooleanEnv,
  resolvePostgresIntegrationEnv,
  logPostgresIntegrationResolution,
  getResolutionDescription
};

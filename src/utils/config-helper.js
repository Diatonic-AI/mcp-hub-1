/**
 * Configuration helper utilities
 */

/**
 * Normalize port configuration
 * Handles single port, array of ports, or comma-separated string
 * @param {number|string|Array} portConfig - Port configuration
 * @returns {number} The primary port to use
 */
export function normalizePort(portConfig) {
  // Handle undefined or null
  if (portConfig == null) {
    return 3000; // Default port
  }

  // Handle array of ports - use first one as primary
  if (Array.isArray(portConfig)) {
    const primaryPort = portConfig[0];
    return normalizePort(primaryPort);
  }

  // Handle comma-separated string
  if (typeof portConfig === 'string' && portConfig.includes(',')) {
    const ports = portConfig.split(',').map(p => p.trim());
    return normalizePort(ports[0]);
  }

  // Convert to number
  const port = parseInt(portConfig, 10);
  
  // Validate port number
  if (isNaN(port) || port < 1 || port > 65535) {
    console.warn(`Invalid port configuration: ${portConfig}, using default 3000`);
    return 3000;
  }

  return port;
}

/**
 * Get all ports from configuration
 * @param {number|string|Array} portConfig - Port configuration
 * @returns {Array<number>} Array of all configured ports
 */
export function getAllPorts(portConfig) {
  // Handle undefined or null
  if (portConfig == null) {
    return [3000];
  }

  // Handle array of ports
  if (Array.isArray(portConfig)) {
    return portConfig
      .map(p => normalizePort(p))
      .filter(p => p > 0 && p <= 65535);
  }

  // Handle comma-separated string
  if (typeof portConfig === 'string' && portConfig.includes(',')) {
    const ports = portConfig.split(',').map(p => p.trim());
    return ports
      .map(p => normalizePort(p))
      .filter(p => p > 0 && p <= 65535);
  }

  // Single port
  const port = normalizePort(portConfig);
  return [port];
}

/**
 * Parse command line arguments for port configuration
 * @param {Array<string>} args - Command line arguments
 * @returns {number|null} Parsed port number or null
 */
export function parsePortFromArgs(args) {
  if (!Array.isArray(args)) {
    return null;
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    // Handle --port=VALUE format
    if (arg.startsWith('--port=')) {
      const value = arg.substring(7);
      return normalizePort(value);
    }
    
    // Handle --port VALUE format
    if (arg === '--port' && i + 1 < args.length) {
      const value = args[i + 1];
      // Skip if next arg is another flag
      if (!value.startsWith('--')) {
        return normalizePort(value);
      }
    }
    
    // Handle -p VALUE format
    if (arg === '-p' && i + 1 < args.length) {
      const value = args[i + 1];
      if (!value.startsWith('-')) {
        return normalizePort(value);
      }
    }
  }

  return null;
}

/**
 * Merge configuration from multiple sources
 * Priority: CLI args > environment > config file > defaults
 * @param {Object} options - Configuration options
 * @returns {Object} Merged configuration
 */
export function mergeConfiguration(options = {}) {
  const {
    defaults = {},
    configFile = {},
    environment = {},
    cliArgs = {}
  } = options;

  // Start with defaults
  const config = { ...defaults };

  // Apply config file settings
  Object.assign(config, configFile);

  // Apply environment variables
  if (environment.PORT) {
    config.port = normalizePort(environment.PORT);
  }
  
  if (environment.HOST) {
    config.host = environment.HOST;
  }

  if (environment.NODE_ENV) {
    config.env = environment.NODE_ENV;
  }

  // Apply CLI arguments (highest priority)
  if (cliArgs.port !== undefined) {
    config.port = normalizePort(cliArgs.port);
  }
  
  if (cliArgs.host !== undefined) {
    config.host = cliArgs.host;
  }

  if (cliArgs.config !== undefined) {
    config.configPath = cliArgs.config;
  }

  return config;
}

/**
 * Validate configuration
 * @param {Object} config - Configuration object
 * @returns {Object} Validation result
 */
export function validateConfiguration(config) {
  const errors = [];
  const warnings = [];

  // Validate port
  if (config.port) {
    const port = normalizePort(config.port);
    if (port < 1024 && process.platform !== 'win32') {
      warnings.push(`Port ${port} requires elevated privileges on Unix systems`);
    }
    if (port < 1 || port > 65535) {
      errors.push(`Invalid port number: ${port}`);
    }
  }

  // Validate host
  if (config.host) {
    const validHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '::'];
    if (!validHosts.includes(config.host) && !config.host.match(/^(\d{1,3}\.){3}\d{1,3}$/)) {
      warnings.push(`Unusual host configuration: ${config.host}`);
    }
  }

  // Validate database URLs if present
  if (config.databaseUrl) {
    if (!config.databaseUrl.startsWith('postgresql://') && 
        !config.databaseUrl.startsWith('postgres://')) {
      warnings.push('Database URL should start with postgresql:// or postgres://');
    }
  }

  // Validate Redis configuration if present
  if (config.redis) {
    if (config.redis.port && (config.redis.port < 1 || config.redis.port > 65535)) {
      errors.push(`Invalid Redis port: ${config.redis.port}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

export default {
  normalizePort,
  getAllPorts,
  parsePortFromArgs,
  mergeConfiguration,
  validateConfiguration
};

/**
 * ServerLoadingManager - Advanced Server Loading and Lifecycle Management
 * 
 * Features:
 * 1. Immediate loading of core servers on startup
 * 2. Idle-triggered loading of remaining servers after 60s of inactivity
 * 3. Auto-unloading after 360s of server inactivity
 * 4. Persistent tool registry across container restarts
 * 5. Intelligent load balancing and resource management
 */

import EventEmitter from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import logger from './logger.js';

export class ServerLoadingManager extends EventEmitter {
  constructor(mcpHub, options = {}) {
    super();
    
    this.mcpHub = mcpHub;
    this.options = {
      // Core servers to load immediately on startup
      coreServers: [
        'filesystem',
        'mcp-everything', 
        'mcp-fetch',
        'mcp-time',
        'mcp-sequential-thinking',
        'mcp-memory',
        'github'
        // Note: wix-mcp-remote moved to lazy load due to OAuth requirements
      ],
      // Idle time before triggering batch loading (60 seconds)
      idleLoadTriggerMs: 60 * 1000,
      // Server inactivity timeout (360 seconds)
      serverIdleTimeoutMs: 360 * 1000,
      // Delay between loading servers in batch mode (2 seconds)
      batchLoadDelayMs: 2 * 1000,
      // Persistent registry file path
      persistentRegistryPath: process.env.DATA_DIR 
        ? path.join(process.env.DATA_DIR, 'tool-registry.json')
        : path.join(process.env.HOME, '.local', 'share', 'mcp-hub', 'data', 'tool-registry.json'),
      // Enable persistent registry
      enablePersistence: true,
      ...options
    };

    // Server states and tracking
    this.serverStates = new Map(); // serverName -> ServerState
    this.loadingQueue = [];
    this.lastActivity = new Date();
    this.batchLoadingActive = false;
    this.systemIdleTimer = null;
    this.serverTimeouts = new Map(); // serverName -> timeoutId

    // Activity tracking
    this.activityCounter = 0;
    this.startTime = new Date();

    // Persistent registry
    this.persistentRegistry = {
      tools: new Map(),
      servers: new Map(),
      lastUpdate: null,
      version: 1
    };

    // Initialize server state tracking
    this.initializeStateTracking();
  }

  /**
   * Initialize the loading manager
   */
  async initialize() {
    logger.info(`Initializing ServerLoadingManager`, {
      coreServers: this.options.coreServers,
      idleLoadTriggerMs: this.options.idleLoadTriggerMs,
      serverIdleTimeoutMs: this.options.serverIdleTimeoutMs,
      persistenceEnabled: this.options.enablePersistence
    });

    // Setup persistent registry
    if (this.options.enablePersistence) {
      await this.loadPersistentRegistry();
    }

    // Initialize state tracking for all configured servers
    this.initializeStateTracking();

    // Load core servers immediately
    await this.loadCoreServers();

    // Start activity monitoring for idle-triggered loading
    this.startActivityMonitoring();

    logger.info(`ServerLoadingManager initialized successfully`, {
      totalServers: this.mcpHub.connections.size,
      coreServersLoaded: this.options.coreServers.length,
      queuedForLazyLoad: this.loadingQueue.length
    });
  }

  /**
   * Initialize state tracking for all configured servers
   */
  initializeStateTracking() {
    // Get all configured servers from MCPHub
    const config = this.mcpHub.configManager.getConfig();
    const servers = Object.entries(config?.mcpServers || {});
    
    // Track server connections/disconnections
    for (const [serverName, serverConfig] of servers) {
      if (serverConfig.disabled !== true) {
        this.initializeServerState(serverName, serverConfig);
      }
    }
    
    logger.debug(`Initialized state tracking for ${this.serverStates.size} servers`);
    
    // Set up event listeners for server state changes
    this.mcpHub.on('serverConnected', (data) => {
      this.onServerConnected(data.serverName);
    });

    this.mcpHub.on('serverDisconnected', (data) => {
      this.onServerDisconnected(data.serverName);
    });

    // Track tool calls and other activities
    this.mcpHub.on('toolCalled', (data) => {
      this.recordActivity('tool_call', data);
    });
  }

  /**
   * Initialize server state entry
   */
  initializeServerState(serverName, serverConfig) {
    const state = {
      name: serverName,
      config: serverConfig,
      status: 'idle', // idle, loading, connected, unloading, error
      priority: this.options.coreServers.includes(serverName) ? 'core' : 'standard',
      lastActivity: null,
      lastConnected: null,
      lastDisconnected: null,
      connectionCount: 0,
      toolCallCount: 0,
      loadingStarted: null,
      loadingCompleted: null,
      error: null,
      autoUnloadTimer: null
    };

    this.serverStates.set(serverName, state);

    // Add to loading queue if not a core server
    if (!this.options.coreServers.includes(serverName)) {
      this.loadingQueue.push(serverName);
    }
  }

  /**
   * Load core servers immediately on startup
   */
  async loadCoreServers() {
    logger.info('Loading core servers immediately', {
      coreServers: this.options.coreServers,
      totalTrackedServers: this.serverStates.size,
      trackedServerNames: Array.from(this.serverStates.keys())
    });

    const loadPromises = this.options.coreServers.map(async (serverName) => {
      try {
        const state = this.serverStates.get(serverName);
        if (!state) {
          logger.warn(`Core server '${serverName}' not found in configuration`, {
            serverName,
            availableServers: Array.from(this.serverStates.keys()),
            totalStates: this.serverStates.size
          });
          return { serverName, status: 'not_found' };
        }

        state.status = 'loading';
        state.loadingStarted = new Date();

        logger.info(`Loading core server: ${serverName}`, { server: serverName });
        
        // Actually connect the server to register its tools
        const config = this.mcpHub.configManager.getConfig();
        const serverConfig = config.mcpServers?.[serverName];
        if (!serverConfig) {
          throw new Error(`Server configuration not found for '${serverName}'`);
        }
        
        // Use a timeout to prevent hanging
        const connectPromise = this.mcpHub.connectServer(serverName, serverConfig);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Connection timeout after 30 seconds')), 30000);
        });
        
        await Promise.race([connectPromise, timeoutPromise]);
        
        state.status = 'connected';
        state.loadingCompleted = new Date();
        state.lastConnected = new Date();
        state.connectionCount++;

        // Set up auto-unload timer
        this.setupAutoUnloadTimer(serverName);

        logger.info(`Successfully connected core server: ${serverName}`, { server: serverName });
        return { serverName, status: 'success' };
      } catch (error) {
        const state = this.serverStates.get(serverName);
        if (state) {
          state.status = 'error';
          state.error = error.message;
        }
        
        // Check for authentication-related errors
        const authErrorPatterns = [
          /oauth/i,
          /authentication/i,
          /authorization/i,
          /token/i,
          /api.key/i,
          /credential/i,
          /unauthorized/i,
          /forbidden/i,
          /WIX_API_TOKEN/i,
          /GITHUB_PERSONAL_ACCESS_TOKEN/i
        ];
        
        const isAuthError = authErrorPatterns.some(pattern => pattern.test(error.message));
        
        if (isAuthError) {
          state.status = 'auth_required';
          logger.warn(`Core server '${serverName}' requires authentication - flagged for manual setup`, {
            server: serverName,
            error: error.message,
            authRequired: true
          });
          return { serverName, status: 'auth_required', error: error.message };
        }
        
        logger.error('SERVER_LOAD_ERROR', `Failed to load core server '${serverName}': ${error.message}`, {
          server: serverName,
          error: error.message,
          stack: error.stack
        }, false);
        
        // Don't crash the application for core server failures
        // Continue with other servers and allow lazy loading to retry later
        return { serverName, status: 'error', error: error.message };
      }
    });

    const results = await Promise.all(loadPromises);
    const successful = results.filter(r => r.status === 'success').length;
    const failed = results.filter(r => r.status === 'error').length;
    const authRequired = results.filter(r => r.status === 'auth_required').length;

    logger.info(`Core server loading completed`, {
      total: this.options.coreServers.length,
      successful,
      failed,
      authRequired,
      loadTime: new Date() - this.startTime
    });

    // Log servers that require authentication setup
    if (authRequired > 0) {
      const authServers = results.filter(r => r.status === 'auth_required').map(r => r.serverName);
      logger.info(`Servers requiring authentication setup: ${authServers.join(', ')}`, {
        authRequiredServers: authServers
      });
    }

    // Register loaded tools in persistent registry
    if (this.options.enablePersistence) {
      await this.updateAllServersInRegistry();
    }
  }

  /**
   * Start monitoring system activity for idle-triggered loading
   */
  startActivityMonitoring() {
    this.systemIdleTimer = setInterval(() => {
      const timeSinceLastActivity = new Date() - this.lastActivity;
      
      if (timeSinceLastActivity >= this.options.idleLoadTriggerMs && 
          !this.batchLoadingActive && 
          this.loadingQueue.length > 0) {
        
        logger.info('System idle detected, starting batch loading of remaining servers', {
          idleTimeMs: timeSinceLastActivity,
          queuedServers: this.loadingQueue.length
        });
        
        this.startBatchLoading();
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Start batch loading of remaining servers
   */
  async startBatchLoading() {
    if (this.batchLoadingActive || this.loadingQueue.length === 0) {
      return;
    }

    this.batchLoadingActive = true;
    logger.info('Starting batch loading process', {
      queueLength: this.loadingQueue.length,
      delayBetweenServers: this.options.batchLoadDelayMs
    });
    
    // Track failed servers to prevent retry loops
    const failedServers = new Set();

    while (this.loadingQueue.length > 0) {
      const serverName = this.loadingQueue.shift();
      
      // Skip servers that have already failed to prevent infinite retry loops
      if (failedServers.has(serverName)) {
        logger.debug(`Skipping failed server '${serverName}' to prevent retry loop`, {
          serverName,
          remainingInQueue: this.loadingQueue.length
        });
        continue;
      }
      
      try {
        await this.loadServer(serverName);
        
        // Server loaded successfully - wait between loads to prevent resource spikes
        if (this.loadingQueue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, this.options.batchLoadDelayMs));
        }
        
        // Check if we should pause due to activity
        const timeSinceLastActivity = new Date() - this.lastActivity;
        if (timeSinceLastActivity < this.options.idleLoadTriggerMs) {
          logger.info('Activity detected during batch loading, pausing batch load', {
            remainingServers: this.loadingQueue.length
          });
          break;
        }
        
      } catch (error) {
        // Log batch loading errors but continue with other servers
        // This prevents individual server failures from stopping the entire batch loading process
        logger.error('BATCH_LOAD_ERROR', `Failed to load server '${serverName}' during batch loading: ${error.message}`, {
          server: serverName,
          error: error.message,
          remainingInQueue: this.loadingQueue.length
        }, false);
        
        // Update server state to reflect the error
        const state = this.serverStates.get(serverName);
        if (state) {
          state.status = 'error';
          state.error = error.message;
        }
        
        // Add to failed servers to prevent retry loops
        failedServers.add(serverName);
      }
    }

    this.batchLoadingActive = false;
    
    if (this.loadingQueue.length === 0) {
      logger.info('Batch loading completed - all servers loaded', {
        totalLoadTime: new Date() - this.startTime
      });
    }
  }

  /**
   * Load a specific server
   */
  async loadServer(serverName) {
    const state = this.serverStates.get(serverName);
    if (!state) {
      throw new Error(`Server '${serverName}' not found`);
    }

    if (state.status === 'connected' || state.status === 'loading') {
      return; // Already loaded or loading
    }

    state.status = 'loading';
    state.loadingStarted = new Date();

    logger.info(`Loading server: ${serverName}`, { 
      server: serverName,
      priority: state.priority 
    });

    try {
      // Actually connect the server to register its tools
      const config = this.mcpHub.configManager.getConfig();
      const serverConfig = config.mcpServers?.[serverName];
      if (!serverConfig) {
        throw new Error(`Server configuration not found for '${serverName}'`);
      }
      
      await this.mcpHub.connectServer(serverName, serverConfig);

      state.status = 'connected';
      state.loadingCompleted = new Date();
      state.lastConnected = new Date();
      state.connectionCount++;

      // Set up auto-unload timer
      this.setupAutoUnloadTimer(serverName);

      // Update persistent registry
      if (this.options.enablePersistence) {
        await this.updateAllServersInRegistry();
      }
    } catch (error) {
      // Check for authentication-related errors
      const authErrorPatterns = [
        /oauth/i,
        /authentication/i,
        /authorization/i,
        /token/i,
        /api.key/i,
        /credential/i,
        /unauthorized/i,
        /forbidden/i,
        /WIX_API_TOKEN/i,
        /GITHUB_PERSONAL_ACCESS_TOKEN/i
      ];
      
      const isAuthError = authErrorPatterns.some(pattern => pattern.test(error.message));
      
      if (isAuthError) {
        state.status = 'auth_required';
        state.error = error.message;
        logger.warn(`Server '${serverName}' requires authentication - skipping`, {
          server: serverName,
          error: error.message,
          authRequired: true
        });
        return; // Skip this server, don't retry
      }
      
      // For other errors, mark as failed and potentially retry later
      state.status = 'error';
      state.error = error.message;
      logger.error('SERVER_LOAD_ERROR', `Failed to load server '${serverName}': ${error.message}`, {
        server: serverName,
        error: error.message
      }, false);
      
      // Don't re-throw errors during batch loading - this was causing container restarts
      // The error is already logged and the server state is marked as 'error'
      // This allows other servers to continue loading without crashing the entire process
    }
  }

  /**
   * Set up auto-unload timer for a server
   */
  setupAutoUnloadTimer(serverName) {
    // Core servers should never be auto-unloaded - they stay connected permanently
    if (this.options.coreServers.includes(serverName)) {
      logger.debug('Skipping auto-unload timer for core server', { serverName });
      return;
    }

    // Clear existing timer
    this.clearAutoUnloadTimer(serverName);

    const timerId = setTimeout(async () => {
      await this.unloadServer(serverName, 'idle_timeout');
    }, this.options.serverIdleTimeoutMs);

    this.serverTimeouts.set(serverName, timerId);
  }

  /**
   * Clear auto-unload timer for a server
   */
  clearAutoUnloadTimer(serverName) {
    const timerId = this.serverTimeouts.get(serverName);
    if (timerId) {
      clearTimeout(timerId);
      this.serverTimeouts.delete(serverName);
    }
  }

  /**
   * Unload a server due to inactivity
   */
  async unloadServer(serverName, reason = 'manual') {
    const state = this.serverStates.get(serverName);
    if (!state || state.status !== 'connected') {
      return;
    }

    logger.info(`Unloading server due to ${reason}: ${serverName}`, {
      server: serverName,
      reason,
      lastActivity: state.lastActivity,
      connectedTime: state.lastConnected ? new Date() - state.lastConnected : null
    });

    state.status = 'unloading';
    state.lastDisconnected = new Date();

    try {
      await this.mcpHub.stopServer(serverName);
      
      state.status = 'idle';
      
      // Clear auto-unload timer
      this.clearAutoUnloadTimer(serverName);
      
      // Add back to loading queue if it's not a core server and reason is idle timeout
      if (reason === 'idle_timeout' && !this.options.coreServers.includes(serverName)) {
        this.loadingQueue.push(serverName);
      }

      logger.info(`Server unloaded successfully: ${serverName}`, {
        server: serverName,
        reason
      });
      
    } catch (error) {
      state.status = 'error';
      state.error = error.message;
      
      logger.error('SERVER_UNLOAD_ERROR', `Failed to unload server '${serverName}': ${error.message}`, {
        server: serverName,
        error: error.message
      }, false);
    }
  }

  /**
   * Record activity to reset idle timers
   */
  recordActivity(type, data = {}) {
    this.lastActivity = new Date();
    this.activityCounter++;

    // Reset server-specific activity timer if it's a tool call
    if (type === 'tool_call' && data.serverName) {
      const state = this.serverStates.get(data.serverName);
      if (state) {
        state.lastActivity = new Date();
        state.toolCallCount++;
        
        // Reset auto-unload timer
        this.setupAutoUnloadTimer(data.serverName);
      }
    }

    logger.debug('Activity recorded', {
      type,
      activityCounter: this.activityCounter,
      serverName: data.serverName
    });
  }

  /**
   * Handle server connection events
   */
  onServerConnected(serverName) {
    const state = this.serverStates.get(serverName);
    if (state) {
      state.status = 'connected';
      state.lastConnected = new Date();
      state.connectionCount++;
      
      this.setupAutoUnloadTimer(serverName);
      
      logger.debug(`Server connected: ${serverName}`, {
        server: serverName,
        connectionCount: state.connectionCount
      });
    }
  }

  /**
   * Handle server disconnection events
   */
  onServerDisconnected(serverName) {
    const state = this.serverStates.get(serverName);
    if (state) {
      state.status = 'idle';
      state.lastDisconnected = new Date();
      
      this.clearAutoUnloadTimer(serverName);
      
      logger.debug(`Server disconnected: ${serverName}`, { server: serverName });
    }
  }

  /**
   * Load persistent registry from disk
   */
  async loadPersistentRegistry() {
    try {
      const registryPath = this.options.persistentRegistryPath;
      
      // Ensure directory exists
      await fs.mkdir(path.dirname(registryPath), { recursive: true });
      
      // Try to load existing registry
      try {
        const data = await fs.readFile(registryPath, 'utf8');
        const parsed = JSON.parse(data);
        
        // Convert Map data back from JSON
        this.persistentRegistry.tools = new Map(parsed.tools || []);
        this.persistentRegistry.servers = new Map(parsed.servers || []);
        this.persistentRegistry.lastUpdate = parsed.lastUpdate;
        this.persistentRegistry.version = parsed.version || 1;
        
        logger.info('Persistent registry loaded', {
          toolCount: this.persistentRegistry.tools.size,
          serverCount: this.persistentRegistry.servers.size,
          lastUpdate: this.persistentRegistry.lastUpdate
        });
        
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.warn(`Failed to load persistent registry: ${error.message}`);
        } else {
          logger.info('No existing persistent registry found, starting fresh');
        }
      }
      
    } catch (error) {
      logger.error('REGISTRY_SETUP_ERROR', `Error setting up persistent registry: ${error.message}`, {}, false);
    }
  }

  /**
   * Save persistent registry to disk
   */
  async savePersistentRegistry() {
    if (!this.options.enablePersistence) {
      return;
    }

    try {
      const registryPath = this.options.persistentRegistryPath;
      
      // Convert Maps to JSON-serializable format
      const data = {
        tools: Array.from(this.persistentRegistry.tools.entries()),
        servers: Array.from(this.persistentRegistry.servers.entries()),
        lastUpdate: new Date().toISOString(),
        version: this.persistentRegistry.version
      };
      
      await fs.writeFile(registryPath, JSON.stringify(data, null, 2));
      
      logger.debug('Persistent registry saved', {
        toolCount: this.persistentRegistry.tools.size,
        serverCount: this.persistentRegistry.servers.size,
        path: registryPath
      });
      
    } catch (error) {
      logger.error('REGISTRY_SAVE_ERROR', `Failed to save persistent registry: ${error.message}`, {}, false);
    }
  }

  /**
   * Update persistent registry with server and tool information
   */
  async updatePersistentRegistry(serverName, serverInfo, tools = []) {
    if (!this.options.enablePersistence) {
      return;
    }

    // Update server information
    this.persistentRegistry.servers.set(serverName, {
      name: serverName,
      serverInfo,
      registeredAt: new Date().toISOString(),
      lastUpdate: new Date().toISOString()
    });

    // Update tools
    for (const tool of tools) {
      const toolKey = `${serverName}.${tool.name}`;
      this.persistentRegistry.tools.set(toolKey, {
        ...tool,
        serverName,
        toolKey,
        registeredAt: new Date().toISOString()
      });
    }

    this.persistentRegistry.lastUpdate = new Date().toISOString();
    
    // Save to disk
    await this.savePersistentRegistry();

    logger.debug('Persistent registry updated', {
      serverName,
      toolCount: tools.length,
      totalTools: this.persistentRegistry.tools.size,
      totalServers: this.persistentRegistry.servers.size
    });
  }

  /**
   * Update persistent registry with all currently connected server tools
   */
  async updateAllServersInRegistry() {
    if (!this.options.enablePersistence) {
      return;
    }

    for (const [serverName, state] of this.serverStates) {
      if (state.status === 'connected') {
        try {
          const connection = this.mcpHub.connections.get(serverName);
          if (connection && connection.capabilities) {
            const tools = connection.capabilities.tools || [];
            
            // Update server entry
            this.persistentRegistry.servers.set(serverName, {
              name: serverName,
              config: state.config,
              lastUpdate: new Date().toISOString(),
              toolCount: tools.length,
              status: state.status
            });
            
            // Update tool entries
            for (const tool of tools) {
              const toolId = `${serverName}:${tool.name}`;
              this.persistentRegistry.tools.set(toolId, {
                id: toolId,
                name: tool.name,
                serverName: serverName,
                description: tool.description,
                inputSchema: tool.inputSchema,
                lastUpdate: new Date().toISOString()
              });
            }
          }
        } catch (error) {
          logger.warn(`Failed to update registry for server '${serverName}': ${error.message}`);
        }
      }
    }

    await this.savePersistentRegistry();
  }

  /**
   * Get current system status
   */
  getStatus() {
    const now = new Date();
    const timeSinceLastActivity = now - this.lastActivity;
    const uptime = now - this.startTime;

    const statusByState = {};
    for (const [name, state] of this.serverStates) {
      statusByState[state.status] = (statusByState[state.status] || 0) + 1;
    }

    return {
      uptime,
      lastActivity: this.lastActivity,
      timeSinceLastActivity,
      activityCounter: this.activityCounter,
      batchLoadingActive: this.batchLoadingActive,
      loadingQueueLength: this.loadingQueue.length,
      statusBreakdown: statusByState,
      coreServersLoaded: this.options.coreServers.filter(name => {
        const state = this.serverStates.get(name);
        return state && state.status === 'connected';
      }).length,
      persistentRegistry: {
        enabled: this.options.enablePersistence,
        toolCount: this.persistentRegistry.tools.size,
        serverCount: this.persistentRegistry.servers.size,
        lastUpdate: this.persistentRegistry.lastUpdate
      }
    };
  }

  /**
   * Manually trigger server loading
   */
  async triggerServerLoad(serverName) {
    this.recordActivity('manual_load', { serverName });
    
    if (!this.serverStates.has(serverName)) {
      throw new Error(`Server '${serverName}' not found`);
    }

    // Remove from loading queue if present
    const queueIndex = this.loadingQueue.indexOf(serverName);
    if (queueIndex !== -1) {
      this.loadingQueue.splice(queueIndex, 1);
    }

    await this.loadServer(serverName);
  }

  /**
   * Clean shutdown
   */
  async shutdown() {
    logger.info('Shutting down ServerLoadingManager');
    
    // Clear all timers
    if (this.systemIdleTimer) {
      clearInterval(this.systemIdleTimer);
    }
    
    for (const timerId of this.serverTimeouts.values()) {
      clearTimeout(timerId);
    }
    
    // Save final registry state
    if (this.options.enablePersistence) {
      await this.updateAllServersInRegistry();
    }
    
    this.emit('shutdown');
  }
}

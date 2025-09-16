/**
 * Docker Integration for MCPHub
 * 
 * This module integrates Docker-based MCP servers with the MCPHub,
 * allowing dynamic container management and on-demand server provisioning.
 */

import { EventEmitter } from 'events';
import { DockerServerManager } from './docker-server-manager.js';
import logger from '../utils/logger.js';
import { wrapError } from '../utils/errors.js';

/**
 * Server deployment strategies
 */
export const DeploymentStrategy = {
  ON_DEMAND: 'on-demand',       // Start containers when needed
  PRE_WARMED: 'pre-warmed',      // Keep containers warm
  ALWAYS_ON: 'always-on',        // Keep containers always running
  SCHEDULED: 'scheduled'         // Start/stop based on schedule
};

/**
 * Docker Integration for MCPHub
 */
export class DockerIntegration extends EventEmitter {
  constructor(mcpHub, config = {}) {
    super();
    
    this.mcpHub = mcpHub;
    this.config = {
      enabled: config.enabled !== false,
      strategy: config.strategy || DeploymentStrategy.ON_DEMAND,
      dockerConfig: config.dockerConfig || {},
      serverConfigs: config.serverConfigs || {},
      autoDiscovery: config.autoDiscovery !== false,
      maxContainers: config.maxContainers || 50,
      ...config
    };
    
    // Docker manager instance
    this.dockerManager = null;
    
    // Server configuration registry
    this.serverRegistry = new Map();
    
    // Container state tracking
    this.containerStates = new Map();
    
    // Connection mapping
    this.containerConnections = new Map();
    
    // Initialize default configurations
    this.initializeServerRegistry();
  }
  
  /**
   * Initialize Docker integration
   */
  async initialize() {
    if (!this.config.enabled) {
      logger.info('Docker integration is disabled');
      return false;
    }
    
    try {
      logger.info('Initializing Docker integration for MCPHub');
      
      // Create Docker manager
      this.dockerManager = new DockerServerManager({
        ...this.config.dockerConfig,
        imageMap: this.getImageMap()
      });
      
      // Initialize Docker manager
      await this.dockerManager.initialize();
      
      // Setup event handlers
      this.setupEventHandlers();
      
      // Discover existing containers
      await this.discoverContainers();
      
      // Pre-warm containers if configured
      if (this.config.strategy === DeploymentStrategy.PRE_WARMED) {
        await this.preWarmContainers();
      }
      
      // Start always-on containers
      if (this.config.strategy === DeploymentStrategy.ALWAYS_ON) {
        await this.startAlwaysOnContainers();
      }
      
      logger.info('Docker integration initialized successfully', {
        strategy: this.config.strategy,
        containers: this.containerStates.size
      });
      
      return true;
      
    } catch (error) {
      const wrappedError = wrapError(error, 'DOCKER_INTEGRATION_ERROR');
      logger.error('Failed to initialize Docker integration', wrappedError);
      
      // Disable Docker integration on failure
      this.config.enabled = false;
      return false;
    }
  }
  
  /**
   * Initialize server registry with default configurations
   */
  initializeServerRegistry() {
    // Default server configurations
    const defaultServers = {
      'filesystem': {
        image: 'mcp-servers/filesystem',
        strategy: DeploymentStrategy.ON_DEMAND,
        volumes: {
          './workspace': '/data'
        },
        environment: {
          MCP_ALLOWED_PATHS: '/data'
        }
      },
      'github': {
        image: 'mcp-servers/github',
        strategy: DeploymentStrategy.ON_DEMAND,
        environment: {
          GITHUB_TOKEN: process.env.GITHUB_TOKEN
        },
        requiresAuth: true
      },
      'mcp-postgres': {
        image: 'mcp-servers/postgres',
        strategy: DeploymentStrategy.ON_DEMAND,
        environment: {
          POSTGRES_CONNECTION_URL: process.env.POSTGRES_CONNECTION_URL
        }
      },
      'mcp-sqlite': {
        image: 'mcp-servers/sqlite',
        strategy: DeploymentStrategy.ON_DEMAND,
        volumes: {
          './data/sqlite': '/data'
        }
      },
      'mcp-time': {
        image: 'mcp-servers/time',
        strategy: DeploymentStrategy.PRE_WARMED,
        lightweight: true
      },
      'mcp-memory': {
        image: 'mcp-servers/memory',
        strategy: DeploymentStrategy.ALWAYS_ON,
        lightweight: true,
        resourceLimits: {
          memory: '256m',
          cpus: '0.25'
        }
      },
      'mcp-fetch': {
        image: 'mcp-servers/fetch',
        strategy: DeploymentStrategy.ON_DEMAND,
        networkMode: 'bridge'
      },
      'mcp-puppeteer': {
        image: 'mcp-servers/puppeteer',
        strategy: DeploymentStrategy.ON_DEMAND,
        resourceLimits: {
          memory: '1g',
          cpus: '1'
        },
        securityOpt: ['no-new-privileges:true'],
        capabilities: {
          drop: ['ALL'],
          add: ['SYS_ADMIN'] // Required for Chrome sandbox
        }
      }
    };
    
    // Merge with custom configurations
    for (const [serverName, config] of Object.entries(defaultServers)) {
      const customConfig = this.config.serverConfigs[serverName] || {};
      this.serverRegistry.set(serverName, {
        ...config,
        ...customConfig
      });
    }
    
    // Add custom server configurations
    for (const [serverName, config] of Object.entries(this.config.serverConfigs)) {
      if (!this.serverRegistry.has(serverName)) {
        this.serverRegistry.set(serverName, config);
      }
    }
  }
  
  /**
   * Get image map for Docker manager
   */
  getImageMap() {
    const imageMap = {};
    
    for (const [serverName, config] of this.serverRegistry) {
      if (config.image) {
        imageMap[serverName] = config.image;
      }
    }
    
    return imageMap;
  }
  
  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    // Docker manager events
    this.dockerManager.on('server:started', (data) => {
      this.handleContainerStarted(data);
    });
    
    this.dockerManager.on('server:stopped', (data) => {
      this.handleContainerStopped(data);
    });
    
    this.dockerManager.on('server:error', (data) => {
      this.handleContainerError(data);
    });
    
    // MCPHub events
    this.mcpHub.on('server:connecting', async (data) => {
      await this.handleServerConnecting(data);
    });
    
    this.mcpHub.on('server:disconnected', async (data) => {
      await this.handleServerDisconnected(data);
    });
  }
  
  /**
   * Discover existing containers
   */
  async discoverContainers() {
    const containers = await this.dockerManager.listServers();
    
    for (const container of containers) {
      this.containerStates.set(container.name, {
        container: container.container,
        state: container.running ? 'running' : 'stopped',
        health: container.health,
        created: container.created
      });
      
      logger.debug('Discovered container', {
        server: container.name,
        state: container.state
      });
    }
  }
  
  /**
   * Pre-warm containers for quick startup
   */
  async preWarmContainers() {
    logger.info('Pre-warming containers');
    
    const preWarmServers = [];
    
    for (const [serverName, config] of this.serverRegistry) {
      if (config.strategy === DeploymentStrategy.PRE_WARMED) {
        preWarmServers.push(serverName);
      }
    }
    
    // Start pre-warm servers in parallel
    const results = await Promise.allSettled(
      preWarmServers.map(serverName => this.startContainer(serverName))
    );
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    logger.info('Pre-warm containers started', {
      successful,
      failed,
      total: preWarmServers.length
    });
  }
  
  /**
   * Start always-on containers
   */
  async startAlwaysOnContainers() {
    logger.info('Starting always-on containers');
    
    const alwaysOnServers = [];
    
    for (const [serverName, config] of this.serverRegistry) {
      if (config.strategy === DeploymentStrategy.ALWAYS_ON) {
        alwaysOnServers.push(serverName);
      }
    }
    
    // Start always-on servers
    for (const serverName of alwaysOnServers) {
      try {
        await this.startContainer(serverName);
        
        // Connect to MCPHub
        await this.connectContainerToHub(serverName);
        
      } catch (error) {
        logger.error('Failed to start always-on container', {
          server: serverName,
          error: error.message
        });
      }
    }
  }
  
  /**
   * Start container for MCP server
   */
  async startContainer(serverName) {
    const config = this.serverRegistry.get(serverName);
    
    if (!config) {
      throw new Error(`No configuration found for server: ${serverName}`);
    }
    
    logger.info('Starting container for MCP server', { server: serverName });
    
    // Check container limit
    if (this.containerStates.size >= this.config.maxContainers) {
      throw new Error(`Container limit reached: ${this.config.maxContainers}`);
    }
    
    // Start container with configuration
    const endpoint = await this.dockerManager.startServer(serverName, {
      imageTag: config.imageTag || 'latest',
      environment: config.environment,
      volumes: config.volumes,
      command: config.command,
      exposePort: config.exposePort,
      resourceLimits: config.resourceLimits,
      securityOpt: config.securityOpt,
      capabilities: config.capabilities
    });
    
    // Update state
    this.containerStates.set(serverName, {
      state: 'running',
      endpoint,
      startedAt: new Date()
    });
    
    logger.info('Container started successfully', {
      server: serverName,
      endpoint
    });
    
    return endpoint;
  }
  
  /**
   * Stop container for MCP server
   */
  async stopContainer(serverName, remove = false) {
    logger.info('Stopping container for MCP server', {
      server: serverName,
      remove
    });
    
    await this.dockerManager.stopServer(serverName, remove);
    
    // Update state
    if (remove) {
      this.containerStates.delete(serverName);
    } else {
      const state = this.containerStates.get(serverName);
      if (state) {
        state.state = 'stopped';
        state.stoppedAt = new Date();
      }
    }
  }
  
  /**
   * Connect container to MCPHub
   */
  async connectContainerToHub(serverName) {
    const state = this.containerStates.get(serverName);
    
    if (!state || state.state !== 'running') {
      throw new Error(`Container not running for server: ${serverName}`);
    }
    
    logger.info('Connecting container to MCPHub', {
      server: serverName,
      endpoint: state.endpoint
    });
    
    // Update MCPHub configuration with container endpoint
    const originalConfig = this.mcpHub.config[serverName];
    
    this.mcpHub.config[serverName] = {
      ...originalConfig,
      transport: {
        type: 'http',
        url: state.endpoint
      },
      dockerManaged: true
    };
    
    // Connect to server
    await this.mcpHub.connectServer(serverName);
    
    // Track connection
    this.containerConnections.set(serverName, {
      connectedAt: new Date(),
      endpoint: state.endpoint
    });
  }
  
  /**
   * Handle server connecting event
   */
  async handleServerConnecting(data) {
    const { serverName } = data;
    
    // Check if this is a Docker-managed server
    if (!this.serverRegistry.has(serverName)) {
      return;
    }
    
    const config = this.serverRegistry.get(serverName);
    const state = this.containerStates.get(serverName);
    
    // Start container if needed
    if (!state || state.state !== 'running') {
      if (config.strategy === DeploymentStrategy.ON_DEMAND) {
        try {
          logger.info('Starting on-demand container', { server: serverName });
          
          const endpoint = await this.startContainer(serverName);
          
          // Update MCPHub configuration
          this.mcpHub.config[serverName] = {
            ...this.mcpHub.config[serverName],
            transport: {
              type: 'http',
              url: endpoint
            },
            dockerManaged: true
          };
          
        } catch (error) {
          logger.error('Failed to start on-demand container', {
            server: serverName,
            error: error.message
          });
          throw error;
        }
      }
    }
  }
  
  /**
   * Handle server disconnected event
   */
  async handleServerDisconnected(data) {
    const { serverName } = data;
    
    // Check if this is a Docker-managed server
    if (!this.serverRegistry.has(serverName)) {
      return;
    }
    
    const config = this.serverRegistry.get(serverName);
    
    // Stop on-demand containers after disconnect
    if (config.strategy === DeploymentStrategy.ON_DEMAND) {
      // Add delay to prevent rapid start/stop cycles
      setTimeout(async () => {
        const connection = this.mcpHub.connections.get(serverName);
        
        if (!connection || connection.state !== 'connected') {
          logger.info('Stopping on-demand container after disconnect', {
            server: serverName
          });
          
          try {
            await this.stopContainer(serverName, false);
          } catch (error) {
            logger.warn('Failed to stop container', {
              server: serverName,
              error: error.message
            });
          }
        }
      }, 60000); // Wait 1 minute before stopping
    }
    
    // Remove connection tracking
    this.containerConnections.delete(serverName);
  }
  
  /**
   * Handle container started event
   */
  handleContainerStarted(data) {
    const { server, container, endpoint } = data;
    
    this.containerStates.set(server, {
      container,
      endpoint,
      state: 'running',
      startedAt: new Date()
    });
    
    this.emit('container:started', { server, endpoint });
  }
  
  /**
   * Handle container stopped event
   */
  handleContainerStopped(data) {
    const { server } = data;
    
    const state = this.containerStates.get(server);
    if (state) {
      state.state = 'stopped';
      state.stoppedAt = new Date();
    }
    
    this.emit('container:stopped', { server });
  }
  
  /**
   * Handle container error event
   */
  handleContainerError(data) {
    const { server, error } = data;
    
    logger.error('Container error', { server, error });
    
    const state = this.containerStates.get(server);
    if (state) {
      state.state = 'error';
      state.error = error;
    }
    
    this.emit('container:error', { server, error });
  }
  
  /**
   * Get container status for a server
   */
  getContainerStatus(serverName) {
    const state = this.containerStates.get(serverName);
    const config = this.serverRegistry.get(serverName);
    const connection = this.containerConnections.get(serverName);
    
    return {
      configured: !!config,
      containerState: state?.state || 'not-created',
      endpoint: state?.endpoint,
      connected: !!connection,
      strategy: config?.strategy,
      startedAt: state?.startedAt,
      stoppedAt: state?.stoppedAt,
      error: state?.error
    };
  }
  
  /**
   * Get all container statuses
   */
  getAllContainerStatuses() {
    const statuses = {};
    
    for (const [serverName] of this.serverRegistry) {
      statuses[serverName] = this.getContainerStatus(serverName);
    }
    
    return statuses;
  }
  
  /**
   * Pull latest images for all configured servers
   */
  async pullAllImages() {
    logger.info('Pulling latest images for all configured servers');
    
    const results = {
      successful: [],
      failed: []
    };
    
    for (const [serverName, config] of this.serverRegistry) {
      try {
        await this.dockerManager.pullServerImage(
          serverName,
          config.imageTag || 'latest'
        );
        results.successful.push(serverName);
      } catch (error) {
        results.failed.push({
          server: serverName,
          error: error.message
        });
      }
    }
    
    logger.info('Image pull completed', results);
    return results;
  }
  
  /**
   * Clean up stopped containers
   */
  async cleanupContainers() {
    logger.info('Cleaning up stopped containers');
    
    await this.dockerManager.cleanupContainers();
    
    // Update states
    for (const [serverName, state] of this.containerStates) {
      if (state.state === 'stopped') {
        const container = await this.dockerManager.containers.get(serverName);
        if (!container) {
          this.containerStates.delete(serverName);
        }
      }
    }
  }
  
  /**
   * Shutdown Docker integration
   */
  async shutdown() {
    logger.info('Shutting down Docker integration');
    
    // Disconnect all containers from hub
    for (const [serverName] of this.containerConnections) {
      try {
        await this.mcpHub.disconnectServer(serverName);
      } catch (error) {
        logger.warn('Failed to disconnect server', {
          server: serverName,
          error: error.message
        });
      }
    }
    
    // Shutdown Docker manager
    if (this.dockerManager) {
      await this.dockerManager.shutdown();
    }
    
    logger.info('Docker integration shutdown complete');
  }
}

// Export singleton instance
let dockerIntegrationInstance = null;

export function getDockerIntegration(mcpHub, config) {
  if (!dockerIntegrationInstance) {
    dockerIntegrationInstance = new DockerIntegration(mcpHub, config);
  }
  return dockerIntegrationInstance;
}

export default DockerIntegration;

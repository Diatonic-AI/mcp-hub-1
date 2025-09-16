/**
 * Docker-based MCP Server Manager
 * 
 * This module manages MCP servers as Docker containers, providing:
 * - On-demand container pulling from Docker Hub
 * - Dynamic container lifecycle management
 * - Network isolation and security
 * - Resource limits and monitoring
 * - Automatic cleanup and recovery
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import logger from '../utils/logger.js';
import { wrapError } from '../utils/errors.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

/**
 * Docker network modes for MCP servers
 */
export const NetworkMode = {
  BRIDGE: 'bridge',      // Default Docker network
  HOST: 'host',          // Host network (less secure)
  CUSTOM: 'mcp-hub',     // Custom network for MCP Hub
  ISOLATED: 'none'       // No network (for testing)
};

/**
 * Container states
 */
export const ContainerState = {
  PULLING: 'pulling',
  CREATING: 'creating',
  RUNNING: 'running',
  PAUSED: 'paused',
  STOPPED: 'stopped',
  REMOVING: 'removing',
  ERROR: 'error'
};

/**
 * Docker-based MCP Server Manager
 */
export class DockerServerManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      dockerSocket: config.dockerSocket || '/var/run/docker.sock',
      registryUrl: config.registryUrl || 'docker.io',
      namespace: config.namespace || 'mcp-servers',
      networkMode: config.networkMode || NetworkMode.CUSTOM,
      autoCleanup: config.autoCleanup !== false,
      resourceLimits: {
        memory: config.memory || '512m',
        cpus: config.cpus || '0.5',
        ...config.resourceLimits
      },
      labels: {
        'mcp-hub.managed': 'true',
        'mcp-hub.version': '4.2.1',
        ...config.labels
      },
      volumes: config.volumes || {},
      environment: config.environment || {},
      ...config
    };
    
    // Container registry
    this.containers = new Map();
    this.images = new Map();
    
    // Docker command executor
    this.dockerCommand = config.dockerCommand || 'docker';
    
    // Network management
    this.networkCreated = false;
    
    // Cleanup interval
    this.cleanupInterval = null;
  }
  
  /**
   * Initialize Docker manager
   */
  async initialize() {
    try {
      logger.info('Initializing Docker Server Manager', {
        network: this.config.networkMode,
        namespace: this.config.namespace
      });
      
      // Check Docker availability
      await this.checkDockerAvailable();
      
      // Create custom network if needed
      if (this.config.networkMode === NetworkMode.CUSTOM) {
        await this.createNetwork();
      }
      
      // Start cleanup interval if enabled
      if (this.config.autoCleanup) {
        this.startCleanupInterval();
      }
      
      // List existing MCP containers
      await this.discoverExistingContainers();
      
      logger.info('Docker Server Manager initialized successfully', {
        containersFound: this.containers.size
      });
      
      return true;
      
    } catch (error) {
      const wrappedError = wrapError(error, 'DOCKER_INIT_ERROR');
      logger.error('Failed to initialize Docker manager', wrappedError);
      throw wrappedError;
    }
  }
  
  /**
   * Check if Docker is available
   */
  async checkDockerAvailable() {
    try {
      const result = await this.execDocker(['version', '--format', 'json']);
      const version = JSON.parse(result);
      
      logger.info('Docker detected', {
        version: version.Client?.Version,
        apiVersion: version.Client?.ApiVersion
      });
      
      return true;
    } catch (error) {
      throw new Error('Docker is not available. Please install Docker to use containerized MCP servers.');
    }
  }
  
  /**
   * Create custom Docker network
   */
  async createNetwork() {
    try {
      // Check if network exists
      try {
        await this.execDocker(['network', 'inspect', this.config.networkMode]);
        logger.info('Docker network already exists', { network: this.config.networkMode });
        this.networkCreated = true;
        return;
      } catch (error) {
        // Network doesn't exist, create it
      }
      
      // Create network
      await this.execDocker([
        'network', 'create',
        '--driver', 'bridge',
        '--label', 'mcp-hub.network=true',
        this.config.networkMode
      ]);
      
      logger.info('Docker network created', { network: this.config.networkMode });
      this.networkCreated = true;
      
    } catch (error) {
      logger.warn('Failed to create Docker network', { error: error.message });
      // Fall back to bridge network
      this.config.networkMode = NetworkMode.BRIDGE;
    }
  }
  
  /**
   * Discover existing MCP containers
   */
  async discoverExistingContainers() {
    try {
      const result = await this.execDocker([
        'ps', '-a',
        '--filter', 'label=mcp-hub.managed=true',
        '--format', 'json'
      ]);
      
      const lines = result.trim().split('\n').filter(line => line);
      
      for (const line of lines) {
        try {
          const container = JSON.parse(line);
          const serverName = container.Labels?.['mcp-hub.server'] || container.Names;
          
          this.containers.set(serverName, {
            id: container.ID,
            name: container.Names,
            image: container.Image,
            state: container.State,
            status: container.Status,
            ports: container.Ports,
            labels: container.Labels,
            created: container.CreatedAt
          });
          
          logger.debug('Discovered existing container', {
            server: serverName,
            state: container.State
          });
          
        } catch (error) {
          logger.warn('Failed to parse container info', { error: error.message });
        }
      }
      
    } catch (error) {
      logger.warn('Failed to discover existing containers', { error: error.message });
    }
  }
  
  /**
   * Pull or update Docker image for MCP server
   */
  async pullServerImage(serverName, imageTag = 'latest') {
    const imageName = this.getImageName(serverName, imageTag);
    
    logger.info('Pulling Docker image for MCP server', {
      server: serverName,
      image: imageName
    });
    
    this.emit('image:pulling', { server: serverName, image: imageName });
    
    try {
      // Check if image exists locally
      try {
        await this.execDocker(['image', 'inspect', imageName]);
        logger.info('Docker image already exists locally', { image: imageName });
        
        // Optionally pull latest updates
        if (this.config.alwaysPull) {
          await this.execDocker(['pull', imageName]);
          logger.info('Docker image updated', { image: imageName });
        }
        
      } catch (error) {
        // Image doesn't exist, pull it
        await this.execDocker(['pull', imageName], {
          onOutput: (data) => {
            this.emit('image:pull:progress', {
              server: serverName,
              progress: data.toString()
            });
          }
        });
        
        logger.info('Docker image pulled successfully', { image: imageName });
      }
      
      // Store image info
      const imageInfo = await this.inspectImage(imageName);
      this.images.set(serverName, imageInfo);
      
      this.emit('image:ready', { server: serverName, image: imageName });
      return imageInfo;
      
    } catch (error) {
      this.emit('image:error', { server: serverName, error: error.message });
      throw wrapError(error, 'DOCKER_PULL_ERROR', { server: serverName });
    }
  }
  
  /**
   * Start MCP server container
   */
  async startServer(serverName, config = {}) {
    try {
      logger.info('Starting MCP server container', { server: serverName });
      
      // Check if container already exists
      let container = this.containers.get(serverName);
      
      if (container) {
        // Container exists, check state
        const info = await this.inspectContainer(container.id);
        
        if (info.State.Running) {
          logger.info('Container already running', { server: serverName });
          return this.getContainerEndpoint(serverName);
        }
        
        // Start stopped container
        await this.execDocker(['start', container.id]);
        logger.info('Container started', { server: serverName });
        
      } else {
        // Pull image if needed
        if (!this.images.has(serverName)) {
          await this.pullServerImage(serverName, config.imageTag);
        }
        
        // Create and start new container
        container = await this.createContainer(serverName, config);
        this.containers.set(serverName, container);
      }
      
      // Wait for container to be ready
      await this.waitForContainer(serverName);
      
      // Get container endpoint
      const endpoint = await this.getContainerEndpoint(serverName);
      
      this.emit('server:started', {
        server: serverName,
        container: container.id,
        endpoint
      });
      
      return endpoint;
      
    } catch (error) {
      this.emit('server:error', { server: serverName, error: error.message });
      throw wrapError(error, 'DOCKER_START_ERROR', { server: serverName });
    }
  }
  
  /**
   * Create new container for MCP server
   */
  async createContainer(serverName, config = {}) {
    const imageName = this.getImageName(serverName, config.imageTag);
    const containerName = this.getContainerName(serverName);
    
    // Build docker run command
    const dockerArgs = [
      'run', '-d',
      '--name', containerName,
      '--network', this.config.networkMode,
      '--restart', 'unless-stopped'
    ];
    
    // Add resource limits
    if (this.config.resourceLimits.memory) {
      dockerArgs.push('--memory', this.config.resourceLimits.memory);
    }
    if (this.config.resourceLimits.cpus) {
      dockerArgs.push('--cpus', this.config.resourceLimits.cpus);
    }
    
    // Add labels
    dockerArgs.push('--label', `mcp-hub.server=${serverName}`);
    for (const [key, value] of Object.entries(this.config.labels)) {
      dockerArgs.push('--label', `${key}=${value}`);
    }
    
    // Add environment variables
    const env = {
      ...this.config.environment,
      ...config.environment,
      MCP_SERVER_NAME: serverName,
      MCP_HUB_URL: process.env.MCP_HUB_URL || 'http://mcp-hub:3456'
    };
    
    for (const [key, value] of Object.entries(env)) {
      dockerArgs.push('-e', `${key}=${value}`);
    }
    
    // Add volumes
    const volumes = {
      ...this.config.volumes,
      ...config.volumes
    };
    
    for (const [host, container] of Object.entries(volumes)) {
      dockerArgs.push('-v', `${host}:${container}`);
    }
    
    // Add port mapping if needed
    if (config.exposePort) {
      const hostPort = await this.findAvailablePort();
      dockerArgs.push('-p', `${hostPort}:8080`);
    }
    
    // Add image name
    dockerArgs.push(imageName);
    
    // Add command arguments if provided
    if (config.command) {
      dockerArgs.push(...config.command);
    }
    
    // Create container
    const containerId = await this.execDocker(dockerArgs);
    
    logger.info('Container created', {
      server: serverName,
      container: containerId.trim(),
      name: containerName
    });
    
    return {
      id: containerId.trim(),
      name: containerName,
      image: imageName,
      state: ContainerState.RUNNING,
      created: new Date()
    };
  }
  
  /**
   * Stop MCP server container
   */
  async stopServer(serverName, remove = false) {
    try {
      const container = this.containers.get(serverName);
      
      if (!container) {
        logger.warn('Container not found', { server: serverName });
        return;
      }
      
      logger.info('Stopping MCP server container', {
        server: serverName,
        container: container.id
      });
      
      // Stop container
      await this.execDocker(['stop', container.id]);
      
      if (remove) {
        // Remove container
        await this.execDocker(['rm', container.id]);
        this.containers.delete(serverName);
        
        logger.info('Container removed', { server: serverName });
      } else {
        // Update state
        container.state = ContainerState.STOPPED;
        logger.info('Container stopped', { server: serverName });
      }
      
      this.emit('server:stopped', { server: serverName });
      
    } catch (error) {
      this.emit('server:error', { server: serverName, error: error.message });
      throw wrapError(error, 'DOCKER_STOP_ERROR', { server: serverName });
    }
  }
  
  /**
   * Restart MCP server container
   */
  async restartServer(serverName) {
    await this.stopServer(serverName, false);
    await this.startServer(serverName);
  }
  
  /**
   * Get container endpoint for MCP server
   */
  async getContainerEndpoint(serverName) {
    const container = this.containers.get(serverName);
    
    if (!container) {
      throw new Error(`Container not found for server: ${serverName}`);
    }
    
    // Inspect container for network details
    const info = await this.inspectContainer(container.id);
    
    // Get IP address based on network mode
    let hostname, port = 8080;
    
    if (this.config.networkMode === NetworkMode.HOST) {
      hostname = 'localhost';
    } else if (this.config.networkMode === NetworkMode.CUSTOM) {
      // Use container name as hostname in custom network
      hostname = container.name;
    } else {
      // Get container IP from bridge network
      hostname = info.NetworkSettings?.IPAddress || 'localhost';
    }
    
    // Check for exposed ports
    if (info.NetworkSettings?.Ports?.['8080/tcp']) {
      const portMapping = info.NetworkSettings.Ports['8080/tcp'][0];
      if (portMapping) {
        hostname = portMapping.HostIp === '0.0.0.0' ? 'localhost' : portMapping.HostIp;
        port = portMapping.HostPort;
      }
    }
    
    return `http://${hostname}:${port}/mcp`;
  }
  
  /**
   * Wait for container to be ready
   */
  async waitForContainer(serverName, timeout = 30000) {
    const container = this.containers.get(serverName);
    if (!container) {
      throw new Error(`Container not found for server: ${serverName}`);
    }
    
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const info = await this.inspectContainer(container.id);
        
        if (info.State.Running) {
          // Check if container is healthy (if health check is defined)
          if (info.State.Health) {
            if (info.State.Health.Status === 'healthy') {
              return true;
            }
          } else {
            // No health check, assume ready after running
            await new Promise(resolve => setTimeout(resolve, 1000));
            return true;
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        logger.debug('Waiting for container', { server: serverName });
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    throw new Error(`Container failed to start within ${timeout}ms: ${serverName}`);
  }
  
  /**
   * Inspect container details
   */
  async inspectContainer(containerId) {
    const result = await this.execDocker(['inspect', containerId]);
    return JSON.parse(result)[0];
  }
  
  /**
   * Inspect image details
   */
  async inspectImage(imageName) {
    const result = await this.execDocker(['image', 'inspect', imageName]);
    return JSON.parse(result)[0];
  }
  
  /**
   * Get container logs
   */
  async getServerLogs(serverName, lines = 100) {
    const container = this.containers.get(serverName);
    
    if (!container) {
      throw new Error(`Container not found for server: ${serverName}`);
    }
    
    const logs = await this.execDocker([
      'logs',
      '--tail', lines.toString(),
      container.id
    ]);
    
    return logs;
  }
  
  /**
   * Get container stats
   */
  async getServerStats(serverName) {
    const container = this.containers.get(serverName);
    
    if (!container) {
      throw new Error(`Container not found for server: ${serverName}`);
    }
    
    const stats = await this.execDocker([
      'stats',
      '--no-stream',
      '--format', 'json',
      container.id
    ]);
    
    return JSON.parse(stats);
  }
  
  /**
   * List all MCP server containers
   */
  async listServers() {
    const servers = [];
    
    for (const [serverName, container] of this.containers) {
      try {
        const info = await this.inspectContainer(container.id);
        
        servers.push({
          name: serverName,
          container: container.id,
          image: container.image,
          state: info.State.Status,
          running: info.State.Running,
          created: info.Created,
          started: info.State.StartedAt,
          health: info.State.Health?.Status
        });
        
      } catch (error) {
        logger.warn('Failed to inspect container', {
          server: serverName,
          error: error.message
        });
      }
    }
    
    return servers;
  }
  
  /**
   * Clean up stopped containers
   */
  async cleanupContainers() {
    logger.debug('Running container cleanup');
    
    const stoppedContainers = [];
    
    for (const [serverName, container] of this.containers) {
      try {
        const info = await this.inspectContainer(container.id);
        
        if (!info.State.Running && info.State.Status === 'exited') {
          const exitedAt = new Date(info.State.FinishedAt);
          const ageMs = Date.now() - exitedAt.getTime();
          
          // Remove containers stopped for more than 1 hour
          if (ageMs > 3600000) {
            stoppedContainers.push(serverName);
          }
        }
      } catch (error) {
        // Container might not exist anymore
        this.containers.delete(serverName);
      }
    }
    
    // Remove old containers
    for (const serverName of stoppedContainers) {
      try {
        await this.stopServer(serverName, true);
        logger.info('Cleaned up old container', { server: serverName });
      } catch (error) {
        logger.warn('Failed to cleanup container', {
          server: serverName,
          error: error.message
        });
      }
    }
    
    if (stoppedContainers.length > 0) {
      logger.info('Container cleanup completed', {
        removed: stoppedContainers.length
      });
    }
  }
  
  /**
   * Start cleanup interval
   */
  startCleanupInterval() {
    // Run cleanup every 30 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupContainers().catch(error => {
        logger.error('Container cleanup failed', { error: error.message });
      });
    }, 1800000);
  }
  
  /**
   * Find available port
   */
  async findAvailablePort(startPort = 9000) {
    const net = await import('net');
    
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.listen(startPort, () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
      
      server.on('error', () => {
        resolve(this.findAvailablePort(startPort + 1));
      });
    });
  }
  
  /**
   * Get image name for MCP server
   */
  getImageName(serverName, tag = 'latest') {
    // Map server names to Docker images
    const imageMap = {
      'filesystem': 'mcp-servers/filesystem',
      'github': 'mcp-servers/github',
      'mcp-fetch': 'mcp-servers/fetch',
      'mcp-postgres': 'mcp-servers/postgres',
      'mcp-sqlite': 'mcp-servers/sqlite',
      'mcp-time': 'mcp-servers/time',
      'mcp-memory': 'mcp-servers/memory',
      // Add more mappings as needed
      ...this.config.imageMap
    };
    
    const imageName = imageMap[serverName] || `${this.config.namespace}/${serverName}`;
    
    return `${this.config.registryUrl}/${imageName}:${tag}`;
  }
  
  /**
   * Get container name for MCP server
   */
  getContainerName(serverName) {
    return `mcp-hub-${serverName}-${crypto.randomBytes(4).toString('hex')}`;
  }
  
  /**
   * Execute Docker command
   */
  async execDocker(args, options = {}) {
    return new Promise((resolve, reject) => {
      const docker = spawn(this.dockerCommand, args);
      
      let stdout = '';
      let stderr = '';
      
      docker.stdout.on('data', (data) => {
        stdout += data.toString();
        if (options.onOutput) {
          options.onOutput(data);
        }
      });
      
      docker.stderr.on('data', (data) => {
        stderr += data.toString();
        if (options.onError) {
          options.onError(data);
        }
      });
      
      docker.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(stderr || `Docker command failed with code ${code}`));
        }
      });
      
      docker.on('error', (error) => {
        reject(error);
      });
    });
  }
  
  /**
   * Shutdown Docker manager
   */
  async shutdown() {
    logger.info('Shutting down Docker Server Manager');
    
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // Optionally stop all containers
    if (this.config.stopOnShutdown) {
      for (const [serverName] of this.containers) {
        try {
          await this.stopServer(serverName, this.config.removeOnShutdown);
        } catch (error) {
          logger.warn('Failed to stop container on shutdown', {
            server: serverName,
            error: error.message
          });
        }
      }
    }
    
    // Remove custom network if created
    if (this.networkCreated && this.config.removeNetworkOnShutdown) {
      try {
        await this.execDocker(['network', 'rm', this.config.networkMode]);
        logger.info('Docker network removed', { network: this.config.networkMode });
      } catch (error) {
        logger.warn('Failed to remove Docker network', { error: error.message });
      }
    }
    
    logger.info('Docker Server Manager shutdown complete');
  }
}

// Export singleton instance
let dockerManagerInstance = null;

export function getDockerManager(config) {
  if (!dockerManagerInstance) {
    dockerManagerInstance = new DockerServerManager(config);
  }
  return dockerManagerInstance;
}

export default DockerServerManager;

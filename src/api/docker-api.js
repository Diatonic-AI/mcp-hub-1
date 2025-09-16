/**
 * Docker REST API endpoints for MCPHub
 * 
 * Provides HTTP endpoints for managing Docker containers for MCP servers
 */

import { Router } from 'express';
import logger from '../utils/logger.js';

/**
 * Create Docker API router
 */
export function createDockerRouter(mcpHub) {
  const router = Router();
  
  // Middleware to check if Docker integration is enabled
  const requireDocker = (req, res, next) => {
    if (!mcpHub.dockerIntegration || !mcpHub.dockerIntegration.config.enabled) {
      return res.status(503).json({
        error: 'Docker integration is not enabled',
        code: 'DOCKER_DISABLED'
      });
    }
    next();
  };
  
  /**
   * GET /api/docker/status
   * Get Docker integration status
   */
  router.get('/status', requireDocker, async (req, res) => {
    try {
      const status = {
        enabled: mcpHub.dockerIntegration.config.enabled,
        strategy: mcpHub.dockerIntegration.config.strategy,
        maxContainers: mcpHub.dockerIntegration.config.maxContainers,
        containerCount: mcpHub.dockerIntegration.containerStates.size,
        connectionCount: mcpHub.dockerIntegration.containerConnections.size
      };
      
      res.json(status);
      
    } catch (error) {
      logger.error('Failed to get Docker status', { error: error.message });
      res.status(500).json({
        error: 'Failed to get Docker status',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/docker/containers
   * List all Docker containers
   */
  router.get('/containers', requireDocker, async (req, res) => {
    try {
      const containers = mcpHub.dockerIntegration.getAllContainerStatuses();
      
      res.json({
        containers,
        count: Object.keys(containers).length
      });
      
    } catch (error) {
      logger.error('Failed to list containers', { error: error.message });
      res.status(500).json({
        error: 'Failed to list containers',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/docker/containers/:serverName
   * Get container status for specific server
   */
  router.get('/containers/:serverName', requireDocker, async (req, res) => {
    try {
      const { serverName } = req.params;
      const status = mcpHub.dockerIntegration.getContainerStatus(serverName);
      
      if (!status.configured) {
        return res.status(404).json({
          error: 'Server not configured for Docker',
          server: serverName
        });
      }
      
      res.json({
        server: serverName,
        ...status
      });
      
    } catch (error) {
      logger.error('Failed to get container status', { 
        server: req.params.serverName,
        error: error.message 
      });
      res.status(500).json({
        error: 'Failed to get container status',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/docker/containers/:serverName/start
   * Start container for server
   */
  router.post('/containers/:serverName/start', requireDocker, async (req, res) => {
    try {
      const { serverName } = req.params;
      const { connect = false } = req.body;
      
      // Check if server is configured
      const status = mcpHub.dockerIntegration.getContainerStatus(serverName);
      if (!status.configured) {
        return res.status(404).json({
          error: 'Server not configured for Docker',
          server: serverName
        });
      }
      
      // Start container
      const endpoint = await mcpHub.dockerIntegration.startContainer(serverName);
      
      // Optionally connect to hub
      if (connect) {
        await mcpHub.dockerIntegration.connectContainerToHub(serverName);
      }
      
      res.json({
        success: true,
        server: serverName,
        endpoint,
        connected: connect
      });
      
    } catch (error) {
      logger.error('Failed to start container', { 
        server: req.params.serverName,
        error: error.message 
      });
      res.status(500).json({
        error: 'Failed to start container',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/docker/containers/:serverName/stop
   * Stop container for server
   */
  router.post('/containers/:serverName/stop', requireDocker, async (req, res) => {
    try {
      const { serverName } = req.params;
      const { remove = false } = req.body;
      
      // Check if container exists
      const status = mcpHub.dockerIntegration.getContainerStatus(serverName);
      if (status.containerState === 'not-created') {
        return res.status(404).json({
          error: 'Container not found',
          server: serverName
        });
      }
      
      // Stop container
      await mcpHub.dockerIntegration.stopContainer(serverName, remove);
      
      res.json({
        success: true,
        server: serverName,
        removed: remove
      });
      
    } catch (error) {
      logger.error('Failed to stop container', { 
        server: req.params.serverName,
        error: error.message 
      });
      res.status(500).json({
        error: 'Failed to stop container',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/docker/containers/:serverName/restart
   * Restart container for server
   */
  router.post('/containers/:serverName/restart', requireDocker, async (req, res) => {
    try {
      const { serverName } = req.params;
      const { connect = true } = req.body;
      
      // Stop container
      await mcpHub.dockerIntegration.stopContainer(serverName, false);
      
      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Start container
      const endpoint = await mcpHub.dockerIntegration.startContainer(serverName);
      
      // Reconnect if requested
      if (connect) {
        await mcpHub.dockerIntegration.connectContainerToHub(serverName);
      }
      
      res.json({
        success: true,
        server: serverName,
        endpoint,
        connected: connect
      });
      
    } catch (error) {
      logger.error('Failed to restart container', { 
        server: req.params.serverName,
        error: error.message 
      });
      res.status(500).json({
        error: 'Failed to restart container',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/docker/images/pull
   * Pull images for all configured servers
   */
  router.post('/images/pull', requireDocker, async (req, res) => {
    try {
      const { servers } = req.body;
      
      let results;
      
      if (servers && Array.isArray(servers)) {
        // Pull specific servers
        results = {
          successful: [],
          failed: []
        };
        
        for (const serverName of servers) {
          try {
            const config = mcpHub.dockerIntegration.serverRegistry.get(serverName);
            if (!config) {
              results.failed.push({
                server: serverName,
                error: 'Server not configured'
              });
              continue;
            }
            
            await mcpHub.dockerIntegration.dockerManager.pullServerImage(
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
      } else {
        // Pull all configured servers
        results = await mcpHub.dockerIntegration.pullAllImages();
      }
      
      res.json({
        success: true,
        results
      });
      
    } catch (error) {
      logger.error('Failed to pull images', { error: error.message });
      res.status(500).json({
        error: 'Failed to pull images',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/docker/cleanup
   * Clean up stopped containers
   */
  router.post('/cleanup', requireDocker, async (req, res) => {
    try {
      await mcpHub.dockerIntegration.cleanupContainers();
      
      res.json({
        success: true,
        message: 'Stopped containers cleaned up'
      });
      
    } catch (error) {
      logger.error('Failed to cleanup containers', { error: error.message });
      res.status(500).json({
        error: 'Failed to cleanup containers',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/docker/config
   * Get Docker server configurations
   */
  router.get('/config', requireDocker, async (req, res) => {
    try {
      const configs = {};
      
      for (const [serverName, config] of mcpHub.dockerIntegration.serverRegistry) {
        configs[serverName] = {
          image: config.image,
          strategy: config.strategy,
          lightweight: config.lightweight,
          requiresAuth: config.requiresAuth,
          resourceLimits: config.resourceLimits
        };
      }
      
      res.json({
        serverConfigs: configs,
        count: Object.keys(configs).length
      });
      
    } catch (error) {
      logger.error('Failed to get Docker config', { error: error.message });
      res.status(500).json({
        error: 'Failed to get Docker config',
        message: error.message
      });
    }
  });
  
  /**
   * PUT /api/docker/config/:serverName
   * Update Docker configuration for a server
   */
  router.put('/config/:serverName', requireDocker, async (req, res) => {
    try {
      const { serverName } = req.params;
      const updates = req.body;
      
      // Get existing config
      const existingConfig = mcpHub.dockerIntegration.serverRegistry.get(serverName);
      
      if (!existingConfig) {
        // Create new configuration
        mcpHub.dockerIntegration.serverRegistry.set(serverName, updates);
      } else {
        // Update existing configuration
        mcpHub.dockerIntegration.serverRegistry.set(serverName, {
          ...existingConfig,
          ...updates
        });
      }
      
      // Update image map
      if (updates.image) {
        mcpHub.dockerIntegration.dockerManager.imageMap[serverName] = updates.image;
      }
      
      res.json({
        success: true,
        server: serverName,
        config: mcpHub.dockerIntegration.serverRegistry.get(serverName)
      });
      
    } catch (error) {
      logger.error('Failed to update Docker config', { 
        server: req.params.serverName,
        error: error.message 
      });
      res.status(500).json({
        error: 'Failed to update Docker config',
        message: error.message
      });
    }
  });
  
  return router;
}

export default createDockerRouter;

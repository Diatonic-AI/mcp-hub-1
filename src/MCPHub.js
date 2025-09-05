import logger from "./utils/logger.js";
import { ConfigManager } from "./utils/config.js";
import { MCPConnection } from "./MCPConnection.js";
import {
  ServerError,
  ConnectionError,
  ConfigError,
  wrapError,
} from "./utils/errors.js";
import { ServerLoadingManager } from "./utils/server-loading-manager.js";
import EventEmitter from "events";

export class MCPHub extends EventEmitter {
  constructor(configPathOrObject, { port, watch = false, marketplace, toolIndex, hubServerUrl = null } = {}) {
    super();
    this.connections = new Map();
    this.port = port;
    // Allow override of hub server URL for container environments or custom networking
    this.hubServerUrl = hubServerUrl || process.env.HUB_SERVER_URL || `http://localhost:${port}`;
    logger.debug(`Hub server URL configured: ${this.hubServerUrl}`, {
      source: hubServerUrl ? 'parameter' : (process.env.HUB_SERVER_URL ? 'environment' : 'default'),
      url: this.hubServerUrl
    });
    this.configManager = new ConfigManager(configPathOrObject);
    this.shouldWatchConfig = watch && (typeof configPathOrObject === "string" || Array.isArray(configPathOrObject));
    this.marketplace = marketplace;
    this.toolIndex = toolIndex;

    // Hub behavior options (overridden by config.hub when available)
    this.hubOptions = {
      // When true: only expose meta-tools and a single hub prompt; hide underlying tools/resources/prompts
      metaOnly: false,
      // When true: do not connect servers at startup; connect on demand for meta-tool calls
      lazyLoad: false,
      // Idle disconnect timeout for on-demand connections (ms)
      idleTimeoutMs: 300000,
    };

    // Initialize the advanced server loading manager
    this.serverLoadingManager = null;
  }
async initialize(isRestarting) {
    try {
      await this.configManager.loadConfig();

      // Refresh hubOptions from config after load
      try {
        const cfg = this.configManager.getConfig();
        if (cfg && typeof cfg.hub === 'object') {
          this.hubOptions = {
            ...this.hubOptions,
            ...cfg.hub,
          };
          logger.debug("Hub options loaded", this.hubOptions);
        }
      } catch (_) {}

      if (this.shouldWatchConfig && !isRestarting) {
        this.configManager.watchConfig();
        // Support both legacy signature (config) and new signature ({ config, changes })
        this.configManager.on("configChanged", async (payload) => {
          // If payload contains config/changes keys use handleConfigUpdated
          if (payload && typeof payload === 'object' && (payload.config || payload.changes)) {
            await this.handleConfigUpdated(payload.config, payload.changes);
          } else {
            // Older payloads may supply config directly - update ConfigManager with new config
            try {
              await this.configManager.updateConfig(payload);
            } catch (_) {}
          }
        });
      }

      // Initialize the advanced server loading manager
      this.serverLoadingManager = new ServerLoadingManager(this, {
        // Override default options based on hub config
        serverIdleTimeoutMs: this.hubOptions.idleTimeoutMs || 360000,
        enablePersistence: true
      });

      await this.startConfiguredServers();
    } catch (error) {
      // Only wrap if it's not already our error type
      if (!(error instanceof ConfigError)) {
        throw wrapError(error, "HUB_INIT_ERROR", {
          watchEnabled: this.shouldWatchConfig,
        });
      }
      throw error;
    }
  }

async startConfiguredServers() {
    const config = this.configManager.getConfig();
    const servers = Object.entries(config?.mcpServers || {});
    await this.disconnectAll();

    logger.info(
      `Initializing ${servers.length} configured MCP servers with advanced loading management`,
      {
        count: servers.length,
        lazyLoad: this.hubOptions.lazyLoad,
        advancedLoading: true,
      }
    );

    // Create connection objects for all servers (but don't connect yet)
    const initPromises = servers.map(async ([name, serverConfig]) => {
      try {
        if (serverConfig.disabled === true) {
          logger.debug("Skipping disabled MCP server", { server: name });
          return {
            name,
            status: "disabled",
            config: serverConfig,
          };
        }

        logger.info(`Initializing MCP server '${name}'`, { server: name });

        const connection = new MCPConnection(
          name,
          serverConfig,
          this.marketplace,
          this.hubServerUrl,
        );
        
        // Setup event forwarding
        ["toolsChanged", "resourcesChanged", "promptsChanged", "notification"].forEach((event) => {
          connection.on(event, (data) => {
            this.emit(event, data);
          });
        });

        // Setup dev event handlers
        connection.on("devServerRestarting", (data) => {
          this.emit("devServerRestarting", data);
        });
        connection.on("devServerRestarted", (data) => {
          this.emit("devServerRestarted", data);
        });

        // Setup connection event handlers for loading manager
        connection.on("connected", () => {
          this.emit("serverConnected", { serverName: name });
        });
        connection.on("disconnected", () => {
          this.emit("serverDisconnected", { serverName: name });
        });

        this.connections.set(name, connection);

        return {
          name,
          status: "initialized",
          config: serverConfig,
        };
      } catch (error) {
        const e = wrapError(error);
        logger.error(e.code || "SERVER_INIT_ERROR", e.message, e.data, false);

        return {
          name,
          status: "error",
          error: error.message,
          config: serverConfig,
        };
      }
    });

    // Wait for all servers to be initialized
    const results = await Promise.all(initPromises);

    const successful = results.filter((r) => r.status === "initialized");
    const failed = results.filter((r) => r.status === "error");
    const disabled = results.filter((r) => r.status === "disabled");

    logger.info(`${successful.length}/${servers.length} servers initialized successfully`, {
      total: servers.length,
      successful: successful.length,
      failed: failed.length,
      disabled: disabled.length,
      failedServers: failed.map((f) => f.name),
    });

    // Initialize and start the advanced server loading manager
    if (this.serverLoadingManager) {
      await this.serverLoadingManager.initialize();
    } else {
      // Fallback to traditional loading if manager not available
      logger.warn("ServerLoadingManager not initialized, falling back to traditional loading");
      await this.fallbackTraditionalLoading();
    }
  }

  /**
   * Fallback method for traditional server loading
   */
  async fallbackTraditionalLoading() {
    if (!this.hubOptions.lazyLoad) {
      // Connect all servers immediately
      for (const [name, connection] of this.connections) {
        if (connection.config && !connection.config.disabled) {
          try {
            await connection.connect();
          } catch (error) {
            logger.error(`Failed to connect server '${name}': ${error.message}`);
          }
        }
      }
    } else {
      // Set idle timeouts for lazy loading
      for (const [name, connection] of this.connections) {
        try { 
          connection.setIdleTimeout?.(this.hubOptions.idleTimeoutMs); 
        } catch (_) {}
      }
    }
  }

  async startServer(name) {
    // If we have the server loading manager, use it
    if (this.serverLoadingManager) {
      return await this.serverLoadingManager.triggerServerLoad(name);
    }

    // Fallback to direct connection
    const config = this.configManager.getConfig();
    const serverConfig = config.mcpServers?.[name];
    if (!serverConfig) {
      throw new ServerError("Server not found", { server: name });
    }

    const connection = this.connections.get(name);
    if (!connection) {
      throw new ServerError("Server connection not found", { server: name });
    }

    // If server was disabled, update config
    if (serverConfig.disabled) {
      serverConfig.disabled = false;
      await this.configManager.updateConfig(config);
    }
    connection.config = serverConfig;
    return await connection.start();
  }

  async stopServer(name, disable = false) {
    const config = this.configManager.getConfig();
    const serverConfig = config.mcpServers?.[name];
    if (!serverConfig) {
      throw new ServerError("Server not found", { server: name });
    }

    // If disabling, update config
    if (disable) {
      serverConfig.disabled = true;
      await this.configManager.updateConfig(config);
    }

    const connection = this.connections.get(name);
    if (!connection) {
      throw new ServerError("Server connection not found", { server: name });
    }
    return await connection.stop(disable);
  }


  async handleConfigUpdated(newConfig, changes) {
    try {
      const isSignificant = !!changes ? (changes.added?.length > 0 || changes.removed?.length > 0 || changes.modified?.length > 0) : false
      this.emit("configChangeDetected", { newConfig, isSignificant })
      //Even when some error occured on reloading, send the event to clients
      if (!newConfig || !changes) {
        return
      }
      if (!isSignificant) {
        logger.debug("No significant config changes detected")
        return;
      }
      this.emit("importantConfigChanged", changes);
      const addPromises = changes.added.map(async (name) => {
        const serverConfig = newConfig.mcpServers[name];
        await this.connectServer(name, serverConfig);
        logger.info(`Added new server '${name}'`)
      })

      const removePromises = changes.removed.map(async (name) => {
        await this.disconnectServer(name);
        this.connections.delete(name); // Clean up the connection
        logger.info(`Removed server ${name}`)
      })

      const modifiedPromises = changes.modified.map(async (name) => {
        const serverConfig = newConfig.mcpServers[name];
        const connection = this.connections.get(name);
        if (!!serverConfig.disabled !== !!connection?.disabled) {
          if (serverConfig.disabled) {
            await this.stopServer(name, true)
            logger.info(`Server '${name}' disabled`)
          } else {
            await this.startServer(name, serverConfig);
            logger.info(`Server '${name}' enabled`)
          }
        } else {
          // For other changes, reconnect with new config
          await this.disconnectServer(name);
          await this.connectServer(name, serverConfig);
          logger.info(`Updated server '${name}'`)
        }
      })
      await Promise.allSettled([
        ...addPromises,
        ...removePromises,
        ...modifiedPromises,
      ])
      this.emit("importantConfigChangeHandled", changes);
    } catch (error) {
      logger.error(
        error.code || "CONFIG_UPDATE_ERROR",
        error.message || "Error updating configuration",
        {
          error: error.message,
          changes,
        },
        false
      )
      this.emit("importantConfigChangeHandled", changes);
    }
  }

  async connectServer(name, config) {
    let connection = this.getConnection(name);
    if (!connection) {
      connection = new MCPConnection(
        name,
        config,
        this.marketplace,
        this.hubServerUrl,
      );
      try { connection.setIdleTimeout?.(this.hubOptions.idleTimeoutMs); } catch (_) {}
      this.connections.set(name, connection);
    }
    try {
      await connection.connect(config);
      const serverInfo = connection.getServerInfo();
      
      // Automatically register server and its tools with the centralized index
      if (this.toolIndex && serverInfo) {
        await this.registerServerTools(name, serverInfo);
      }
      
      return serverInfo;
    } catch (error) {
      throw new ServerError(`Failed to connect server "${name}"`, {
        server: name,
        error: error.message,
      });
    }
  }

  /**
   * Register server and its tools with the centralized tool index
   * This creates persistent tool entries that can trigger lazy loading
   */
  async registerServerTools(serverName, serverInfo) {
    if (!this.toolIndex || !serverInfo) {
      return;
    }

    try {
      const tools = serverInfo.capabilities?.tools || [];
      const resources = serverInfo.capabilities?.resources || [];
      const prompts = serverInfo.capabilities?.prompts || [];

      // Register server with the tool index - these act as entry points for lazy loading
      const result = await this.toolIndex.registerServer({
        name: serverName,
        endpoint: this.hubServerUrl + '/mcp',
        tools: tools,
        capabilities: {
          tools: tools.length,
          resources: resources.length,
          prompts: prompts.length
        },
        metadata: {
          serverInfo: serverInfo,
          registeredAt: new Date().toISOString(),
          connectionType: serverInfo.transportType || 'stdio',
          lazyLoadingEnabled: true,
          persistentRegistration: true
        }
      });

      logger.info(`Server '${serverName}' registered with ${tools.length} tools (persistent for lazy loading)`, {
        serverName,
        endpoint: this.hubServerUrl + '/mcp',
        toolCount: tools.length,
        persistentRegistration: true
      });

      // Update persistent registry in ServerLoadingManager
      if (this.serverLoadingManager) {
        await this.serverLoadingManager.updatePersistentRegistry(serverName, serverInfo, tools);
      }

      // Emit event for tool registration
      this.emit('toolsChanged', {
        serverName,
        tools: tools.map(tool => ({
          ...tool,
          serverName,
          endpoint: this.hubServerUrl + '/mcp',
          lazyLoadingEnabled: true
        })),
        action: 'registered'
      });

      return result;
    } catch (error) {
      logger.error('Failed to register server tools', {
        serverName,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async disconnectServer(name) {
    const connection = this.connections.get(name);
    if (connection) {
      try {
        await connection.disconnect();
        
        // DO NOT remove connection from map - keep it for lazy loading
        // Mark connection as available for reconnection when tools are called
        logger.info(`Server '${name}' disconnected but connection kept for lazy loading`);
        
        // Emit event for server disconnection (but tools stay registered)
        this.emit('serverDisconnected', {
          serverName: name,
          toolsRemainRegistered: true,
          connectionKeptForLazyLoading: true
        });
      } catch (error) {
        // Log but don't throw since we're cleaning up
        logger.error(
      "SERVER_DISCONNECT_ERROR",
      "Error disconnecting server",
          {
            server: name,
            error: error.message,
          },
          false
        );
      }
    // DO NOT remove from connections map - keep for lazy reconnection
    // this.connections.delete(name);
    }
  }
  getConnection(server_name) {
    const connection = this.connections.get(server_name);
    return connection
  }

  async cleanup() {
    logger.info("Starting MCP Hub cleanup");

    // Stop config file watching
    if (this.shouldWatchConfig) {
      logger.debug("Stopping config file watcher");
      this.configManager.stopWatching();
    }

    // Disconnect all servers
    await this.disconnectAll();

    logger.info("MCP Hub cleanup completed");
  }

  async disconnectAll() {
    const serverNames = Array.from(this.connections.keys());
    logger.info(`Disconnecting all servers in parallel`, {
      count: serverNames.length,
    });

    // Shutdown the server loading manager first
    if (this.serverLoadingManager) {
      try {
        await this.serverLoadingManager.shutdown();
      } catch (error) {
        logger.error(`Failed to shutdown ServerLoadingManager: ${error.message}`);
      }
    }

    const results = await Promise.allSettled(
      serverNames.map((name) => this.disconnectServer(name))
    );

    const successful = results.filter((r) => r.status === "fulfilled");
    const failed = results
      .filter((r) => r.status === "rejected")
      .map((r, i) => ({
        name: serverNames[i],
        error: r.reason?.message || "Unknown error",
      }));

    // Log failures
    failed.forEach(({ name, error }) => {
      logger.error(
        "SERVER_DISCONNECT_ERROR",
        "Failed to disconnect server during cleanup",
        {
          server: name,
          error,
        },
        false
      );
    });

    if (serverNames.length) {
      logger.info(`${successful.length} servers disconnected`, {
        total: serverNames.length,
        successful: successful.length,
        failed: failed.length,
        failedServers: failed.map((f) => f.name),
      });
    }
    // Ensure connections map is cleared even if some disconnections failed
    this.connections.clear();
  }

  getServerStatus(name) {
    const connection = this.connections.get(name);
    if (!connection) {
      throw new ServerError("Server not found", { server: name });
    }
    return connection.getServerInfo();
  }

  getAllServerStatuses() {
    return Array.from(this.connections.values()).map((connection) =>
      connection.getServerInfo()
    );
  }

  async rawRequest(serverName, ...rest) {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new ServerError("Server not found", {
        server: serverName,
      });
    }
    // Ensure server is connected in lazy-load mode
    await this.ensureConnected(serverName);
    const result = await connection.raw_request(...rest);
    try { connection.registerActivity?.(); } catch (_) {}
    return result;
  }
  async callTool(serverName, toolName, args, request_options) {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new ServerError("Server not found", {
        server: serverName,
        operation: "tool_call",
        tool: toolName,
      });
    }
    await this.ensureConnected(serverName);
    const result = request_options === undefined ? await connection.callTool(toolName, args) : await connection.callTool(toolName, args, request_options);
    
    // Register activity with connection
    try { connection.registerActivity?.(); } catch (_) {}
    
    // Register activity with server loading manager
    if (this.serverLoadingManager) {
      this.serverLoadingManager.recordActivity('tool_call', {
        serverName,
        toolName,
        args,
        timestamp: new Date()
      });
    }

    // Emit tool call event for other components
    this.emit('toolCalled', {
      serverName,
      toolName,
      args,
      result,
      timestamp: new Date()
    });
    
    return result;
  }

  async readResource(serverName, uri, request_options) {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new ServerError("Server not found", {
        server: serverName,
        operation: "resource_read",
        uri,
      });
    }
    await this.ensureConnected(serverName);
  const result = request_options === undefined ? await connection.readResource(uri) : await connection.readResource(uri, request_options);
    try { connection.registerActivity?.(); } catch (_) {}
    return result;
  }

  async getPrompt(serverName, promtName, args, request_options) {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new ServerError("Server not found", {
        server: serverName,
        operation: "get_prompt",
        prompt: promtName,
      });
    }
    await this.ensureConnected(serverName);
    const result = await connection.getPrompt(promtName, args, request_options);
    try { connection.registerActivity?.(); } catch (_) {}
    return result;
  }

  async refreshServer(name) {
    const connection = this.connections.get(name);
    if (!connection) {
      throw new ServerError("Server not found", { server: name });
    }

    logger.info(`Refreshing capabilities for server '${name}'`);
    await connection.updateCapabilities();
    return connection.getServerInfo();
  }

  async refreshAllServers() {
    logger.debug("Refreshing capabilities from all servers");
    const serverNames = Array.from(this.connections.keys());

    const results = await Promise.allSettled(
      serverNames.map(async (name) => {
        try {
          const connection = this.connections.get(name);
          await connection.updateCapabilities();
          return connection.getServerInfo();
        } catch (error) {
          logger.error(
            "CAPABILITIES_REFRESH_ERROR",
            `Failed to refresh capabilities for server ${name}`,
            {
              server: name,
              error: error.message,
            },
            false
          );
          return {
            name,
            status: "error",
            error: error.message,
          };
        }
      })
    );
    logger.debug("Refreshed all servers")

    return results.map((result) =>
      result.status === "fulfilled" ? result.value : result.reason
    );
  }

  // Ensure a server is connected (used in lazy-load mode)
  async ensureConnected(name) {
    const connection = this.connections.get(name);
    if (!connection) {
      throw new ServerError("Server not found", { server: name });
    }
    if (this.hubOptions.lazyLoad && connection.status !== "connected" && !connection.disabled) {
      try { connection.setIdleTimeout?.(this.hubOptions.idleTimeoutMs); } catch (_) {}
      await connection.start();
    }
    return connection;
  }
}

export { MCPConnection } from "./MCPConnection.js";


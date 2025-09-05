/**
 * MCP Hub Server Endpoint - Unified MCP Server Interface
 * 
 * This module creates a single MCP server endpoint that exposes ALL capabilities
 * from multiple managed MCP servers through one unified interface.
 * 
 * HOW IT WORKS:
 * 1. MCP Hub manages multiple individual MCP servers (like filesystem, github, etc.)
 * 2. This endpoint collects all tools/resources/prompts from those servers
 * 3. It creates a single MCP server that any MCP client can connect to
 * 4. When a client calls a tool, it routes the request to the correct underlying server
 * 
 * BENEFITS:
 * - Users manage all MCP servers in one place through MCP Hub's TUI
 * - MCP clients (like Claude Desktop, Cline, etc.) only need to connect to one endpoint
 * - No need to configure each MCP client with dozens of individual server connections
 * - Automatic capability updates when servers are added/removed/restarted
 * 
 * EXAMPLE:
 * Just configure clients with with:
 * {
 *  "Hub": {
 *    "url": "http://localhost:${port}/mcp"
 *  }
 * }
 * The hub automatically namespaces capabilities to avoid conflicts:
 * - "search" tool from filesystem server becomes "filesystem__search"
 * - "search" tool from github server becomes "github__search"
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  GetPromptResultSchema,
  CallToolResultSchema,
  ReadResourceResultSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { HubState } from "../utils/sse-manager.js";
import logger from "../utils/logger.js";
import { ToolsetRegistry, HUB_TOOLS } from "./toolset-registry.js";

// Unique server name to identify our internal MCP endpoint
const HUB_INTERNAL_SERVER_NAME = "mcp-hub-internal-endpoint";

// Delimiter for namespacing
const DELIMITER = '__';
const MCP_REQUEST_TIMEOUT = 5 * 60 * 1000 //Default to 5 minutes

// Comprehensive capability configuration
const CAPABILITY_TYPES = {
  TOOLS: {
    id: 'tools',
    uidField: 'name',
    syncWithEvents: {
      events: ['toolsChanged'],
      capabilityIds: ['tools'],
      notificationMethod: 'sendToolListChanged'
    },
    listSchema: ListToolsRequestSchema,
    handler: {
      method: "tools/call",
      callSchema: CallToolRequestSchema,
      resultSchema: CallToolResultSchema,
      form_error(error) {
        return {
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          isError: true,
        }
      },
      form_params(cap, request) {
        return {
          name: cap.originalName,
          arguments: request.params.arguments || {},
        }
      }
    }
  },
  RESOURCES: {
    id: 'resources',
    uidField: 'uri',
    syncWithEvents: {
      events: ['resourcesChanged'],
      capabilityIds: ['resources', 'resourceTemplates'],
      notificationMethod: 'sendResourceListChanged'
    },
    listSchema: ListResourcesRequestSchema,
    handler: {
      method: "resources/read",
      form_error(error) {
        throw new McpError(ErrorCode.InvalidParams, `Failed to read resource: ${error.message}`);
      },
      form_params(cap, request) {
        return {
          uri: cap.originalName,
        }
      },
      callSchema: ReadResourceRequestSchema,
      resultSchema: ReadResourceResultSchema,
    }
  },
  RESOURCE_TEMPLATES: {
    id: 'resourceTemplates',
    uidField: 'uriTemplate',
    // No syncWithEvents - handled by resources event
    listSchema: ListResourceTemplatesRequestSchema,
    // No callSchema - templates are listed only
    syncWithEvents: {
      events: [],
      capabilityIds: [],
      notificationMethod: 'sendResourceListChanged'
    },
  },
  PROMPTS: {
    id: 'prompts',
    uidField: 'name',
    syncWithEvents: {
      events: ['promptsChanged'],
      capabilityIds: ['prompts'],
      notificationMethod: 'sendPromptListChanged'
    },
    listSchema: ListPromptsRequestSchema,
    handler: {
      method: "prompts/get",
      callSchema: GetPromptRequestSchema,
      resultSchema: GetPromptResultSchema,
      form_params(cap, request) {
        return {
          name: cap.originalName,
          arguments: request.params.arguments || {},
        }
      },
      form_error(error) {
        throw new McpError(ErrorCode.InvalidParams, `Failed to read resource: ${error.message}`);
      }
    }
  },
};

/**
 * MCP Server endpoint that exposes all managed server capabilities
 * This allows standard MCP clients to connect to mcp-hub via MCP protocol
 */
export class MCPServerEndpoint {
  constructor(mcpHub) {
    this.mcpHub = mcpHub;
    this.clients = new Map(); // sessionId -> { transport, server }
    this.serversMap = new Map(); // sessionId -> server instance

    // Store registered capabilities by type
    this.registeredCapabilities = {};
    Object.values(CAPABILITY_TYPES).forEach(capType => {
      this.registeredCapabilities[capType.id] = new Map(); // namespacedName -> { serverName, originalName, definition }
    });

    // Initialize ToolsetRegistry for hub meta-tools
    this.toolsetRegistry = new ToolsetRegistry(mcpHub, this);

    // Setup capability synchronization once
    this.setupCapabilitySync();

    // Initial capability registration
    this.syncCapabilities();
  }

  getEndpointUrl() {
    return `${this.mcpHub.hubServerUrl}/mcp`;
  }

  /**
   * Create a new MCP server instance for each connection
   */
  createServer() {
    // Create low-level MCP server instance with unique name
    const server = new Server(
      {
        name: HUB_INTERNAL_SERVER_NAME,
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {
            listChanged: true
          },
          resources: {
            listChanged: true,
          },
          prompts: {
            listChanged: true,
          },
        },
      }
    );
    server.onerror = function(err) {
      logger.warn(`Hub Endpoint onerror: ${err.message}`);
    }
    // Setup request handlers for this server instance
    this.setupRequestHandlers(server);

    return server;
  }

  /**
   * Creates a safe server name for namespacing (replace special chars with underscores)
   */
  createSafeServerName(serverName) {
    return serverName.replace(/[^a-zA-Z0-9]/g, '_');
  }


  /**
   * Setup MCP request handlers for a server instance
   */
  setupRequestHandlers(server) {
    // Setup handlers for each capability type
    Object.values(CAPABILITY_TYPES).forEach(capType => {
      const capId = capType.id;

      // Setup list handler if schema exists
      if (capType.listSchema) {
        server.setRequestHandler(capType.listSchema, () => {
          const metaOnly = !!this.mcpHub.hubOptions?.metaOnly;
          const capabilityMap = this.registeredCapabilities[capId];
          let capabilities = [];

          if (capId === 'tools') {
            // In meta-only mode, expose only meta-tools
            if (metaOnly) {
              capabilities = Object.values(HUB_TOOLS);
            } else {
              capabilities = Array.from(capabilityMap.values()).map(item => item.definition);
              // Also expose meta-tools
              capabilities.push(...Object.values(HUB_TOOLS));
            }
          } else if (capId === 'resources') {
            capabilities = metaOnly ? [] : Array.from(capabilityMap.values()).map(item => item.definition);
          } else if (capId === 'resourceTemplates') {
            capabilities = metaOnly ? [] : Array.from(capabilityMap.values()).map(item => item.definition);
          } else if (capId === 'prompts') {
            if (metaOnly) {
              // Only a single hub prompt
              capabilities = [{ name: 'start_here_readme.md', description: 'Start here guide for MCP Hub' }];
            } else {
              capabilities = Array.from(capabilityMap.values()).map(item => item.definition);
            }
          } else {
            capabilities = Array.from(capabilityMap.values()).map(item => item.definition);
          }

          return { [capId]: capabilities };
        });
      }

      // Setup call/action handler if schema exists
      if (capType.handler?.callSchema) {
        server.setRequestHandler(capType.handler.callSchema, async (request, extra) => {
          const metaOnly = !!this.mcpHub.hubOptions?.metaOnly;
          const itemName = request.params[capType.uidField];

          // Handle hub meta-tools by exact names from HUB_TOOLS
          if (capId === 'tools' && this.isHubMetaTool(itemName)) {
            return await this.handleHubMetaTool(request);
          }

          // In meta-only mode, block direct access to underlying capabilities
          if (metaOnly) {
            if (capId === 'tools') {
              return capType.handler.form_error(new Error(`Direct tool calls are disabled. Use meta-tool 'Call_Server_Tool' instead.`));
            }
            if (capId === 'resources') {
              return capType.handler.form_error(new Error(`Direct resource access is disabled in meta-only mode.`));
            }
            if (capId === 'prompts') {
              if (itemName === 'start_here_readme.md') {
                return await this.handleHubPrompt(request);
              }
              return capType.handler.form_error(new Error(`Direct prompts are disabled in meta-only mode.`));
            }
          }

          const registeredCap = this.getRegisteredCapability(request, capType.id, capType.uidField);
          if (!registeredCap) {
            throw new McpError(
              ErrorCode.InvalidParams,
              `${capId} capability not found: ${toolName}`
            );
          }
          const { serverName, originalName } = registeredCap;
          const request_options = {
            timeout: MCP_REQUEST_TIMEOUT
          }
          try {
            const result = await this.mcpHub.rawRequest(serverName, {
              method: capType.handler.method,
              params: capType.handler.form_params(registeredCap, request)
            }, capType.handler.resultSchema, request_options)
            return result;
          } catch (error) {
            logger.debug(`Error executing ${capId} '${originalName}': ${error.message}`);
            return capType.handler.form_error(error)
          }
        });
      }
    });

    // Hub meta-tool handlers are integrated into the main tool handler
  }

  /**
   * Handle hub meta-tool execution
   */
  async handleHubMetaTool(request) {
    const toolName = request.params.name;
    const args = request.params.arguments || {};
    
    try {
      let result;
      
      switch (toolName) {
        case HUB_TOOLS.START_HERE_README.name:
          result = this.toolsetRegistry.getStartHereReadme(args.format);
          break;
          
        case HUB_TOOLS.LIST_SERVERS.name:
          result = {
            content: [{
              type: "text",
              text: JSON.stringify(this.toolsetRegistry.listServers(args.include_disabled), null, 2)
            }]
          };
          break;
          
        case HUB_TOOLS.LIST_SERVER_TOOLS.name:
          result = {
            content: [{
              type: "text",
              text: JSON.stringify(this.toolsetRegistry.listServerTools(args.server_name), null, 2)
            }]
          };
          break;
          
        case HUB_TOOLS.LIST_ALL_TOOLS.name:
          result = {
            content: [{
              type: "text",
              text: JSON.stringify(
                this.toolsetRegistry.listAllTools(args.include_server_info, args.format), 
                null, 2
              )
            }]
          };
          break;
          
        case HUB_TOOLS.FIND_TOOLS.name:
          result = {
            content: [{
              type: "text",
              text: JSON.stringify(
                this.toolsetRegistry.findTools(args.pattern, args.search_in, args.case_sensitive), 
                null, 2
              )
            }]
          };
          break;
          
        case HUB_TOOLS.CALL_TOOL.name:
          result = await this.toolsetRegistry.callTool(args.server_name, args.tool_name, args.arguments);
          break;
          
        case HUB_TOOLS.CHAIN_TOOLS.name:
          result = await this.toolsetRegistry.chainTools(args.chain);
          break;
          
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown hub tool: ${toolName}`);
      }
      
      return result;
    } catch (error) {
      logger.debug(`Error executing hub tool '${toolName}': ${error.message}`);
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true
      };
    }
  }

  getRegisteredCapability(request, capId, uidField) {
    const capabilityMap = this.registeredCapabilities[capId];
    let key = request.params[uidField]
    const registeredCap = capabilityMap.get(key);
    // key might be a resource Template
    if (!registeredCap && capId === CAPABILITY_TYPES.RESOURCES.id) {
      let [serverName, ...uri] = key.split(DELIMITER);
      if (!serverName || !uri) {
        return null; // Invalid format
      }
      serverName = this.serversMap.get(serverName)?.name
      return {
        serverName,
        originalName: uri.join(DELIMITER),
      }
    }
    return registeredCap
  }

  isHubMetaTool(name) {
    if (!name) return false;
    return Object.values(HUB_TOOLS).some(t => t.name === name);
  }

  async handleHubPrompt(request) {
    // Only supported hub prompt: start_here_readme.md
    const args = request.params.arguments || {};
    const format = args.format || 'markdown';
    const readme = this.toolsetRegistry.getStartHereReadme(format);
    // Convert tool-style result to prompt result schema: messages[{role, content[]}] structure
    const text = (readme?.content?.[0]?.text) || '';
    return {
      messages: [
        {
          role: 'user',
          content: [ { type: 'text', text } ]
        }
      ]
    };
  }

  /**
   * Setup listeners for capability changes from managed servers
   */
  setupCapabilitySync() {
    // For each capability type with syncWithEvents
    Object.values(CAPABILITY_TYPES).forEach(capType => {
      if (capType.syncWithEvents) {
        const { events, capabilityIds } = capType.syncWithEvents;

        events.forEach(event => {
          this.mcpHub.on(event, (data) => {
            this.syncCapabilities(capabilityIds);
          });
        });
      }
    });

    // Global events that sync ALL capabilities
    const globalSyncEvents = ['importantConfigChangeHandled'];
    globalSyncEvents.forEach(event => {
      this.mcpHub.on(event, (data) => {
        this.syncCapabilities(); // Sync all capabilities
      });
    });

    // Listen for hub state changes to re-sync all capabilities when servers are ready
    this.mcpHub.on('hubStateChanged', (data) => {
      const { state } = data;
      const criticalStates = [HubState.READY, HubState.RESTARTED, HubState.STOPPED, HubState.ERROR];

      if (criticalStates.includes(state)) {
        this.syncCapabilities(); // Sync all capabilities
      }
    });
  }

  /**
   * Synchronize capabilities from connected servers
   * @param {string[]} capabilityIds - Specific capability IDs to sync, defaults to all
   */
  syncCapabilities(capabilityIds = null) {
    // Default to all capability IDs if none specified
    const idsToSync = capabilityIds || Object.values(CAPABILITY_TYPES).map(capType => capType.id);

    // Update the servers map with current connection states
    this.syncServersMap()

    // Sync each requested capability type and notify clients of changes
    idsToSync.forEach(capabilityId => {
      const changed = this.syncCapabilityType(capabilityId);
      if (changed) {
        // Send notification for this specific capability type if we have active connections
        if (this.hasActiveConnections()) {
          const capType = Object.values(CAPABILITY_TYPES).find(cap => cap.id === capabilityId);
          if (capType?.syncWithEvents?.notificationMethod) {
            this.notifyCapabilityChanges(capType.syncWithEvents.notificationMethod);
          }
        }
      }
    });
  }

  /**
   * Synchronize the servers map with current connection states
   * Creates safe server IDs for namespacing capabilities
   */
  syncServersMap() {
    this.serversMap.clear();

    // Register all connected servers with unique safe IDs
    for (const connection of this.mcpHub.connections.values()) {
      if (connection.status === "connected" && !connection.disabled) {
        const name = connection.name;
        let id = this.createSafeServerName(name);

        // Ensure unique ID by appending counter if needed
        if (this.serversMap.has(id)) {
          let counter = 1;
          while (this.serversMap.has(`${id}_${counter}`)) {
            counter++;
          }
          id = `${id}_${counter}`;
        }
        this.serversMap.set(id, connection);
      }
    }
  }

  /**
   * Synchronize a specific capability type and detect changes
   */
  syncCapabilityType(capabilityId) {
    const capabilityMap = this.registeredCapabilities[capabilityId];
    const previousKeys = new Set(capabilityMap.keys());

    // Clear and rebuild capabilities from connected servers
    capabilityMap.clear();
    for (const [serverId, connection] of this.serversMap) {
      if (connection.status === "connected" && !connection.disabled) {
        this.registerServerCapabilities(connection, { capabilityId, serverId });
      }
    }

    // Check if capability keys changed
    const newKeys = new Set(capabilityMap.keys());
    return previousKeys.size !== newKeys.size ||
      [...newKeys].some(key => !previousKeys.has(key));
  }


  /**
   * Send capability change notifications to all connected clients
   */
  notifyCapabilityChanges(notificationMethod) {
    for (const { server } of this.clients.values()) {
      try {
        server[notificationMethod]();
      } catch (error) {
        logger.warn(`Error sending ${notificationMethod} notification: ${error.message}`);
      }
    }
  }

  /**
   * Register capabilities from a server connection for a specific capability type
   * Creates namespaced capability names to avoid conflicts between servers
   */
  registerServerCapabilities(connection, { capabilityId, serverId }) {
    const serverName = connection.name;

    // Skip self-reference to prevent infinite recursion
    if (this.isSelfReference(connection)) {
      return;
    }

    // Find the capability type configuration and get server's capabilities
    const capType = Object.values(CAPABILITY_TYPES).find(cap => cap.id === capabilityId);
    const capabilities = connection[capabilityId];
    if (!capabilities || !Array.isArray(capabilities)) {
      return; // No capabilities of this type
    }

    const capabilityMap = this.registeredCapabilities[capabilityId];

    // Register each capability with namespaced name
    for (const cap of capabilities) {
      const originalValue = cap[capType.uidField];
      const uniqueName = serverId + DELIMITER + originalValue;

      // Create capability with namespaced unique identifier
      const formattedCap = {
        ...cap,
        [capType.uidField]: uniqueName
      };

      // Store capability with metadata for routing back to original server
      capabilityMap.set(uniqueName, {
        serverName,
        originalName: originalValue,
        definition: formattedCap,
      });
    }
  }


  /**
   * Check if a connection is a self-reference (connecting to our own MCP endpoint)
   */
  isSelfReference(connection) {
    // Primary check: Compare server's reported name with our internal server name
    if (connection.serverInfo && connection.serverInfo.name === HUB_INTERNAL_SERVER_NAME) {
      return true;
    }
    return false;
  }

  /**
   * Check if there are any active MCP client connections
   */
  hasActiveConnections() {
    return this.clients.size > 0;
  }




  /**
   * Handle SSE transport creation (GET /mcp)
   */
  async handleSSEConnection(req, res) {
    let transport = null;
    let server = null;
    let sessionId = null;
    let clientInfo = null;

    try {
      // Set up SSE headers early
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      
      // Create SSE transport
      transport = new SSEServerTransport('/messages', res);
      sessionId = transport.sessionId;

      // Create a new server instance for this connection
      server = this.createServer();

      // Store transport and server together
      this.clients.set(sessionId, { transport, server, connectedAt: new Date() });

      // Setup cleanup with error handling
      const cleanup = async () => {
        if (sessionId && this.clients.has(sessionId)) {
          this.clients.delete(sessionId);
        }
        
        if (server) {
          try {
            await server.close();
          } catch (error) {
            logger.debug(`Error closing server for ${clientInfo?.name ?? "Unknown"}: ${error.message}`);
          }
        }
        
        if (transport) {
          try {
            transport.close?.();
          } catch (error) {
            logger.debug(`Error closing transport: ${error.message}`);
          }
        }
        
        logger.debug(`MCP client '${clientInfo?.name ?? "Unknown"}' (session: ${sessionId}) disconnected`);
      };

      // Set up connection event handlers
      res.on('close', cleanup);
      res.on('error', (error) => {
        logger.debug(`SSE response error for session ${sessionId}: ${error.message}`);
        cleanup();
      });
      
      if (transport.onclose) {
        transport.onclose = cleanup;
      }

      // Connect MCP server to transport with timeout
      const connectionTimeout = setTimeout(() => {
        logger.warn(`MCP connection timeout for session ${sessionId}`);
        cleanup();
      }, 30000); // 30 second timeout

      await server.connect(transport);
      clearTimeout(connectionTimeout);
      
      server.oninitialized = () => {
        try {
          clientInfo = server.getClientVersion();
          if (clientInfo) {
            logger.info(`MCP client '${clientInfo.name}' connected (session: ${sessionId})`);
          }
        } catch (error) {
          logger.debug(`Error getting client version: ${error.message}`);
        }
      };
      
    } catch (error) {
      logger.warn(`Failed to establish MCP SSE connection: ${error.message}`);
      
      // Clean up on error
      if (sessionId && this.clients.has(sessionId)) {
        this.clients.delete(sessionId);
      }
      
      if (server) {
        try {
          await server.close();
        } catch (closeError) {
          logger.debug(`Error closing server after connection failure: ${closeError.message}`);
        }
      }
      
      if (!res.headersSent) {
        res.status(500).end('Failed to establish MCP connection');
      }
      
      throw error;
    }
  }

  /**
   * Handle MCP messages (POST /messages)
   */
  async handleMCPMessage(req, res) {
    const sessionId = req.query.sessionId;
    function sendErrorResponse(code, error) {
      res.status(code).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: error.message || 'Invalid request',
        },
        id: null,
      });
    }

    if (!sessionId) {
      logger.warn('MCP message received without session ID');
      return sendErrorResponse(400, new Error('Missing sessionId parameter'));
    }

    const transportInfo = this.clients.get(sessionId);
    if (transportInfo) {
      await transportInfo.transport.handlePostMessage(req, res, req.body);
    } else {
      logger.warn(`MCP message for unknown session: ${sessionId}`);
      return sendErrorResponse(404, new Error(`Session not found: ${sessionId}`));
    }
  }

  /**
   * Get statistics about the MCP endpoint
   */
  getStats() {
    const capabilityCounts = Object.entries(this.registeredCapabilities)
      .reduce((acc, [type, map]) => {
        acc[type] = map.size;
        return acc;
      }, {});

    return {
      activeClients: this.clients.size,
      registeredCapabilities: capabilityCounts,
      totalCapabilities: Object.values(capabilityCounts).reduce((sum, count) => sum + count, 0),
    };
  }

  /**
   * Close all transports and cleanup
   */
  async close() {
    // Close all servers (which will close their transports)
    for (const [sessionId, { server }] of this.clients) {
      try {
        await server.close();
      } catch (error) {
        logger.debug(`Error closing server ${sessionId}: ${error.message}`);
      }
    }

    this.clients.clear();

    // Clear all registered capabilities
    Object.values(this.registeredCapabilities).forEach(map => map.clear());

    logger.info('MCP server endpoint closed');
  }
}


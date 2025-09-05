import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolsetRegistry, HUB_TOOLS } from "../src/mcp/toolset-registry.js";
import { MCPServerEndpoint } from "../src/mcp/server.js";

// Mock dependencies
vi.mock("../src/utils/logger.js", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("ToolsetRegistry", () => {
  let toolsetRegistry;
  let mockMcpHub;
  let mockMcpServerEndpoint;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock MCPHub
    mockMcpHub = {
      getAllServerStatuses: vi.fn(),
      getConnection: vi.fn(),
      callTool: vi.fn(),
    };

    // Mock MCPServerEndpoint
    mockMcpServerEndpoint = {
      registeredCapabilities: {
        tools: new Map(),
      },
    };

    toolsetRegistry = new ToolsetRegistry(mockMcpHub, mockMcpServerEndpoint);
  });

  describe("Hub Tools Definition", () => {
    it("should define all required hub tools", () => {
      const expectedTools = [
        "Start_Mcp_Hub",
        "List_All_Servers",
        "List_Server_Tools",
        "List_All_Tools",
        "Find_Tools",
        "Call_Server_Tool",
        "Call_Tool_Chain",
      ];

      const actualTools = Object.values(HUB_TOOLS).map(tool => tool.name);
      expect(actualTools).toEqual(expect.arrayContaining(expectedTools));
      expect(actualTools).toHaveLength(expectedTools.length);
    });

    it("should have proper MCP tool schemas", () => {
      Object.values(HUB_TOOLS).forEach(tool => {
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("description");
        expect(tool).toHaveProperty("inputSchema");
        expect(tool.inputSchema).toHaveProperty("type", "object");
        expect(tool.inputSchema).toHaveProperty("properties");
      });
    });
  });

  describe("Server Discovery", () => {
    it("should list connected servers", () => {
      const mockServers = [
        {
          name: "server1",
          displayName: "Server One",
          status: "connected",
          capabilities: { tools: [{ name: "tool1" }] }
        },
        {
          name: "server2", 
          displayName: "Server Two",
          status: "disabled",
          capabilities: { tools: [] }
        },
      ];
      
      mockMcpHub.getAllServerStatuses.mockReturnValue(mockServers);

      const result = toolsetRegistry.listServers();
      expect(result).toEqual([mockServers[0]]); // Should exclude disabled server
    });

    it("should include disabled servers when requested", () => {
      const mockServers = [
        {
          name: "server1",
          status: "connected",
          capabilities: { tools: [] }
        },
        {
          name: "server2",
          status: "disabled", 
          capabilities: { tools: [] }
        },
      ];
      
      mockMcpHub.getAllServerStatuses.mockReturnValue(mockServers);

      const result = toolsetRegistry.listServers(true);
      expect(result).toEqual(mockServers);
    });
  });

  describe("Tool Discovery", () => {
    beforeEach(() => {
      // Mock server tools in registeredCapabilities
      const toolsMap = new Map([
        ["server1__file_read", {
          serverName: "server1",
          originalName: "file_read",
          definition: { name: "server1__file_read", description: "Read files" }
        }],
        ["server2__web_search", {
          serverName: "server2", 
          originalName: "web_search",
          definition: { name: "server2__web_search", description: "Search the web" }
        }],
      ]);
      
      mockMcpServerEndpoint.registeredCapabilities.tools = toolsMap;

      // Mock connections
      mockMcpHub.getConnection.mockImplementation((serverName) => {
        const connections = {
          server1: { displayName: "File Server", status: "connected", description: "File operations" },
          server2: { displayName: "Web Server", status: "connected", description: "Web operations" },
        };
        return connections[serverName];
      });
    });

    it("should list all tools with server info", () => {
      const result = toolsetRegistry.listAllTools(true, "detailed");
      
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        name: "server1__file_read",
        originalName: "file_read", 
        namespacedName: "server1__file_read",
        serverInfo: {
          name: "server1",
          displayName: "File Server"
        }
      });
    });

    it("should list tools in simple format", () => {
      const result = toolsetRegistry.listAllTools(false, "simple");
      
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        name: "file_read",
        namespacedName: "server1__file_read",
        serverName: "server1"
      });
    });

    it("should find tools by pattern", () => {
      const result = toolsetRegistry.findTools("file", "all", false);
      
      expect(result).toHaveLength(1);
      expect(result[0].originalName).toBe("file_read");
    });

    it("should find tools case sensitively", () => {
      const result1 = toolsetRegistry.findTools("FILE", "all", true);
      const result2 = toolsetRegistry.findTools("FILE", "all", false);
      
      expect(result1).toHaveLength(0); // Case sensitive - no match
      expect(result2).toHaveLength(1); // Case insensitive - match
    });
  });

  describe("Server Tool Listing", () => {
    it("should list tools for specific server", () => {
      const mockConnection = {
        tools: [
          { name: "tool1", description: "Test tool 1" },
          { name: "tool2", description: "Test tool 2" },
        ],
        displayName: "Test Server"
      };
      
      mockMcpHub.getConnection.mockReturnValue(mockConnection);

      const result = toolsetRegistry.listServerTools("testserver");
      
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        name: "tool1",
        serverName: "testserver",
        serverDisplayName: "Test Server"
      });
    });

    it("should throw error for unknown server", () => {
      mockMcpHub.getConnection.mockReturnValue(null);

      expect(() => {
        toolsetRegistry.listServerTools("unknown");
      }).toThrow("Server not found: unknown");
    });
  });

  describe("Tool Execution", () => {
    it("should call tool on specific server", async () => {
      const mockResult = { content: [{ type: "text", text: "Success" }] };
      mockMcpHub.callTool.mockResolvedValue(mockResult);

      const result = await toolsetRegistry.callTool("server1", "test_tool", { arg: "value" });
      
      expect(mockMcpHub.callTool).toHaveBeenCalledWith("server1", "test_tool", { arg: "value" });
      expect(result).toEqual(mockResult);
    });

    it("should handle tool execution errors", async () => {
      const error = new Error("Tool failed");
      mockMcpHub.callTool.mockRejectedValue(error);

      await expect(
        toolsetRegistry.callTool("server1", "test_tool", {})
      ).rejects.toThrow("Failed to execute tool test_tool on server server1: Tool failed");
    });
  });

  describe("Documentation Generation", () => {
    beforeEach(() => {
      mockMcpHub.getAllServerStatuses.mockReturnValue([
        {
          name: "server1",
          displayName: "Test Server",
          status: "connected",
          capabilities: { tools: [{ name: "tool1" }] }
        }
      ]);
      
      mockMcpServerEndpoint.registeredCapabilities.tools = new Map([
        ["server1__tool1", {
          serverName: "server1",
          originalName: "tool1", 
          definition: { name: "server1__tool1" }
        }]
      ]);
    });

    it("should generate markdown documentation", () => {
      const result = toolsetRegistry.getStartHereReadme("markdown");
      
      expect(result).toHaveProperty("content");
      expect(result.content[0].text).toContain("# MCP Hub - Centralized Tool Discovery & Management");
      expect(result.content[0].text).toContain("## Hub Statistics");
      expect(result.content[0].text).toContain("## Connected Servers");
    });

    it("should generate JSON documentation", () => {
      const result = toolsetRegistry.getStartHereReadme("json");
      
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("title");
      expect(parsed).toHaveProperty("stats");
      expect(parsed).toHaveProperty("servers");
    });
  });

  describe("Hub Statistics", () => {
    it("should calculate correct hub statistics", () => {
      mockMcpHub.getAllServerStatuses.mockReturnValue([
        { name: "server1", status: "connected" },
        { name: "server2", status: "disabled" },
        { name: "server3", status: "connected" },
      ]);
      
      mockMcpServerEndpoint.registeredCapabilities.tools = new Map([
        ["tool1", { definition: { name: "tool1", description: "Tool 1" } }],
        ["tool2", { definition: { name: "tool2", description: "Tool 2" } }],
      ]);

      const stats = toolsetRegistry.getHubStats();
      
      expect(stats).toEqual({
        totalServers: 3,
        connectedServers: 2,
        totalTools: 2,
        hubTools: Object.keys(HUB_TOOLS).length
      });
    });
  });

  describe("Tool Chaining", () => {
    it("should handle empty chain", async () => {
      const result = await toolsetRegistry.chainTools({ chain: [] });
      
      expect(result).toHaveProperty("content");
      expect(result.content[0].text).toContain("Empty chain");
      expect(result.isError).toBe(false);
      expect(result.chainResults).toHaveLength(0);
    });
  });
});

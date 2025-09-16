import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolsetRegistry, HUB_TOOLS } from '../src/mcp/toolset-registry.js';
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

describe('Advanced Tool Chaining', () => {
  let registry;
  let mockMcpHub;
  let mockEndpoint;

  beforeEach(() => {
    // Mock MCP Hub with connections
    mockMcpHub = {
      connections: new Map(),
      port: 3000,
      hubServerUrl: 'http://localhost:3000',
      configManager: {
        getConfig: () => ({ mcpServers: {} })
      },
      callTool: vi.fn()
    };

    // Mock server endpoint
    mockEndpoint = {
      registeredCapabilities: {}
    };

    registry = new ToolsetRegistry(mockMcpHub, mockEndpoint);
  });

  describe('Basic Chain Execution', () => {
    it('should execute a simple two-step chain', async () => {
      // Mock tool calls
      mockMcpHub.callTool
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "file content" }],
          isError: false
        })
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "processed content" }],
          isError: false
        });

      const chain = {
        chain: [
          {
            id: "read_file",
            server_name: "filesystem",
            tool_name: "read_file",
            arguments: { path: "/test.txt" }
          },
          {
            id: "process_content",
            server_name: "processor",
            tool_name: "process",
            input_mapping: {
              content: "read_file.content[0].text"
            }
          }
        ]
      };

      const result = await registry.chainTools(chain);

      expect(result.isError).toBe(false);
      expect(result.chainResults).toHaveLength(2);
      expect(result.executionSummary.totalSteps).toBe(2);
      expect(result.executionSummary.executedSteps).toBe(2);
    });

    it('should handle input mapping from previous step', async () => {
      mockMcpHub.callTool
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "file_content.json" }],
          isError: false
        })
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "written successfully" }],
          isError: false
        });

      const chain = {
        chain: [
          {
            server_name: "filesystem",
            tool_name: "read_file",
            arguments: { path: "/config.txt" }
          },
          {
            server_name: "filesystem", 
            tool_name: "write_file",
            input_mapping: {
              path: "PREV.content[0].text"
            },
            arguments: {
              contents: "processed data"
            }
          }
        ],
        execution_options: {
          approval_granted: true  // Required for write operations
        }
      };

      const result = await registry.chainTools(chain);

      expect(mockMcpHub.callTool).toHaveBeenCalledTimes(2);
      expect(mockMcpHub.callTool).toHaveBeenNthCalledWith(
        2,
        "filesystem",
        "write_file", 
        {
          path: "file_content.json",
          contents: "processed data"
        }
      );
    });
  });

  describe('Conditional Execution', () => {
    it('should skip step when condition fails', async () => {
      mockMcpHub.callTool.mockResolvedValueOnce({
        content: [],
        isError: true
      });

      const chain = {
        chain: [
          {
            id: "check_file",
            server_name: "filesystem", 
            tool_name: "read_file",
            arguments: { path: "/missing.txt" }
          },
          {
            server_name: "processor",
            tool_name: "process", 
            conditions: {
              execute_if: "check_file.result.content.length > 0"
            }
          }
        ]
      };

      const result = await registry.chainTools(chain);

      expect(mockMcpHub.callTool).toHaveBeenCalledTimes(1);
      expect(result.chainResults).toHaveLength(1);
    });

    it('should continue execution with skip_on_error', async () => {
      mockMcpHub.callTool
        .mockRejectedValueOnce(new Error("Tool failed"))
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "recovery successful" }],
          isError: false
        });

      const chain = {
        chain: [
          {
            server_name: "unreliable",
            tool_name: "failing_tool",
            conditions: {
              skip_on_error: true
            }
          },
          {
            server_name: "filesystem",
            tool_name: "write_file",
            arguments: { path: "/recovery.txt", contents: "recovered" }
          }
        ],
        execution_options: {
          approval_granted: true  // Required for write operations
        }
      };

      const result = await registry.chainTools(chain);

      expect(result.chainResults).toHaveLength(2);
      expect(result.chainResults[0].skipped).toBe(true);
      expect(result.chainResults[1].result.isError).toBe(false);
    });
  });

  describe('Parallel Execution', () => {
    it('should execute parallel groups concurrently', async () => {
      mockMcpHub.callTool
        .mockResolvedValue({
          content: [{ type: "text", text: "parallel result" }],
          isError: false
        });

      const chain = {
        chain: [
          {
            id: "parallel1",
            server_name: "server1",
            tool_name: "tool1", 
            parallel_group: "group1"
          },
          {
            id: "parallel2", 
            server_name: "server2",
            tool_name: "tool2",
            parallel_group: "group1"
          },
          {
            id: "sequential",
            server_name: "server3",
            tool_name: "tool3"
          }
        ]
      };

      const startTime = Date.now();
      const result = await registry.chainTools(chain);
      const elapsed = Date.now() - startTime;

      expect(result.chainResults).toHaveLength(3);
      expect(result.executionSummary.parallelGroups).toBe(1);
      // Parallel execution should be faster than sequential
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('Data Transformations', () => {
    it('should apply JSON extraction transformation', async () => {
      mockMcpHub.callTool
        .mockResolvedValueOnce({
          content: [{ type: "text", text: '{"name": "test", "value": 123}' }],
          isError: false
        })
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "processing complete" }],
          isError: false
        });

      const chain = {
        chain: [
          {
            server_name: "api",
            tool_name: "fetch_data"
          },
          {
            server_name: "processor",
            tool_name: "process",
            transformations: [
              {
                type: "extract_json",
                source: "raw_data",
                target: "parsed_data"
              }
            ],
            input_mapping: {
              raw_data: "PREV.content[0].text"
            }
          }
        ]
      };

      const result = await registry.chainTools(chain);

      expect(mockMcpHub.callTool).toHaveBeenCalledTimes(2);
      const secondCallArgs = mockMcpHub.callTool.mock.calls[1][2];
      expect(secondCallArgs.parsed_data).toEqual({ name: "test", value: 123 });
    });

    it('should apply template substitution', async () => {
      mockMcpHub.callTool.mockResolvedValueOnce({
        content: [{ type: "text", text: "file written successfully" }],
        isError: false
      });

      const chain = {
        variables: {
          author: "test-user",
          timestamp: "2024-01-01"
        },
        chain: [
          {
            server_name: "filesystem",
            tool_name: "write_file",
            arguments: {
              path: "/reports/{{VARS.author}}-{{VARS.timestamp}}.txt",
              contents: "Report by {{VARS.author}} at {{VARS.timestamp}}"
            }
          }
        ],
        execution_options: {
          approval_granted: true  // Required for write operations
        }
      };

      await registry.chainTools(chain);

      expect(mockMcpHub.callTool).toHaveBeenCalledWith(
        "filesystem",
        "write_file",
        {
          path: "/reports/test-user-2024-01-01.txt", 
          contents: "Report by test-user at 2024-01-01"
        }
      );
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed tools with backoff', async () => {
      mockMcpHub.callTool
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "success on retry" }],
          isError: false
        });

      const chain = {
        chain: [
          {
            server_name: "unreliable",
            tool_name: "network_call",
            retry: {
              max_attempts: 3,
              delay_ms: 100,
              backoff_multiplier: 2
            }
          }
        ]
      };

      const result = await registry.chainTools(chain);

      expect(mockMcpHub.callTool).toHaveBeenCalledTimes(3);
      expect(result.chainResults).toHaveLength(1);
      expect(result.chainResults[0].result.isError).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should fail fast by default', async () => {
      mockMcpHub.callTool
        .mockResolvedValueOnce({ content: [{ type: "text", text: "success" }] })
        .mockRejectedValueOnce(new Error("Step failed"));

      const chain = {
        chain: [
          {
            server_name: "server1",
            tool_name: "tool1"
          },
          {
            server_name: "server2", 
            tool_name: "tool2"
          }
        ]
      };

      await expect(registry.chainTools(chain)).rejects.toThrow();
      expect(mockMcpHub.callTool).toHaveBeenCalledTimes(2);
    });

    it('should handle timeout', async () => {
      mockMcpHub.callTool.mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 1000))
      );

      const chain = {
        chain: [
          {
            server_name: "slow",
            tool_name: "slow_tool"
          }
        ],
        execution_options: {
          timeout_ms: 100
        }
      };

      await expect(registry.chainTools(chain)).rejects.toThrow(/timeout/);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty chain', async () => {
      await expect(registry.chainTools({ chain: [] })).rejects.toThrow(
        "Chain specification validation failed: Chain cannot be empty"
      );
    });

    it('should validate chain structure', async () => {
      await expect(registry.chainTools({ chain: "not an array" }))
        .rejects.toThrow(McpError);
    });

    it('should handle missing server or tool name', async () => {
      const chain = {
        chain: [
          {
            server_name: "server1"
            // missing tool_name
          }
        ]
      };

      await expect(registry.chainTools(chain)).rejects.toThrow(/missing.*tool_name/);
    });
  });
});

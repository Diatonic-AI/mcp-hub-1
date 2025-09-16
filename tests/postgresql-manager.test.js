/**
 * PostgreSQL Manager Comprehensive Test Suite
 * Tests all functionality of the PostgreSQL integration layer
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import PostgreSQLManager from '../src/utils/postgresql-manager.js';
import { Pool } from 'pg';
import { logger } from '../src/utils/logger.js';

// Mock modules
vi.mock('pg');
vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  },
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

describe('PostgreSQL Manager', () => {
  let pgManager;
  let mockPool;
  let mockClient;

  beforeAll(() => {
    // Setup mock pool and client
    mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn()
    };

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      end: vi.fn().mockResolvedValue(undefined),
      totalCount: 10,
      idleCount: 5,
      waitingCount: 0,
      on: vi.fn()
    };

    Pool.mockReturnValue(mockPool);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    pgManager = new PostgreSQLManager();
    
    // Setup default mock responses
    mockClient.query
      .mockReset()
      .mockResolvedValueOnce({ 
        rows: [{ 
          version: 'PostgreSQL 14.5', 
          timestamp: new Date() 
        }], 
        rowCount: 1 
      })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    
    mockPool.query
      .mockReset()
      .mockResolvedValue({ rows: [], rowCount: 0 });
  });

  afterEach(async () => {
    if (pgManager) {
      await pgManager.close();
    }
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', async () => {
      await pgManager.initialize();

      expect(pgManager.initialized).toBe(true);
      expect(Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          max: 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000
        })
      );
    });

    it('should initialize with custom configuration', async () => {
      const customConfig = {
        host: 'custom-host',
        port: 5433,
        database: 'custom-db',
        user: 'custom-user',
        password: 'custom-pass',
        maxConnections: 20
      };

      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await pgManager.initialize(customConfig);

      expect(Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'custom-host',
          port: 5433,
          database: 'custom-db',
          user: 'custom-user',
          password: 'custom-pass',
          max: 20
        })
      );
    });

    it('should create schemas on initialization', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await pgManager.initialize();

      // Check schema creation queries
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE SCHEMA IF NOT EXISTS mcp_hub')
      );
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE SCHEMA IF NOT EXISTS logs')
      );
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE SCHEMA IF NOT EXISTS analytics')
      );
    });

    it('should set up health monitoring interval', async () => {
      vi.useFakeTimers();
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await pgManager.initialize();

      expect(pgManager.healthInterval).toBeDefined();

      // Fast forward time to trigger health check
      vi.advanceTimersByTime(10000);

      expect(mockPool.query).toHaveBeenCalledWith('SELECT 1');

      vi.useRealTimers();
    });

    it('should emit initialized event', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const initSpy = vi.fn();
      pgManager.on('initialized', initSpy);

      await pgManager.initialize();

      expect(initSpy).toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      mockPool.query.mockRejectedValue(new Error('Connection failed'));

      await expect(pgManager.initialize()).rejects.toThrow('Connection failed');
      expect(pgManager.initialized).toBe(false);
    });
  });

  describe('Server Management', () => {
    beforeEach(async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      await pgManager.initialize();
      vi.clearAllMocks();
    });

    it('should upsert a new server', async () => {
      const serverConfig = {
        name: 'test-server',
        displayName: 'Test Server',
        endpoint: 'ws://localhost:3000',
        transportType: 'websocket',
        status: 'connected',
        capabilities: { tools: true, resources: false },
        metadata: { version: '1.0.0' },
        config: { timeout: 5000 }
      };

      const mockResult = {
        rows: [{ id: 1, ...serverConfig }],
        rowCount: 1
      };

      mockPool.query.mockResolvedValue(mockResult);

      const result = await pgManager.upsertServer(serverConfig);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO mcp_hub.servers'),
        expect.arrayContaining([
          'test-server',
          'Test Server',
          'ws://localhost:3000',
          'websocket',
          'connected'
        ])
      );

      expect(result).toEqual(mockResult.rows[0]);
    });

    it('should update an existing server', async () => {
      const serverConfig = {
        name: 'existing-server',
        status: 'disconnected'
      };

      const mockResult = {
        rows: [{ id: 1, name: 'existing-server', status: 'disconnected' }],
        rowCount: 1
      };

      mockPool.query.mockResolvedValue(mockResult);

      await pgManager.upsertServer(serverConfig);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (name) DO UPDATE'),
        expect.any(Array)
      );
    });

    it('should emit serverUpserted event', async () => {
      const serverSpy = vi.fn();
      pgManager.on('serverUpserted', serverSpy);

      const mockResult = {
        rows: [{ id: 1, name: 'test-server' }],
        rowCount: 1
      };

      mockPool.query.mockResolvedValue(mockResult);

      await pgManager.upsertServer({ name: 'test-server' });

      expect(serverSpy).toHaveBeenCalledWith(mockResult.rows[0]);
    });

    it('should log server status changes', async () => {
      const mockResult = {
        rows: [{ id: 1, server_name: 'test-server', status: 'connected' }],
        rowCount: 1
      };

      mockPool.query.mockResolvedValue(mockResult);

      const result = await pgManager.logServerStatusChange(
        'test-server',
        'connected',
        'disconnected',
        3600,
        { reason: 'reconnected' }
      );

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO analytics.server_status_history'),
        ['test-server', 'connected', 'disconnected', 3600, expect.any(String)]
      );

      expect(result).toEqual(mockResult.rows[0]);
    });
  });

  describe('Tool Management', () => {
    beforeEach(async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      await pgManager.initialize();
      vi.clearAllMocks();
    });

    it('should upsert a new tool', async () => {
      const toolConfig = {
        name: 'test-tool',
        description: 'A test tool',
        inputSchema: { type: 'object' },
        category: 'testing',
        metadata: { author: 'test' },
        version: '1.0.0',
        tags: ['test', 'demo']
      };

      const mockResult = {
        rows: [{
          tool_id: 'test-server__test-tool',
          ...toolConfig
        }],
        rowCount: 1
      };

      mockPool.query.mockResolvedValue(mockResult);

      const result = await pgManager.upsertTool('test-server', toolConfig);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO mcp_hub.tools'),
        expect.arrayContaining([
          'test-server__test-tool',
          'test-tool',
          'test-tool',
          'test-server',
          'A test tool'
        ])
      );

      expect(result.tool_id).toBe('test-server__test-tool');
    });

    it('should handle tool with minimal config', async () => {
      const mockResult = {
        rows: [{
          tool_id: 'server__minimal',
          name: 'minimal'
        }],
        rowCount: 1
      };

      mockPool.query.mockResolvedValue(mockResult);

      const result = await pgManager.upsertTool('server', { name: 'minimal' });

      expect(result.tool_id).toBe('server__minimal');
    });

    it('should emit toolUpserted event', async () => {
      const toolSpy = vi.fn();
      pgManager.on('toolUpserted', toolSpy);

      const mockResult = {
        rows: [{ tool_id: 'server__tool' }],
        rowCount: 1
      };

      mockPool.query.mockResolvedValue(mockResult);

      await pgManager.upsertTool('server', { name: 'tool' });

      expect(toolSpy).toHaveBeenCalledWith(mockResult.rows[0]);
    });

    it('should search tools with filters', async () => {
      const mockResult = {
        rows: [
          { tool_id: 'server1__tool1', name: 'tool1', usage_count: 10 },
          { tool_id: 'server2__tool2', name: 'tool2', usage_count: 5 }
        ],
        rowCount: 2
      };

      mockPool.query.mockResolvedValue(mockResult);

      const results = await pgManager.searchTools({
        query: 'tool',
        serverName: 'server1',
        category: 'general',
        minUsage: 5,
        sortBy: 'usage_count',
        sortOrder: 'DESC',
        limit: 10,
        offset: 0
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE'),
        expect.arrayContaining(['%tool%', 'server1', 'general', 5, 10, 0])
      );

      expect(results).toEqual(mockResult.rows);
    });
  });

  describe('Execution Logging', () => {
    beforeEach(async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      await pgManager.initialize();
      vi.clearAllMocks();
    });

    it('should log successful tool execution', async () => {
      const executionInfo = {
        toolId: 'server__tool',
        serverName: 'server',
        toolName: 'tool',
        arguments: { param1: 'value1' },
        result: { output: 'success' },
        status: 'completed',
        durationMs: 150,
        startedAt: new Date('2025-01-20T10:00:00Z'),
        completedAt: new Date('2025-01-20T10:00:00.150Z')
      };

      const mockResult = {
        rows: [{ execution_id: 'exec_123', ...executionInfo }],
        rowCount: 1
      };

      mockPool.query
        .mockResolvedValueOnce(mockResult) // Insert execution
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // Update tool stats

      const result = await pgManager.logToolExecution(executionInfo);

      // Check execution log insert
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO logs.tool_executions'),
        expect.arrayContaining([
          expect.stringContaining('exec_'),
          'server__tool',
          'server',
          'tool'
        ])
      );

      // Check tool stats update
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE mcp_hub.tools'),
        expect.arrayContaining(['server__tool'])
      );

      expect(result).toEqual(mockResult.rows[0]);
    });

    it('should log failed tool execution', async () => {
      const executionInfo = {
        toolId: 'server__tool',
        serverName: 'server',
        toolName: 'tool',
        success: false,
        errorMessage: 'Tool failed',
        executionTimeMs: 50
      };

      const mockResult = {
        rows: [{ execution_id: 'exec_456', status: 'error' }],
        rowCount: 1
      };

      mockPool.query
        .mockResolvedValueOnce(mockResult)
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await pgManager.logToolExecution(executionInfo);

      expect(result.status).toBe('error');
    });

    it('should emit toolExecutionLogged event', async () => {
      const execSpy = vi.fn();
      pgManager.on('toolExecutionLogged', execSpy);

      const mockResult = {
        rows: [{ execution_id: 'exec_789' }],
        rowCount: 1
      };

      mockPool.query
        .mockResolvedValueOnce(mockResult)
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await pgManager.logToolExecution({
        toolId: 'server__tool',
        serverName: 'server',
        toolName: 'tool'
      });

      expect(execSpy).toHaveBeenCalledWith(mockResult.rows[0]);
    });
  });

  describe('Hub Events', () => {
    beforeEach(async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      await pgManager.initialize();
      vi.clearAllMocks();
    });

    it('should log hub events', async () => {
      const eventInfo = {
        type: 'server_connected',
        data: { serverName: 'test-server' },
        level: 'info',
        message: 'Server connected successfully',
        source: 'hub',
        metadata: { timestamp: Date.now() }
      };

      const mockResult = {
        rows: [{ id: 1, ...eventInfo }],
        rowCount: 1
      };

      mockPool.query.mockResolvedValue(mockResult);

      const result = await pgManager.logHubEvent(eventInfo);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO logs.hub_events'),
        expect.arrayContaining([
          'server_connected',
          expect.any(String), // JSON stringified data
          'info',
          'Server connected successfully',
          'hub'
        ])
      );

      expect(result).toEqual(mockResult.rows[0]);
    });

    it('should handle minimal event info', async () => {
      const mockResult = {
        rows: [{ id: 1, event_type: 'test' }],
        rowCount: 1
      };

      mockPool.query.mockResolvedValue(mockResult);

      const result = await pgManager.logHubEvent({ type: 'test' });

      expect(result.event_type).toBe('test');
    });

    it('should emit hubEventLogged event', async () => {
      const eventSpy = vi.fn();
      pgManager.on('hubEventLogged', eventSpy);

      const mockResult = {
        rows: [{ id: 1, event_type: 'test' }],
        rowCount: 1
      };

      mockPool.query.mockResolvedValue(mockResult);

      await pgManager.logHubEvent({ type: 'test' });

      expect(eventSpy).toHaveBeenCalledWith(mockResult.rows[0]);
    });
  });

  describe('Analytics', () => {
    beforeEach(async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      await pgManager.initialize();
      vi.clearAllMocks();
    });

    it('should get server analytics', async () => {
      const mockResult = {
        rows: [{
          name: 'test-server',
          display_name: 'Test Server',
          status: 'connected',
          connection_count: 10,
          error_count: 2,
          tool_count: 5,
          total_tool_usage: 100,
          recent_executions: 20,
          avg_execution_time: 150,
          success_rate: 95.0
        }],
        rowCount: 1
      };

      mockPool.query.mockResolvedValue(mockResult);

      const results = await pgManager.getServerAnalytics('test-server', '24 hours');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WITH server_stats AS'),
        ['test-server']
      );

      expect(results).toEqual(mockResult.rows);
    });

    it('should get all servers analytics when no server specified', async () => {
      const mockResult = {
        rows: [
          { name: 'server1', status: 'connected' },
          { name: 'server2', status: 'disconnected' }
        ],
        rowCount: 2
      };

      mockPool.query.mockResolvedValue(mockResult);

      const results = await pgManager.getServerAnalytics(null, '7 days');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WITH server_stats AS'),
        []
      );

      expect(results).toHaveLength(2);
    });

    it('should get tool analytics', async () => {
      const mockResult = {
        rows: [
          {
            tool_id: 'server__tool1',
            name: 'tool1',
            total_usage: 100,
            recent_executions: 10,
            success_rate: 90.0
          },
          {
            tool_id: 'server__tool2',
            name: 'tool2',
            total_usage: 50,
            recent_executions: 5,
            success_rate: 100.0
          }
        ],
        rowCount: 2
      };

      mockPool.query.mockResolvedValue(mockResult);

      const results = await pgManager.getToolAnalytics(10, '24 hours');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WITH tool_stats AS'),
        [10]
      );

      expect(results).toEqual(mockResult.rows);
    });

    it('should get hub metrics', async () => {
      const mockResult = {
        rows: [{
          total_servers: 5,
          connected_servers: 3,
          total_tools: 25,
          recent_executions: 100,
          avg_execution_time: 200,
          recent_events: 500,
          recent_errors: 10
        }],
        rowCount: 1
      };

      mockPool.query.mockResolvedValue(mockResult);

      const result = await pgManager.getHubMetrics('24 hours');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT COUNT(*) FROM mcp_hub.servers')
      );

      expect(result).toEqual(mockResult.rows[0]);
    });

    it('should get comprehensive analytics', async () => {
      const hubMetrics = {
        total_servers: 5,
        connected_servers: 3
      };

      const serverAnalytics = [
        { name: 'server1', status: 'connected' }
      ];

      const toolAnalytics = [
        { tool_id: 'server__tool1', usage_count: 100 }
      ];

      mockPool.query
        .mockResolvedValueOnce({ rows: [hubMetrics] }) // Hub metrics
        .mockResolvedValueOnce({ rows: serverAnalytics }) // Server analytics
        .mockResolvedValueOnce({ rows: toolAnalytics }); // Tool analytics

      const results = await pgManager.getAnalytics('24 hours');

      expect(results).toEqual({
        hub: hubMetrics,
        servers: serverAnalytics,
        topTools: toolAnalytics,
        timestamp: expect.any(String),
        timeRange: '24 hours'
      });
    });
  });

  describe('Data Cleanup', () => {
    beforeEach(async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      await pgManager.initialize();
      vi.clearAllMocks();
    });

    it('should clean up old data', async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rowCount: 100 }) // Delete executions
        .mockResolvedValueOnce({ rowCount: 50 }) // Delete status history
        .mockResolvedValueOnce({ rowCount: 200 }) // Delete events
        .mockResolvedValueOnce({ rowCount: 10 }) // Delete error events
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await pgManager.cleanupOldData(30);

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM logs.tool_executions'),
        expect.any(Array)
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');

      expect(result).toEqual({
        executionsRemoved: 100,
        statusHistoryRemoved: 50,
        eventsRemoved: 200,
        errorEventsRemoved: 10,
        retentionDays: 30,
        cleanupDate: expect.any(String)
      });
    });

    it('should rollback on cleanup error', async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(new Error('Delete failed')); // Error during delete

      await expect(pgManager.cleanupOldData(30)).rejects.toThrow();

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should emit cleanupCompleted event', async () => {
      const cleanupSpy = vi.fn();
      pgManager.on('cleanupCompleted', cleanupSpy);

      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rowCount: 10 })
        .mockResolvedValueOnce({ rowCount: 5 })
        .mockResolvedValueOnce({ rowCount: 20 })
        .mockResolvedValueOnce({ rowCount: 2 })
        .mockResolvedValueOnce(undefined); // COMMIT

      await pgManager.cleanupOldData(30);

      expect(cleanupSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          executionsRemoved: 10,
          retentionDays: 30
        })
      );
    });
  });

  describe('Connection Pool Management', () => {
    it('should get pool status when initialized', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      await pgManager.initialize();

      const status = pgManager.getPoolStatus();

      expect(status).toEqual({
        status: 'active',
        totalCount: 10,
        idleCount: 5,
        waitingCount: 0,
        queries: 0,
        errors: 0,
        totalDuration: 0,
        avgDuration: 0
      });
    });

    it('should return not_initialized status when not initialized', () => {
      const status = pgManager.getPoolStatus();

      expect(status).toEqual({
        status: 'not_initialized'
      });
    });

    it('should close connection pool', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      await pgManager.initialize();

      await pgManager.close();

      expect(mockPool.end).toHaveBeenCalled();
      expect(pgManager.pool).toBeNull();
      expect(pgManager.initialized).toBe(false);
    });

    it('should emit closed event', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      await pgManager.initialize();

      const closeSpy = vi.fn();
      pgManager.on('closed', closeSpy);

      await pgManager.close();

      expect(closeSpy).toHaveBeenCalled();
    });

    it('should handle close when not initialized', async () => {
      pgManager.pool = null;
      
      await pgManager.close();

      expect(mockPool.end).not.toHaveBeenCalled();
    });
  });

  describe('Query Execution', () => {
    beforeEach(async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      await pgManager.initialize();
      vi.clearAllMocks();
    });

    it('should execute query with statistics tracking', async () => {
      const mockResult = { rows: [{ id: 1 }], rowCount: 1 };
      mockPool.query.mockResolvedValue(mockResult);

      const result = await pgManager.query('SELECT * FROM test', []);

      expect(pgManager.stats.queries).toBe(1);
      expect(result).toEqual(mockResult);
    });

    it('should track query errors', async () => {
      mockPool.query.mockRejectedValue(new Error('Query failed'));

      await expect(pgManager.query('SELECT * FROM test', [])).rejects.toThrow();

      expect(pgManager.stats.errors).toBe(1);
    });

    it('should calculate average query duration', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      // Execute multiple queries
      await pgManager.query('SELECT 1', []);
      await pgManager.query('SELECT 2', []);

      expect(pgManager.stats.queries).toBe(2);
      expect(pgManager.stats.avgDuration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      await pgManager.initialize();
      vi.clearAllMocks();
    });

    it('should wrap errors with McpError', async () => {
      mockPool.query.mockRejectedValue(new Error('Database error'));

      try {
        await pgManager.upsertServer({ name: 'test' });
      } catch (error) {
        expect(error.code).toBe('DATABASE_ERROR');
        expect(error.message).toContain('Database error');
      }
    });

    it('should handle connection errors in health check', async () => {
      vi.useFakeTimers();
      
      mockPool.query.mockRejectedValue(new Error('Connection lost'));

      // Trigger health check
      vi.advanceTimersByTime(10000);

      // Should log warning but not throw
      expect(logger.warn).toHaveBeenCalledWith(
        'PostgreSQL health check failed',
        expect.any(Object)
      );

      vi.useRealTimers();
    });
  });

  describe('Event Emissions', () => {
    beforeEach(async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      await pgManager.initialize();
      vi.clearAllMocks();
    });

    it('should emit all expected events', async () => {
      const events = {
        serverUpserted: vi.fn(),
        toolUpserted: vi.fn(),
        toolExecutionLogged: vi.fn(),
        serverStatusLogged: vi.fn(),
        hubEventLogged: vi.fn(),
        cleanupCompleted: vi.fn()
      };

      Object.entries(events).forEach(([event, handler]) => {
        pgManager.on(event, handler);
      });

      // Trigger various operations
      mockPool.query.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
      
      await pgManager.upsertServer({ name: 'test' });
      expect(events.serverUpserted).toHaveBeenCalled();

      await pgManager.upsertTool('server', { name: 'tool' });
      expect(events.toolUpserted).toHaveBeenCalled();

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await pgManager.logToolExecution({ toolId: 'test', serverName: 'server', toolName: 'tool' });
      expect(events.toolExecutionLogged).toHaveBeenCalled();

      mockPool.query.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
      await pgManager.logServerStatusChange('server', 'connected', 'disconnected');
      expect(events.serverStatusLogged).toHaveBeenCalled();

      await pgManager.logHubEvent({ type: 'test' });
      expect(events.hubEventLogged).toHaveBeenCalled();
    });
  });
});

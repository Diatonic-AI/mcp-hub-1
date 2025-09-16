/**
 * Analytics Service for MCP Hub Telemetry
 * Provides query, aggregation, and pattern mining capabilities
 */

import Pool from 'pg-pool';
import { MongoClient } from 'mongodb';
import logger from '../utils/logger.js';
import { qdrantClient } from './qdrant.js';
import { streamManager, STREAMS } from './streams.js';

// Configuration
const CONFIG = {
  postgresConfig: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'mcp_hub',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    max: 5,
    idleTimeoutMillis: 30000
  },
  mongoConfig: {
    url: process.env.MONGODB_URL || 'mongodb://localhost:27017',
    database: process.env.MONGODB_DB || 'mcp_telemetry'
  }
};

/**
 * Analytics Service
 * Handles all telemetry queries and aggregations
 */
export class AnalyticsService {
  constructor(config = {}) {
    this.config = { ...CONFIG, ...config };
    this.pgPool = null;
    this.mongoClient = null;
    this.mongoDb = null;
    this.isInitialized = false;
  }

  /**
   * Initialize connections
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      // Initialize PostgreSQL
      this.pgPool = new Pool(this.config.postgresConfig);
      await this.pgPool.query('SELECT 1');

      // Initialize MongoDB
      this.mongoClient = new MongoClient(this.config.mongoConfig.url);
      await this.mongoClient.connect();
      this.mongoDb = this.mongoClient.db(this.config.mongoConfig.database);

      // Initialize other components
      await qdrantClient.initialize();
      await streamManager.initialize();

      this.isInitialized = true;
      logger.info('ANALYTICS_SERVICE_READY', 'Analytics service initialized');
    } catch (error) {
      logger.error('ANALYTICS_SERVICE_INIT_ERROR', 'Failed to initialize analytics', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get aggregated metrics
   */
  async getMetrics(filters = {}) {
    await this.ensureInitialized();

    const { 
      server, 
      tool, 
      bucket = 'hour',
      startTime,
      endTime,
      tenant = 'default',
      limit = 100
    } = filters;

    try {
      // Build query based on bucket type
      let query;
      let params = [];
      let paramIndex = 1;

      if (bucket === 'hour') {
        query = `
          SELECT 
            hour_bucket as timestamp,
            tenant,
            server,
            tool,
            call_count,
            success_count,
            error_count,
            latency_p50,
            latency_p95,
            latency_p99,
            ROUND(100.0 * error_count / NULLIF(call_count, 0), 2) as error_rate
          FROM telemetry.tool_agg_hour
          WHERE tenant = $${paramIndex++}
        `;
        params.push(tenant);
      } else {
        // Real-time query from raw events
        const bucketInterval = bucket === 'minute' ? '1 minute' : '1 hour';
        query = `
          SELECT 
            date_trunc('${bucket}', timestamp_ms) as timestamp,
            tenant,
            server,
            tool,
            COUNT(*) as call_count,
            COUNT(*) FILTER (WHERE status = 'success') as success_count,
            COUNT(*) FILTER (WHERE status = 'error') as error_count,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) as latency_p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) as latency_p95,
            percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) as latency_p99,
            ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'error') / NULLIF(COUNT(*), 0), 2) as error_rate
          FROM telemetry.event
          WHERE tenant = $${paramIndex++}
            AND type = 'mcp.call.complete'
        `;
        params.push(tenant);
      }

      // Add filters
      if (server) {
        query += ` AND server = $${paramIndex++}`;
        params.push(server);
      }
      
      if (tool) {
        query += ` AND tool = $${paramIndex++}`;
        params.push(tool);
      }

      if (startTime) {
        query += ` AND ${bucket === 'hour' ? 'hour_bucket' : 'timestamp_ms'} >= $${paramIndex++}`;
        params.push(startTime);
      }

      if (endTime) {
        query += ` AND ${bucket === 'hour' ? 'hour_bucket' : 'timestamp_ms'} <= $${paramIndex++}`;
        params.push(endTime);
      }

      // Add group by for real-time queries
      if (bucket !== 'hour') {
        query += ` GROUP BY date_trunc('${bucket}', timestamp_ms), tenant, server, tool`;
      }

      // Add ordering and limit
      query += ` ORDER BY timestamp DESC LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await this.pgPool.query(query, params);

      return {
        metrics: result.rows,
        count: result.rows.length,
        bucket,
        filters
      };
    } catch (error) {
      logger.error('ANALYTICS_METRICS_ERROR', 'Failed to get metrics', {
        error: error.message,
        filters
      });
      throw error;
    }
  }

  /**
   * Get pattern analysis
   */
  async getPatterns(filters = {}) {
    await this.ensureInitialized();

    const {
      server,
      tool,
      tenant = 'default',
      limit = 50,
      minSupport = 0.01
    } = filters;

    try {
      const query = `
        SELECT 
          pattern,
          occurrence_count,
          servers,
          tools,
          first_seen,
          last_seen,
          confidence_score
        FROM telemetry.pattern_sequence
        WHERE tenant = $1
          AND support >= $2
          ${server ? 'AND $3 = ANY(servers)' : ''}
          ${tool ? 'AND $4 = ANY(tools)' : ''}
        ORDER BY occurrence_count DESC
        LIMIT $${server && tool ? 5 : server || tool ? 4 : 3}
      `;

      const params = [tenant, minSupport];
      if (server) params.push(server);
      if (tool) params.push(tool);
      params.push(limit);

      const result = await this.pgPool.query(query, params);

      return {
        patterns: result.rows,
        count: result.rows.length,
        filters
      };
    } catch (error) {
      logger.error('ANALYTICS_PATTERNS_ERROR', 'Failed to get patterns', {
        error: error.message,
        filters
      });
      throw error;
    }
  }

  /**
   * Get anomalies
   */
  async getAnomalies(filters = {}) {
    await this.ensureInitialized();

    const {
      since,
      severity,
      type,
      tenant = 'default',
      limit = 100
    } = filters;

    try {
      let query = `
        SELECT 
          a.id,
          a.type,
          a.event_id,
          a.severity,
          a.description,
          a.metadata,
          a.created_at,
          e.server,
          e.tool,
          e.latency_ms
        FROM telemetry.anomaly a
        LEFT JOIN telemetry.event e ON a.event_id = e.id
        WHERE e.tenant = $1
      `;
      
      const params = [tenant];
      let paramIndex = 2;

      if (since) {
        query += ` AND a.created_at >= $${paramIndex++}`;
        params.push(since);
      }

      if (severity) {
        query += ` AND a.severity = $${paramIndex++}`;
        params.push(severity);
      }

      if (type) {
        query += ` AND a.type = $${paramIndex++}`;
        params.push(type);
      }

      query += ` ORDER BY a.created_at DESC LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await this.pgPool.query(query, params);

      return {
        anomalies: result.rows,
        count: result.rows.length,
        filters
      };
    } catch (error) {
      logger.error('ANALYTICS_ANOMALIES_ERROR', 'Failed to get anomalies', {
        error: error.message,
        filters
      });
      throw error;
    }
  }

  /**
   * Semantic search
   */
  async semanticSearch(params = {}) {
    await this.ensureInitialized();

    const {
      text,
      vector = 'output_text',
      topK = 20,
      scope = 'all',
      server,
      tool,
      tenant = 'default'
    } = params;

    try {
      // Build filter
      const filter = {
        must: [
          { key: 'tenant', match: { value: tenant } }
        ]
      };

      if (server) {
        filter.must.push({ key: 'server', match: { value: server } });
      }

      if (tool) {
        filter.must.push({ key: 'tool', match: { value: tool } });
      }

      if (scope !== 'all') {
        filter.must.push({ key: 'text_kind', match: { value: scope } });
      }

      // Search in Qdrant
      const results = await qdrantClient.search({
        text,
        vector,
        filter,
        limit: topK
      });

      // Enrich results with event data
      if (results.length > 0) {
        const eventIds = results.map(r => r.payload.event_id).filter(Boolean);
        
        if (eventIds.length > 0) {
          const eventQuery = `
            SELECT id, server, tool, status, latency_ms, timestamp_ms
            FROM telemetry.event
            WHERE id = ANY($1)
          `;
          
          const eventResult = await this.pgPool.query(eventQuery, [eventIds]);
          const eventMap = new Map(eventResult.rows.map(r => [r.id, r]));
          
          // Merge event data with search results
          results.forEach(result => {
            const event = eventMap.get(result.payload.event_id);
            if (event) {
              result.event = event;
            }
          });
        }
      }

      return {
        results,
        count: results.length,
        params
      };
    } catch (error) {
      logger.error('ANALYTICS_SEARCH_ERROR', 'Failed to perform semantic search', {
        error: error.message,
        params
      });
      throw error;
    }
  }

  /**
   * Get similar events
   */
  async getSimilarEvents(eventId) {
    await this.ensureInitialized();

    try {
      // Get the original event's embedding reference
      const embQuery = `
        SELECT collection_name, vector_names
        FROM telemetry.embedding_ref
        WHERE event_id = $1
        LIMIT 1
      `;
      
      const embResult = await this.pgPool.query(embQuery, [eventId]);
      
      if (embResult.rows.length === 0) {
        return { similar: [], message: 'No embeddings found for this event' };
      }

      const vectorName = embResult.rows[0].vector_names[0] || 'output_text';

      // Search for similar points using the event's own vector
      const similar = await qdrantClient.searchSimilar({
        pointId: eventId,
        vector: vectorName,
        limit: 10
      });

      return {
        similar: similar.filter(s => s.id !== eventId),
        eventId,
        vectorUsed: vectorName
      };
    } catch (error) {
      logger.error('ANALYTICS_SIMILAR_ERROR', 'Failed to find similar events', {
        error: error.message,
        eventId
      });
      throw error;
    }
  }

  /**
   * Get health status
   */
  async getHealth() {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      components: {}
    };

    // Check PostgreSQL
    try {
      await this.pgPool.query('SELECT 1');
      health.components.postgresql = { status: 'healthy' };
    } catch (error) {
      health.status = 'degraded';
      health.components.postgresql = { 
        status: 'error', 
        error: error.message 
      };
    }

    // Check MongoDB
    try {
      await this.mongoDb.command({ ping: 1 });
      health.components.mongodb = { status: 'healthy' };
    } catch (error) {
      health.status = 'degraded';
      health.components.mongodb = { 
        status: 'error', 
        error: error.message 
      };
    }

    // Check Qdrant
    try {
      const info = await qdrantClient.getCollectionInfo();
      health.components.qdrant = { 
        status: 'healthy',
        points: info?.points_count || 0
      };
    } catch (error) {
      health.status = 'degraded';
      health.components.qdrant = { 
        status: 'error', 
        error: error.message 
      };
    }

    // Check Redis
    try {
      const stats = streamManager.getStreamStats();
      health.components.redis = { 
        status: streamManager.isConnected() ? 'healthy' : 'disconnected',
        streams: stats
      };
    } catch (error) {
      health.status = 'degraded';
      health.components.redis = { 
        status: 'error', 
        error: error.message 
      };
    }

    return health;
  }

  /**
   * Get summary statistics
   */
  async getSummary(tenant = 'default') {
    await this.ensureInitialized();

    try {
      const summaryQuery = `
        WITH recent_stats AS (
          SELECT 
            COUNT(*) as total_calls,
            COUNT(DISTINCT server) as unique_servers,
            COUNT(DISTINCT tool) as unique_tools,
            COUNT(DISTINCT session_id) as unique_sessions,
            AVG(latency_ms) as avg_latency,
            MAX(latency_ms) as max_latency,
            COUNT(*) FILTER (WHERE status = 'error') as total_errors,
            MAX(timestamp_ms) as last_event
          FROM telemetry.event
          WHERE tenant = $1
            AND timestamp_ms >= NOW() - INTERVAL '24 hours'
            AND type = 'mcp.call.complete'
        ),
        anomaly_stats AS (
          SELECT 
            COUNT(*) as anomaly_count,
            COUNT(*) FILTER (WHERE severity = 'high') as high_severity
          FROM telemetry.anomaly
          WHERE created_at >= NOW() - INTERVAL '24 hours'
        )
        SELECT 
          r.*,
          a.anomaly_count,
          a.high_severity
        FROM recent_stats r, anomaly_stats a
      `;

      const result = await this.pgPool.query(summaryQuery, [tenant]);
      const stats = result.rows[0] || {};

      return {
        summary: {
          totalCalls: parseInt(stats.total_calls || 0),
          uniqueServers: parseInt(stats.unique_servers || 0),
          uniqueTools: parseInt(stats.unique_tools || 0),
          uniqueSessions: parseInt(stats.unique_sessions || 0),
          avgLatency: Math.round(stats.avg_latency || 0),
          maxLatency: Math.round(stats.max_latency || 0),
          errorRate: stats.total_calls > 0 
            ? Math.round(100 * stats.total_errors / stats.total_calls) 
            : 0,
          anomalyCount: parseInt(stats.anomaly_count || 0),
          highSeverityAnomalies: parseInt(stats.high_severity || 0),
          lastEvent: stats.last_event
        },
        tenant,
        period: '24h'
      };
    } catch (error) {
      logger.error('ANALYTICS_SUMMARY_ERROR', 'Failed to get summary', {
        error: error.message,
        tenant
      });
      throw error;
    }
  }

  /**
   * Ensure service is initialized
   */
  async ensureInitialized() {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  /**
   * Close connections
   */
  async close() {
    if (this.pgPool) {
      await this.pgPool.end();
    }
    if (this.mongoClient) {
      await this.mongoClient.close();
    }
    this.isInitialized = false;
  }
}

// Export singleton instance
export const analyticsService = new AnalyticsService();

// Export for testing
export default AnalyticsService;

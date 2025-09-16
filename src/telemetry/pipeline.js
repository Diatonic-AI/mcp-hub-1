/**
 * Telemetry Pipeline Orchestrator for MCP Hub
 * Consumes events from Redis streams and processes through the full pipeline
 * Manages feature extraction, persistence, embedding generation, and anomaly detection
 */

import { v7 as uuidv7 } from 'uuid';
import Pool from 'pg-pool';
import { MongoClient } from 'mongodb';
import logger from '../utils/logger.js';
import { streamManager, STREAMS } from './streams.js';
import { telemetryEnvelope } from './envelope.js';
import { qdrantClient } from './qdrant.js';
import { lmStudioClient } from './lm-studio-client.js';
import { EnhancedMLTelemetryMetrics as TelemetryCollector } from '../services/telemetry/ml-telemetry-enhanced-metrics.js';

// Configuration
const CONFIG = {
  // Pipeline settings
  enabled: process.env.TELEMETRY_PIPELINE_ENABLED !== 'false',
  consumerGroup: process.env.TELEMETRY_CONSUMER_GROUP || 'pipeline',
  consumerId: process.env.TELEMETRY_CONSUMER_ID || `pipeline-${process.pid}`,
  batchSize: parseInt(process.env.TELEMETRY_BATCH_SIZE || '100'),
  processingInterval: parseInt(process.env.TELEMETRY_PROCESS_INTERVAL || '1000'),
  
  // Database connections
  postgresConfig: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'mcp_hub',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    max: parseInt(process.env.POSTGRES_POOL_SIZE || '10'),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  },
  
  mongoConfig: {
    url: process.env.MONGODB_URL || 'mongodb://localhost:27017',
    database: process.env.MONGODB_DB || 'mcp_telemetry',
    options: {
      maxPoolSize: parseInt(process.env.MONGODB_POOL_SIZE || '10'),
      serverSelectionTimeoutMS: 5000
    }
  },
  
  // Feature extraction
  featureExtractionEnabled: process.env.FEATURE_EXTRACTION_ENABLED !== 'false',
  
  // Embedding generation
  embeddingEnabled: process.env.EMBEDDING_ENABLED !== 'false',
  embeddingBatchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE || '10'),
  
  // Anomaly detection
  anomalyDetectionEnabled: process.env.ANOMALY_DETECTION_ENABLED !== 'false',
  anomalyThreshold: parseFloat(process.env.ANOMALY_THRESHOLD || '0.85')
};

/**
 * Feature Extractor
 * Extracts ML features from telemetry events
 */
class FeatureExtractor {
  constructor() {
    this.collector = new TelemetryCollector({
      contextLimitBytes: 50000,
      sampleRate: 1.0
    });
  }

  /**
   * Extract features from event
   */
  async extractFeatures(event) {
    const features = {
      id: uuidv7(),
      event_id: event.id,
      timestamp_ms: event.timestamp_ms || Date.now(),
      type: event.type,
      
      // Basic metrics
      latency_ms: event.latency_ms,
      status: event.status,
      
      // Token analytics (if available)
      token_count: null,
      token_efficiency: null,
      
      // Context optimization
      context_size: null,
      context_utilization: null,
      
      // Tool interaction entropy
      interaction_entropy: null,
      tool_diversity: null,
      
      // Semantic features
      semantic_drift: null,
      embedding_distance: null
    };

    // Extract based on event type
    switch (event.type) {
      case 'mcp.call.complete':
        features.token_count = this.countTokens(event);
        features.context_size = this.measureContextSize(event);
        features.interaction_entropy = this.calculateEntropy(event);
        break;
        
      case 'mcp.connection':
        features.connection_state = event.connection_state;
        features.connection_duration = event.duration_ms;
        break;
        
      case 'mcp.server':
        features.server_count = event.servers?.length || 0;
        features.server_changes = event.changes?.length || 0;
        break;
    }

    return features;
  }

  /**
   * Count tokens in event (simplified)
   */
  countTokens(event) {
    let count = 0;
    
    // Count input tokens
    if (event.args) {
      const argStr = JSON.stringify(event.args);
      count += Math.ceil(argStr.length / 4); // Approximate
    }
    
    // Count output tokens
    if (event.output) {
      const outStr = JSON.stringify(event.output);
      count += Math.ceil(outStr.length / 4); // Approximate
    }
    
    return count;
  }

  /**
   * Measure context size
   */
  measureContextSize(event) {
    const contextStr = JSON.stringify({
      args: event.args,
      output: event.output
    });
    return contextStr.length;
  }

  /**
   * Calculate interaction entropy
   */
  calculateEntropy(event) {
    // Simplified entropy calculation
    const tools = [event.tool];
    const frequency = {};
    
    for (const tool of tools) {
      frequency[tool] = (frequency[tool] || 0) + 1;
    }
    
    let entropy = 0;
    const total = tools.length;
    
    for (const count of Object.values(frequency)) {
      const p = count / total;
      if (p > 0) {
        entropy -= p * Math.log2(p);
      }
    }
    
    return entropy;
  }
}

/**
 * Telemetry Pipeline
 * Main orchestrator for processing telemetry events
 */
export class TelemetryPipeline {
  constructor(config = {}) {
    this.config = { ...CONFIG, ...config };
    this.isRunning = false;
    this.pgPool = null;
    this.mongoClient = null;
    this.mongoDb = null;
    this.featureExtractor = new FeatureExtractor();
    this.processingTimer = null;
    this.stats = {
      eventsProcessed: 0,
      featuresExtracted: 0,
      embeddingsGenerated: 0,
      anomaliesDetected: 0,
      errors: 0,
      lastProcessed: null
    };
  }

  /**
   * Initialize the pipeline
   */
  async initialize() {
    if (!this.config.enabled) {
      logger.info('TELEMETRY_PIPELINE_DISABLED', 'Telemetry pipeline is disabled');
      return false;
    }

    try {
      // Initialize PostgreSQL connection (optional)
      try {
        this.pgPool = new Pool(this.config.postgresConfig);
        await this.pgPool.query('SELECT 1');
        logger.info('TELEMETRY_PG_CONNECTED', 'PostgreSQL connected');
      } catch (pgError) {
        logger.warn('TELEMETRY_PG_UNAVAILABLE', 'PostgreSQL not available, continuing without it', {
          error: pgError.message
        });
        this.pgPool = null;
      }

      // Initialize MongoDB connection (optional)
      try {
        this.mongoClient = new MongoClient(
          this.config.mongoConfig.url,
          this.config.mongoConfig.options
        );
        await this.mongoClient.connect();
        this.mongoDb = this.mongoClient.db(this.config.mongoConfig.database);
        await this.mongoDb.command({ ping: 1 });
        logger.info('TELEMETRY_MONGO_CONNECTED', 'MongoDB connected');
      } catch (mongoError) {
        logger.warn('TELEMETRY_MONGO_UNAVAILABLE', 'MongoDB not available, continuing without it', {
          error: mongoError.message
        });
        this.mongoClient = null;
        this.mongoDb = null;
      }

      // Initialize Redis streams
      await streamManager.initialize();
      
      // Initialize Qdrant (if enabled)
      const qdrantEnabled = process.env.DISABLE_QDRANT !== 'true';
      if (this.config.embeddingEnabled && qdrantEnabled) {
        try {
          await qdrantClient.initialize();
          await lmStudioClient.initialize();
        } catch (error) {
          logger.warn('TELEMETRY_QDRANT_INIT_FAILED', 'Qdrant initialization failed, continuing without it', {
            error: error.message
          });
        }
      } else if (!qdrantEnabled) {
        logger.info('TELEMETRY_QDRANT_DISABLED', 'Qdrant is disabled by configuration');
      }

      logger.info('TELEMETRY_PIPELINE_READY', 'Telemetry pipeline initialized');
      return true;
    } catch (error) {
      logger.error('TELEMETRY_PIPELINE_INIT_ERROR', 'Failed to initialize pipeline', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Start processing events
   */
  async start() {
    if (this.isRunning) {
      logger.warn('TELEMETRY_PIPELINE_ALREADY_RUNNING', 'Pipeline is already running');
      return;
    }

    this.isRunning = true;
    
    // Start processing loop
    this.processingTimer = setInterval(async () => {
      try {
        await this.processEvents();
      } catch (error) {
        logger.error('TELEMETRY_PROCESS_ERROR', 'Error processing events', {
          error: error.message
        });
        this.stats.errors++;
      }
    }, this.config.processingInterval);

    logger.info('TELEMETRY_PIPELINE_STARTED', 'Pipeline processing started');
  }

  /**
   * Process events from Redis stream
   */
  async processEvents() {
    if (!this.isRunning) return;

    // Consume events from raw stream
    const events = await streamManager.consume(
      STREAMS.RAW,
      this.config.consumerGroup,
      this.config.consumerId,
      this.config.batchSize
    );

    if (events.length === 0) return;

    logger.debug('TELEMETRY_PROCESSING_BATCH', `Processing ${events.length} events`);

    for (const { id: messageId, event } of events) {
      try {
        // Process individual event
        await this.processEvent(event, messageId);
        
        // Acknowledge processing
        await streamManager.acknowledge(
          STREAMS.RAW,
          this.config.consumerGroup,
          messageId
        );
        
        this.stats.eventsProcessed++;
        this.stats.lastProcessed = new Date();
      } catch (error) {
        logger.error('TELEMETRY_EVENT_ERROR', 'Failed to process event', {
          messageId,
          error: error.message
        });
        this.stats.errors++;
      }
    }
  }

  /**
   * Process individual event through pipeline
   */
  async processEvent(envelope, messageId) {
    const event = envelope.data;
    
    // Step 1: Persist raw event to MongoDB
    await this.persistToMongo(envelope);
    
    // Step 2: Extract features
    let features = null;
    if (this.config.featureExtractionEnabled) {
      features = await this.featureExtractor.extractFeatures(event);
      
      // Publish features to stream
      await streamManager.publish(STREAMS.FEATURES, {
        ...telemetryEnvelope.createSparse({
          type: 'features',
          event_id: event.id,
          features
        }),
        message_id: messageId
      });
      
      this.stats.featuresExtracted++;
    }
    
    // Step 3: Persist to PostgreSQL
    await this.persistToPostgres(event, features);
    
    // Step 4: Generate embeddings (if complete event and Qdrant is enabled)
    const qdrantEnabled = process.env.DISABLE_QDRANT !== 'true';
    if (this.config.embeddingEnabled && qdrantEnabled && event.type === 'mcp.call.complete') {
      await this.generateEmbeddings(event);
    }
    
    // Step 5: Detect anomalies
    if (this.config.anomalyDetectionEnabled && features) {
      await this.detectAnomalies(event, features);
    }
  }

  /**
   * Persist event to MongoDB
   */
  async persistToMongo(envelope) {
    if (!this.mongoDb) {
      logger.debug('TELEMETRY_MONGO_SKIP', 'Skipping MongoDB persistence - not connected');
      return;
    }
    
    const collection = this.mongoDb.collection('events');
    
    await collection.insertOne({
      _id: envelope.id,
      envelope_version: envelope.version,
      tenant: envelope.tenant,
      timestamp: new Date(envelope.timestamp),
      data: envelope.data,
      metadata: envelope.metadata,
      created_at: new Date()
    });
  }

  /**
   * Persist event and features to PostgreSQL
   */
  async persistToPostgres(event, features) {
    if (!this.pgPool) {
      logger.debug('TELEMETRY_PG_SKIP', 'Skipping PostgreSQL persistence - not connected');
      return;
    }
    
    const client = await this.pgPool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Insert event
      const eventQuery = `
        INSERT INTO telemetry.event (
          id, type, tenant, session_id, server, tool, 
          status, latency_ms, timestamp_ms, event_data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          latency_ms = EXCLUDED.latency_ms,
          event_data = EXCLUDED.event_data
      `;
      
      await client.query(eventQuery, [
        event.id,
        event.type,
        event.tenant || 'default',
        event.session_id,
        event.server,
        event.tool,
        event.status,
        event.latency_ms,
        new Date(event.timestamp_ms),
        JSON.stringify(event)
      ]);
      
      // Update hourly aggregates (if tool call)
      if (event.type === 'mcp.call.complete') {
        const aggQuery = `
          INSERT INTO telemetry.tool_agg_hour (
            hour_bucket, tenant, server, tool,
            call_count, success_count, error_count,
            latency_p50, latency_p95, latency_p99
          ) VALUES (
            date_trunc('hour', $1),
            $2, $3, $4,
            1, 
            CASE WHEN $5 = 'success' THEN 1 ELSE 0 END,
            CASE WHEN $5 = 'error' THEN 1 ELSE 0 END,
            $6, $6, $6
          )
          ON CONFLICT (hour_bucket, tenant, server, tool) 
          DO UPDATE SET
            call_count = telemetry.tool_agg_hour.call_count + 1,
            success_count = telemetry.tool_agg_hour.success_count + 
              CASE WHEN $5 = 'success' THEN 1 ELSE 0 END,
            error_count = telemetry.tool_agg_hour.error_count + 
              CASE WHEN $5 = 'error' THEN 1 ELSE 0 END,
            latency_p50 = LEAST(telemetry.tool_agg_hour.latency_p50, $6),
            latency_p95 = GREATEST(telemetry.tool_agg_hour.latency_p95, $6),
            latency_p99 = GREATEST(telemetry.tool_agg_hour.latency_p99, $6),
            updated_at = NOW()
        `;
        
        await client.query(aggQuery, [
          new Date(event.timestamp_ms),
          event.tenant || 'default',
          event.server,
          event.tool,
          event.status,
          event.latency_ms || 0
        ]);
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Generate embeddings for event
   */
  async generateEmbeddings(event) {
    try {
      const texts = [];
      const textTypes = [];
      
      // Prepare texts for embedding
      if (event.args) {
        texts.push(JSON.stringify(event.args));
        textTypes.push('input_text');
      }
      
      if (event.output) {
        texts.push(JSON.stringify(event.output));
        textTypes.push('output_text');
      }
      
      if (event.error) {
        texts.push(JSON.stringify(event.error));
        textTypes.push('error_text');
      }
      
      if (texts.length === 0) return;
      
      // Generate embeddings
      const embeddings = await lmStudioClient.generateEmbeddings(texts);
      
      // Prepare point for Qdrant
      const vectors = {};
      embeddings.forEach((embedding, i) => {
        vectors[textTypes[i]] = embedding.embedding;
      });
      
      // Upsert to Qdrant
      await qdrantClient.upsertPoint({
        id: event.id,
        vectors,
        payload: {
          event_id: event.id,
          type: event.type,
          tenant: event.tenant || 'default',
          server: event.server,
          tool: event.tool,
          status: event.status,
          timestamp_ms: event.timestamp_ms,
          latency_ms: event.latency_ms,
          session_id: event.session_id
        }
      });
      
      // Store embedding reference in PostgreSQL (if available)
      if (this.pgPool) {
        const client = await this.pgPool.connect();
        try {
          const embQuery = `
            INSERT INTO telemetry.embedding_ref (
              id, event_id, collection_name, vector_names,
              metadata
            ) VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (id) DO UPDATE SET
              vector_names = EXCLUDED.vector_names,
              metadata = EXCLUDED.metadata,
              updated_at = NOW()
          `;
          
          await client.query(embQuery, [
            uuidv7(),
            event.id,
            'telemetry',
            textTypes,
            { dimensions: embeddings[0]?.dimensions }
          ]);
        } finally {
          client.release();
        }
      }
      
      this.stats.embeddingsGenerated++;
    } catch (error) {
      logger.error('TELEMETRY_EMBEDDING_ERROR', 'Failed to generate embeddings', {
        eventId: event.id,
        error: error.message
      });
    }
  }

  /**
   * Detect anomalies in event
   */
  async detectAnomalies(event, features) {
    try {
      // Simple anomaly detection based on latency
      if (event.latency_ms && event.latency_ms > 5000) {
        await this.recordAnomaly({
          type: 'high_latency',
          event_id: event.id,
          severity: event.latency_ms > 10000 ? 'high' : 'medium',
          description: `High latency detected: ${event.latency_ms}ms`,
          metadata: {
            server: event.server,
            tool: event.tool,
            latency_ms: event.latency_ms
          }
        });
      }
      
      // Detect error patterns
      if (event.status === 'error' && event.error) {
        await this.recordAnomaly({
          type: 'error_pattern',
          event_id: event.id,
          severity: 'medium',
          description: `Tool error: ${event.error.message || 'Unknown error'}`,
          metadata: {
            server: event.server,
            tool: event.tool,
            error_code: event.error.code
          }
        });
      }
      
      // Semantic anomaly detection (if embeddings exist)
      if (this.config.embeddingEnabled && event.type === 'mcp.call.complete') {
        // Search for similar events
        const similar = await qdrantClient.search({
          vector: 'output_text',
          filter: {
            must: [
              { key: 'server', match: { value: event.server } },
              { key: 'tool', match: { value: event.tool } }
            ]
          },
          limit: 5
        });
        
        // Check if this event is semantically different from recent similar events
        if (similar.length > 0 && similar[0].score < this.config.anomalyThreshold) {
          await this.recordAnomaly({
            type: 'semantic_drift',
            event_id: event.id,
            severity: 'low',
            description: 'Output significantly different from recent similar calls',
            metadata: {
              server: event.server,
              tool: event.tool,
              similarity_score: similar[0].score
            }
          });
        }
      }
    } catch (error) {
      logger.error('TELEMETRY_ANOMALY_ERROR', 'Failed to detect anomalies', {
        eventId: event.id,
        error: error.message
      });
    }
  }

  /**
   * Record anomaly
   */
  async recordAnomaly(anomaly) {
    // Publish to anomaly stream first (always available)
    await streamManager.publish(STREAMS.ANOMALY, {
      ...telemetryEnvelope.createSparse({
        type: 'anomaly',
        ...anomaly
      })
    });
    
    this.stats.anomaliesDetected++;
    
    // Store in PostgreSQL if available
    if (!this.pgPool) {
      logger.debug('TELEMETRY_ANOMALY_PG_SKIP', 'Skipping PostgreSQL anomaly storage - not connected');
      return;
    }
    
    const client = await this.pgPool.connect();
    
    try {
      const query = `
        INSERT INTO telemetry.anomaly (
          id, type, event_id, severity, description, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `;
      
      await client.query(query, [
        uuidv7(),
        anomaly.type,
        anomaly.event_id,
        anomaly.severity,
        anomaly.description,
        JSON.stringify(anomaly.metadata)
      ]);
    } finally {
      client.release();
    }
  }

  /**
   * Get pipeline statistics
   */
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      config: {
        enabled: this.config.enabled,
        featureExtraction: this.config.featureExtractionEnabled,
        embeddings: this.config.embeddingEnabled,
        anomalyDetection: this.config.anomalyDetectionEnabled
      }
    };
  }

  /**
   * Stop the pipeline
   */
  async stop() {
    this.isRunning = false;
    
    // Clear processing timer
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }
    
    logger.info('TELEMETRY_PIPELINE_STOPPED', 'Pipeline processing stopped');
  }

  /**
   * Close all connections
   */
  async close() {
    await this.stop();
    
    // Close database connections
    if (this.pgPool) {
      await this.pgPool.end();
    }
    
    if (this.mongoClient) {
      await this.mongoClient.close();
    }
    
    // Close other clients
    await streamManager.close();
    await qdrantClient.close();
    await lmStudioClient.close();
    
    logger.info('TELEMETRY_PIPELINE_CLOSED', 'All connections closed');
  }
}

// Export singleton instance
export const telemetryPipeline = new TelemetryPipeline();

// Export for testing
export default TelemetryPipeline;

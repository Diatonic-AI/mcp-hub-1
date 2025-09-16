/**
 * Qdrant Vector Database Client for MCP Hub Telemetry
 * Manages collection initialization, vector upserts, and semantic search
 * Supports named vectors for input_text, output_text, error_text
 */

import fetch from 'node-fetch';
import logger from '../utils/logger.js';
import { ServerError, ValidationError, wrapError } from '../utils/errors.js';
import { telemetryEnvelope } from './envelope.js';

// Default configuration
const DEFAULT_CONFIG = {
  url: process.env.QDRANT_URL || 'http://10.10.10.15:6333',
  collection: process.env.QDRANT_COLLECTION || 'mcp_telemetry',
  vectorDims: process.env.QDRANT_VECTOR_DIMS || 'auto',
  timeout: parseInt(process.env.QDRANT_TIMEOUT || '30000'),
  retryAttempts: parseInt(process.env.QDRANT_RETRY_ATTEMPTS || '3'),
  retryDelay: parseInt(process.env.QDRANT_RETRY_DELAY || '1000')
};

// Named vector configurations
const VECTOR_NAMES = {
  INPUT_TEXT: 'input_text',
  OUTPUT_TEXT: 'output_text',
  ERROR_TEXT: 'error_text'
};

// Collection configuration
const COLLECTION_CONFIG = {
  hnsw_config: {
    m: 16,
    ef_construct: 200,
    full_scan_threshold: 10000
  },
  optimizers_config: {
    default_segment_number: 4,
    memmap_threshold: 200000,
    indexing_threshold: 20000
  },
  quantization_config: {
    scalar: {
      type: 'int8',
      quantile: 0.99,
      always_ram: false
    }
  },
  write_consistency_factor: 2,
  replication_factor: 1,
  shard_number: 1
};

/**
 * Qdrant client for vector operations
 */
export class QdrantClient {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.collectionExists = false;
    this.vectorDimensions = null;
    this.isInitialized = false;
  }

  /**
   * Initialize client and ensure collection exists
   */
  async initialize(embeddingDimension = null) {
    try {
      logger.info('QDRANT_INIT', `Initializing Qdrant client`, {
        url: this.config.url,
        collection: this.config.collection
      });

      // Health check
      await this.healthCheck();

      // Probe or use provided dimension
      if (this.config.vectorDims === 'auto' && !embeddingDimension) {
        throw new ValidationError(
          'Vector dimension must be provided when QDRANT_VECTOR_DIMS=auto'
        );
      }

      this.vectorDimensions = embeddingDimension || parseInt(this.config.vectorDims);

      // Check if collection exists
      this.collectionExists = await this.checkCollectionExists();

      if (!this.collectionExists) {
        // Create collection with named vectors
        await this.createCollection();
      } else {
        // Verify collection configuration
        await this.verifyCollection();
      }

      // Create payload indexes
      await this.createPayloadIndexes();

      this.isInitialized = true;
      
      logger.info('QDRANT_READY', 'Qdrant client initialized successfully', {
        collection: this.config.collection,
        vectorDims: this.vectorDimensions
      });

      return true;
    } catch (error) {
      throw wrapError(error, 'QDRANT_INIT_ERROR', {
        url: this.config.url,
        collection: this.config.collection
      });
    }
  }

  /**
   * Health check for Qdrant service
   */
  async healthCheck() {
    const response = await this.request('GET', '/healthz');
    if (!response || response.status !== 'ok') {
      throw new ServerError('Qdrant health check failed');
    }
    return true;
  }

  /**
   * Check if collection exists
   */
  async checkCollectionExists() {
    try {
      const response = await this.request('GET', `/collections/${this.config.collection}`);
      return response && response.result && response.result.status === 'green';
    } catch (error) {
      if (error.status === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Create collection with named vectors
   */
  async createCollection() {
    logger.info('QDRANT_CREATE_COLLECTION', 'Creating Qdrant collection', {
      collection: this.config.collection,
      dimensions: this.vectorDimensions
    });

    const config = {
      vectors: {
        [VECTOR_NAMES.INPUT_TEXT]: {
          size: this.vectorDimensions,
          distance: 'Cosine'
        },
        [VECTOR_NAMES.OUTPUT_TEXT]: {
          size: this.vectorDimensions,
          distance: 'Cosine'
        },
        [VECTOR_NAMES.ERROR_TEXT]: {
          size: this.vectorDimensions,
          distance: 'Cosine'
        }
      },
      ...COLLECTION_CONFIG
    };

    const response = await this.request('PUT', `/collections/${this.config.collection}`, config);
    
    if (!response || !response.result) {
      throw new ServerError('Failed to create Qdrant collection');
    }

    this.collectionExists = true;
    return true;
  }

  /**
   * Verify existing collection configuration
   */
  async verifyCollection() {
    const info = await this.request('GET', `/collections/${this.config.collection}`);
    
    if (!info || !info.result) {
      throw new ServerError('Failed to get collection info');
    }

    const config = info.result.config;
    
    // Verify vector dimensions
    if (config.params.vectors) {
      for (const vectorName of Object.values(VECTOR_NAMES)) {
        const vectorConfig = config.params.vectors[vectorName];
        if (vectorConfig && vectorConfig.size !== this.vectorDimensions) {
          logger.warn('QDRANT_DIM_MISMATCH', 
            `Vector dimension mismatch for ${vectorName}`,
            {
              expected: this.vectorDimensions,
              actual: vectorConfig.size
            }
          );
        }
      }
    }

    return true;
  }

  /**
   * Create payload indexes for efficient filtering
   */
  async createPayloadIndexes() {
    const indexes = [
      { field_name: 'tenant', field_schema: 'keyword' },
      { field_name: 'server', field_schema: 'keyword' },
      { field_name: 'tool', field_schema: 'keyword' },
      { field_name: 'status', field_schema: 'keyword' },
      { field_name: 'source', field_schema: 'keyword' },
      { field_name: 'created_at', field_schema: 'datetime' }
    ];

    for (const index of indexes) {
      try {
        await this.request(
          'PUT',
          `/collections/${this.config.collection}/index`,
          index
        );
      } catch (error) {
        // Index might already exist, log and continue
        logger.debug('QDRANT_INDEX', `Index ${index.field_name} might already exist`, {
          error: error.message
        });
      }
    }

    return true;
  }

  /**
   * Upsert vectors with payload
   */
  async upsert(points) {
    if (!this.isInitialized) {
      throw new ValidationError('Qdrant client not initialized');
    }

    if (!Array.isArray(points)) {
      points = [points];
    }

    // Transform points to Qdrant format
    const qdrantPoints = points.map(point => this.transformToQdrantPoint(point));

    const response = await this.request(
      'PUT',
      `/collections/${this.config.collection}/points`,
      {
        points: qdrantPoints
      }
    );

    if (!response || response.status !== 'ok') {
      throw new ServerError('Failed to upsert points to Qdrant');
    }

    return response.result;
  }

  /**
   * Transform point to Qdrant format with named vectors
   */
  transformToQdrantPoint(point) {
    const { id, vectors, payload } = point;

    // Validate vectors
    const qdrantVectors = {};
    
    if (vectors.input_text) {
      qdrantVectors[VECTOR_NAMES.INPUT_TEXT] = vectors.input_text;
    }
    if (vectors.output_text) {
      qdrantVectors[VECTOR_NAMES.OUTPUT_TEXT] = vectors.output_text;
    }
    if (vectors.error_text) {
      qdrantVectors[VECTOR_NAMES.ERROR_TEXT] = vectors.error_text;
    }

    // Ensure at least one vector is present
    if (Object.keys(qdrantVectors).length === 0) {
      throw new ValidationError('At least one vector must be provided');
    }

    // Redact payload if needed
    const redactedPayload = this.redactPayload(payload);

    return {
      id: id || crypto.randomUUID(),
      vectors: qdrantVectors,
      payload: {
        ...redactedPayload,
        indexed_at: new Date().toISOString()
      }
    };
  }

  /**
   * Redact sensitive information from payload
   */
  redactPayload(payload) {
    if (!payload) return {};

    // Use telemetry envelope redaction
    const envelope = telemetryEnvelope.redactObject(payload);
    
    return envelope;
  }

  /**
   * Search for similar vectors
   */
  async search(query) {
    if (!this.isInitialized) {
      throw new ValidationError('Qdrant client not initialized');
    }

    const {
      vector,
      vectorName = VECTOR_NAMES.INPUT_TEXT,
      filter = null,
      limit = 20,
      withPayload = true,
      withVector = false,
      scoreThreshold = null
    } = query;

    const searchRequest = {
      vector: {
        name: vectorName,
        vector: vector
      },
      limit,
      with_payload: withPayload,
      with_vector: withVector
    };

    if (filter) {
      searchRequest.filter = this.buildFilter(filter);
    }

    if (scoreThreshold !== null) {
      searchRequest.score_threshold = scoreThreshold;
    }

    const response = await this.request(
      'POST',
      `/collections/${this.config.collection}/points/search`,
      searchRequest
    );

    if (!response || !response.result) {
      throw new ServerError('Search request failed');
    }

    return response.result;
  }

  /**
   * Build filter for search queries
   */
  buildFilter(filter) {
    const must = [];
    const should = [];

    if (filter.tenant) {
      must.push({
        key: 'tenant',
        match: { value: filter.tenant }
      });
    }

    if (filter.server) {
      must.push({
        key: 'server',
        match: { value: filter.server }
      });
    }

    if (filter.tool) {
      must.push({
        key: 'tool',
        match: { value: filter.tool }
      });
    }

    if (filter.status) {
      must.push({
        key: 'status',
        match: { value: filter.status }
      });
    }

    if (filter.dateRange) {
      must.push({
        key: 'created_at',
        range: {
          gte: filter.dateRange.from,
          lte: filter.dateRange.to
        }
      });
    }

    const result = {};
    if (must.length > 0) {
      result.must = must;
    }
    if (should.length > 0) {
      result.should = should;
    }

    return Object.keys(result).length > 0 ? result : null;
  }

  /**
   * Get point by ID
   */
  async getPoint(pointId) {
    if (!this.isInitialized) {
      throw new ValidationError('Qdrant client not initialized');
    }

    const response = await this.request(
      'GET',
      `/collections/${this.config.collection}/points/${pointId}`
    );

    if (!response || !response.result) {
      return null;
    }

    return response.result;
  }

  /**
   * Delete points by IDs
   */
  async deletePoints(pointIds) {
    if (!this.isInitialized) {
      throw new ValidationError('Qdrant client not initialized');
    }

    if (!Array.isArray(pointIds)) {
      pointIds = [pointIds];
    }

    const response = await this.request(
      'POST',
      `/collections/${this.config.collection}/points/delete`,
      {
        points: pointIds
      }
    );

    if (!response || response.status !== 'ok') {
      throw new ServerError('Failed to delete points');
    }

    return true;
  }

  /**
   * Get collection statistics
   */
  async getStats() {
    if (!this.isInitialized) {
      throw new ValidationError('Qdrant client not initialized');
    }

    const response = await this.request(
      'GET',
      `/collections/${this.config.collection}`
    );

    if (!response || !response.result) {
      throw new ServerError('Failed to get collection stats');
    }

    return {
      vectors_count: response.result.vectors_count,
      indexed_vectors_count: response.result.indexed_vectors_count,
      points_count: response.result.points_count,
      segments_count: response.result.segments_count,
      status: response.result.status,
      config: response.result.config
    };
  }

  /**
   * Make HTTP request to Qdrant with retry logic
   */
  async request(method, path, body = null) {
    const url = `${this.config.url}${path}`;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: this.config.timeout
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    let lastError;
    
    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        const response = await fetch(url, options);
        
        const data = await response.json();
        
        if (!response.ok) {
          const error = new ServerError(
            data.status?.error || `Qdrant request failed: ${response.status}`
          );
          error.status = response.status;
          error.data = data;
          throw error;
        }

        return data;
      } catch (error) {
        lastError = error;
        
        // Don't retry on client errors (4xx)
        if (error.status && error.status >= 400 && error.status < 500) {
          throw error;
        }

        // Log retry attempt
        if (attempt < this.config.retryAttempts - 1) {
          logger.debug('QDRANT_RETRY', `Retrying request (attempt ${attempt + 1})`, {
            method,
            path,
            error: error.message
          });
          
          // Exponential backoff
          await new Promise(resolve => 
            setTimeout(resolve, this.config.retryDelay * Math.pow(2, attempt))
          );
        }
      }
    }

    throw wrapError(lastError, 'QDRANT_REQUEST_ERROR', {
      method,
      path,
      attempts: this.config.retryAttempts
    });
  }

  /**
   * Close client connections (cleanup)
   */
  async close() {
    this.isInitialized = false;
    logger.info('QDRANT_CLOSE', 'Qdrant client closed');
  }
}

// Export singleton instance
export const qdrantClient = new QdrantClient();

// Export for testing
export default QdrantClient;

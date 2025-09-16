/**
 * LM Studio Embedding Client for MCP Hub Telemetry
 * OpenAI-compatible embeddings API with micro-batching and backpressure control
 * Integrates with local LM Studio instance for vector generation
 */

import fetch from 'node-fetch';
import logger from '../utils/logger.js';
import { ServerError, ValidationError, wrapError } from '../utils/errors.js';
import { telemetryEnvelope } from './envelope.js';

// Default configuration
const DEFAULT_CONFIG = {
  baseUrl: process.env.LMSTUDIO_BASE_URL || 'http://10.0.0.219:1234',
  model: process.env.LMSTUDIO_EMBEDDING_MODEL || 'nomic-ai/nomic-embed-text-v1.5-GGUF',
  batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE || '64'),
  concurrency: parseInt(process.env.EMBEDDING_CONCURRENCY || '2'),
  timeout: parseInt(process.env.EMBEDDING_TIMEOUT || '30000'),
  retryAttempts: parseInt(process.env.EMBEDDING_RETRY_ATTEMPTS || '3'),
  retryDelay: parseInt(process.env.EMBEDDING_RETRY_DELAY || '1000'),
  maxTextLength: parseInt(process.env.EMBEDDING_MAX_TEXT_LENGTH || '8192'),
  circuitBreakerThreshold: parseInt(process.env.EMBEDDING_CIRCUIT_BREAKER || '5')
};

// Circuit breaker states
const CIRCUIT_STATES = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half_open'
};

/**
 * Batch queue for micro-batching
 */
class BatchQueue {
  constructor(batchSize, flushInterval = 100) {
    this.batchSize = batchSize;
    this.flushInterval = flushInterval;
    this.queue = [];
    this.callbacks = [];
    this.timer = null;
  }

  /**
   * Add item to batch queue
   */
  async add(text) {
    return new Promise((resolve, reject) => {
      this.queue.push(text);
      this.callbacks.push({ resolve, reject });
      
      if (this.queue.length >= this.batchSize) {
        this.flush();
      } else if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), this.flushInterval);
      }
    });
  }

  /**
   * Flush the current batch
   */
  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.batchSize);
    const callbacks = this.callbacks.splice(0, batch.length);
    
    return { batch, callbacks };
  }

  /**
   * Clear the queue
   */
  clear() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    
    const error = new Error('Batch queue cleared');
    this.callbacks.forEach(({ reject }) => reject(error));
    
    this.queue = [];
    this.callbacks = [];
  }
}

/**
 * Circuit breaker for handling failures
 */
class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.threshold = threshold;
    this.timeout = timeout;
    this.failures = 0;
    this.state = CIRCUIT_STATES.CLOSED;
    this.nextAttempt = null;
  }

  /**
   * Record success
   */
  onSuccess() {
    this.failures = 0;
    this.state = CIRCUIT_STATES.CLOSED;
  }

  /**
   * Record failure
   */
  onFailure() {
    this.failures++;
    
    if (this.failures >= this.threshold) {
      this.state = CIRCUIT_STATES.OPEN;
      this.nextAttempt = Date.now() + this.timeout;
      
      logger.warn('CIRCUIT_BREAKER_OPEN', 'Circuit breaker opened due to failures', {
        failures: this.failures,
        timeout: this.timeout
      });
    }
  }

  /**
   * Check if request is allowed
   */
  canRequest() {
    if (this.state === CIRCUIT_STATES.CLOSED) {
      return true;
    }
    
    if (this.state === CIRCUIT_STATES.OPEN) {
      if (Date.now() >= this.nextAttempt) {
        this.state = CIRCUIT_STATES.HALF_OPEN;
        return true;
      }
      return false;
    }
    
    return this.state === CIRCUIT_STATES.HALF_OPEN;
  }

  /**
   * Get current state
   */
  getState() {
    return {
      state: this.state,
      failures: this.failures,
      nextAttempt: this.nextAttempt
    };
  }
}

/**
 * LM Studio embedding client
 */
export class EmbeddingClient {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dimensionCache = new Map();
    this.batchQueue = new BatchQueue(this.config.batchSize);
    this.circuitBreaker = new CircuitBreaker(this.config.circuitBreakerThreshold);
    this.activeRequests = 0;
    this.isProcessing = false;
    this.redactionEnabled = true;
  }

  /**
   * Initialize client and probe embedding dimensions
   */
  async initialize() {
    try {
      logger.info('EMBEDDING_INIT', 'Initializing LM Studio embedding client', {
        baseUrl: this.config.baseUrl,
        model: this.config.model
      });

      // Probe embedding dimensions
      const dimension = await this.probeDimension();
      
      logger.info('EMBEDDING_READY', 'Embedding client initialized', {
        model: this.config.model,
        dimension,
        batchSize: this.config.batchSize
      });

      // Start batch processor
      this.startBatchProcessor();

      return dimension;
    } catch (error) {
      throw wrapError(error, 'EMBEDDING_INIT_ERROR', {
        baseUrl: this.config.baseUrl,
        model: this.config.model
      });
    }
  }

  /**
   * Probe embedding dimension by making a test request
   */
  async probeDimension() {
    const cacheKey = this.config.model;
    
    // Check cache first
    if (this.dimensionCache.has(cacheKey)) {
      return this.dimensionCache.get(cacheKey);
    }

    try {
      // Make a test embedding request
      const response = await this.request([{
        input: 'hello',
        model: this.config.model
      }]);

      if (!response || !response.data || response.data.length === 0) {
        throw new ServerError('Failed to probe embedding dimension');
      }

      const dimension = response.data[0].embedding.length;
      
      // Cache the dimension
      this.dimensionCache.set(cacheKey, dimension);
      
      // Store in Redis for persistence
      await this.storeDimensionInRedis(cacheKey, dimension);

      return dimension;
    } catch (error) {
      throw wrapError(error, 'DIMENSION_PROBE_ERROR', {
        model: this.config.model
      });
    }
  }

  /**
   * Store dimension in Redis for persistence
   */
  async storeDimensionInRedis(model, dimension) {
    try {
      // This would connect to Redis - placeholder for now
      const key = `telemetry:embed:dim:${model}`;
      logger.debug('DIMENSION_CACHE', `Cached embedding dimension`, {
        model,
        dimension,
        key
      });
    } catch (error) {
      logger.warn('DIMENSION_CACHE_ERROR', 'Failed to cache dimension in Redis', {
        error: error.message
      });
    }
  }

  /**
   * Generate embeddings for text(s)
   */
  async embed(texts, options = {}) {
    if (!Array.isArray(texts)) {
      texts = [texts];
    }

    // Check circuit breaker
    if (!this.circuitBreaker.canRequest()) {
      throw new ServerError('Embedding service unavailable (circuit breaker open)');
    }

    // Redact sensitive content if enabled
    if (this.redactionEnabled && !options.skipRedaction) {
      texts = texts.map(text => this.redactText(text));
    }

    // Truncate texts if too long
    texts = texts.map(text => this.truncateText(text));

    // Process in batches
    const results = [];
    for (let i = 0; i < texts.length; i += this.config.batchSize) {
      const batch = texts.slice(i, i + this.config.batchSize);
      
      // Apply concurrency control
      await this.waitForCapacity();
      
      try {
        const batchResults = await this.processBatch(batch);
        results.push(...batchResults);
      } catch (error) {
        // Record failure for circuit breaker
        this.circuitBreaker.onFailure();
        throw error;
      }
    }

    // Record success
    this.circuitBreaker.onSuccess();

    return results;
  }

  /**
   * Process a single batch of texts
   */
  async processBatch(texts) {
    const startTime = Date.now();
    
    try {
      this.activeRequests++;
      
      const requests = texts.map(text => ({
        input: text,
        model: this.config.model
      }));

      const response = await this.request(requests);
      
      if (!response || !response.data) {
        throw new ServerError('Invalid embedding response');
      }

      const latency = Date.now() - startTime;
      
      logger.debug('EMBEDDING_BATCH', 'Processed embedding batch', {
        count: texts.length,
        latency,
        model: this.config.model
      });

      return response.data.map(item => ({
        embedding: item.embedding,
        index: item.index,
        model: this.config.model,
        dimension: item.embedding.length,
        processing_time_ms: latency / texts.length
      }));
    } finally {
      this.activeRequests--;
    }
  }

  /**
   * Wait for capacity (concurrency control)
   */
  async waitForCapacity() {
    while (this.activeRequests >= this.config.concurrency) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  /**
   * Redact sensitive content from text
   */
  redactText(text) {
    if (typeof text !== 'string') {
      text = JSON.stringify(text);
    }

    // Use telemetry envelope redaction
    return telemetryEnvelope.redactString(text);
  }

  /**
   * Truncate text to maximum length
   */
  truncateText(text) {
    if (typeof text !== 'string') {
      text = JSON.stringify(text);
    }

    if (text.length > this.config.maxTextLength) {
      // Take beginning and end to preserve context
      const halfLength = Math.floor(this.config.maxTextLength / 2);
      return text.substring(0, halfLength) + 
             '\n... [TRUNCATED] ...\n' + 
             text.substring(text.length - halfLength);
    }

    return text;
  }

  /**
   * Start batch processor for micro-batching
   */
  startBatchProcessor() {
    setInterval(() => {
      if (this.batchQueue.queue.length > 0) {
        const batchData = this.batchQueue.flush();
        if (batchData) {
          this.processBatchFromQueue(batchData);
        }
      }
    }, 100);
  }

  /**
   * Process batch from queue
   */
  async processBatchFromQueue(batchData) {
    const { batch, callbacks } = batchData;
    
    try {
      const results = await this.processBatch(batch);
      
      // Resolve callbacks with results
      callbacks.forEach(({ resolve }, index) => {
        resolve(results[index]);
      });
    } catch (error) {
      // Reject all callbacks with error
      callbacks.forEach(({ reject }) => {
        reject(error);
      });
    }
  }

  /**
   * Make HTTP request to LM Studio
   */
  async request(inputs) {
    const url = `${this.config.baseUrl}/v1/embeddings`;
    const body = {
      input: inputs.map(i => i.input),
      model: this.config.model,
      encoding_format: 'float'
    };

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      timeout: this.config.timeout
    };

    let lastError;

    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        const response = await fetch(url, options);
        
        if (!response.ok) {
          const error = new ServerError(
            `LM Studio request failed: ${response.status} ${response.statusText}`
          );
          error.status = response.status;
          
          // Don't retry on client errors
          if (response.status >= 400 && response.status < 500) {
            throw error;
          }
          
          lastError = error;
        } else {
          const data = await response.json();
          return data;
        }
      } catch (error) {
        lastError = error;
        
        // Log retry attempt
        if (attempt < this.config.retryAttempts - 1) {
          logger.debug('EMBEDDING_RETRY', `Retrying request (attempt ${attempt + 1})`, {
            error: error.message
          });
          
          // Exponential backoff
          await new Promise(resolve => 
            setTimeout(resolve, this.config.retryDelay * Math.pow(2, attempt))
          );
        }
      }
    }

    throw wrapError(lastError, 'EMBEDDING_REQUEST_ERROR', {
      attempts: this.config.retryAttempts,
      model: this.config.model
    });
  }

  /**
   * Create embeddings for different text types
   */
  async createTextEmbeddings(texts) {
    const { input, output, error } = texts;
    const embeddings = {};

    if (input) {
      const result = await this.embed([input]);
      embeddings.input_text = result[0].embedding;
    }

    if (output) {
      const result = await this.embed([output]);
      embeddings.output_text = result[0].embedding;
    }

    if (error) {
      const result = await this.embed([error]);
      embeddings.error_text = result[0].embedding;
    }

    return embeddings;
  }

  /**
   * Get embedding statistics
   */
  getStats() {
    return {
      activeRequests: this.activeRequests,
      queueSize: this.batchQueue.queue.length,
      circuitBreaker: this.circuitBreaker.getState(),
      dimensionCache: Array.from(this.dimensionCache.entries()),
      config: {
        model: this.config.model,
        batchSize: this.config.batchSize,
        concurrency: this.config.concurrency
      }
    };
  }

  /**
   * Close the client
   */
  close() {
    this.batchQueue.clear();
    logger.info('EMBEDDING_CLOSE', 'Embedding client closed');
  }
}

// Export singleton instance
export const embeddingClient = new EmbeddingClient();

// Export for testing
export default EmbeddingClient;

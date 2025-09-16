/**
 * MongoDB ML Collections Setup
 * Creates collections, indexes, and GridFS buckets for ML telemetry
 * Complies with WARP guidelines for idempotent operations
 */

import { MongoClient, GridFSBucket } from 'mongodb';
import logger from '../../utils/logger.js';
import { ValidationError, ServerError } from '../../utils/errors.js';

/**
 * ML Collections Configuration
 * Defines schemas, indexes, and validation rules
 */
export const ML_COLLECTIONS = {
  training_datasets: {
    name: 'ml_training_datasets',
    indexes: [
      {
        key: { tenant: 1, datasetName: 1, version: 1 },
        options: { unique: true, name: 'idx_tenant_dataset_version' }
      },
      {
        key: { tenant: 1, classification: 1 },
        options: { name: 'idx_tenant_classification' }
      },
      {
        key: { createdAt: -1 },
        options: { name: 'idx_created_at' }
      }
    ],
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'tenant', 'datasetName', 'version', 'createdAt'],
        properties: {
          _id: { bsonType: 'string' },
          tenant: { bsonType: 'string' },
          datasetName: { bsonType: 'string' },
          version: { bsonType: 'string' },
          schema: { bsonType: 'object' },
          source: { bsonType: 'string' },
          gridFsId: { bsonType: 'string' },
          count: { bsonType: 'int' },
          stats: { bsonType: 'object' },
          tags: { bsonType: 'array' },
          classification: {
            enum: ['public', 'internal', 'confidential', 'restricted']
          },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' }
        }
      }
    }
  },
  
  feature_vectors: {
    name: 'ml_feature_vectors',
    indexes: [
      {
        key: { tenant: 1, featureSet: 1, entityId: 1 },
        options: { name: 'idx_tenant_featureset_entity' }
      },
      {
        key: { tenant: 1, runId: 1, featureSet: 1 },
        options: { name: 'idx_tenant_run_featureset' }
      },
      {
        key: { ts: 1 },
        options: {
          name: 'idx_ttl',
          expireAfterSeconds: 7776000 // 90 days default TTL
        }
      }
    ],
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'tenant', 'featureSet', 'entityId', 'vector', 'dims', 'ts'],
        properties: {
          _id: { bsonType: 'string' },
          tenant: { bsonType: 'string' },
          featureSet: { bsonType: 'string' },
          entityId: { bsonType: 'string' },
          runId: { bsonType: 'string' },
          vector: { bsonType: 'array' },
          dims: { bsonType: 'int' },
          ts: { bsonType: 'date' },
          metadata: { bsonType: 'object' },
          classification: {
            enum: ['public', 'internal', 'confidential', 'restricted']
          },
          pii: { bsonType: 'bool' }
        }
      }
    }
  },
  
  raw_telemetry: {
    name: 'ml_raw_telemetry',
    indexes: [
      {
        key: { tenant: 1, eventType: 1, ts: -1 },
        options: { name: 'idx_tenant_event_ts' }
      },
      {
        key: { ts: 1 },
        options: {
          name: 'idx_ttl',
          expireAfterSeconds: 2592000 // 30 days default TTL
        }
      }
    ],
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'tenant', 'eventType', 'payload', 'ts'],
        properties: {
          _id: { bsonType: 'string' },
          tenant: { bsonType: 'string' },
          eventType: { bsonType: 'string' },
          payload: { bsonType: 'object' },
          ts: { bsonType: 'date' }
        }
      }
    }
  }
};

/**
 * MongoDB ML Collections Manager
 * Handles collection creation, index management, and GridFS setup
 */
export class MLCollectionsManager {
  constructor(mongoUri, dbName) {
    this.mongoUri = mongoUri || process.env.MONGO_URI || 'mongodb://localhost:27017';
    this.dbName = dbName || process.env.MONGO_DB_NAME || 'mcp_hub_ml';
    this.client = null;
    this.db = null;
    this.gridFSBucket = null;
  }

  /**
   * Connect to MongoDB
   */
  async connect() {
    try {
      this.client = new MongoClient(this.mongoUri, {
        useUnifiedTopology: true,
        maxPoolSize: 10,
        minPoolSize: 2
      });
      
      await this.client.connect();
      this.db = this.client.db(this.dbName);
      
      logger.info('mongo_connection', {
        message: 'Connected to MongoDB for ML collections',
        dbName: this.dbName
      });
      
      return true;
    } catch (error) {
      logger.error('mongo_connection_error', {
        message: 'Failed to connect to MongoDB',
        error: error.message
      });
      throw new ServerError(
        `MongoDB connection failed: ${error.message}`
      );
    }
  }

  /**
   * Initialize collections with indexes and validators
   * Idempotent operation - safe to run multiple times
   */
  async initializeCollections() {
    if (!this.db) {
      throw new ServerError(
        'MongoDB not connected. Call connect() first.'
      );
    }

    const results = {
      collections: {},
      gridFS: null,
      errors: []
    };

    // Create collections with validators
    for (const [key, config] of Object.entries(ML_COLLECTIONS)) {
      try {
        const collectionName = config.name;
        
        // Check if collection exists
        const collections = await this.db.listCollections({ name: collectionName }).toArray();
        
        if (collections.length === 0) {
          // Create collection with validator
          await this.db.createCollection(collectionName, {
            validator: config.validator,
            validationLevel: 'moderate',
            validationAction: 'warn'
          });
          
          logger.info('mongo_collection_created', {
            message: `Created collection: ${collectionName}`,
            collection: collectionName
          });
        }
        
        // Get collection reference
        const collection = this.db.collection(collectionName);
        
        // Create indexes (idempotent)
        for (const indexSpec of config.indexes) {
          try {
            await collection.createIndex(indexSpec.key, indexSpec.options);
            logger.debug('mongo_index_created', {
              message: `Index created/verified`,
              collection: collectionName,
              index: indexSpec.options.name
            });
          } catch (indexError) {
            // Index might already exist, log as debug
            logger.debug('mongo_index_exists', {
              message: `Index already exists`,
              collection: collectionName,
              index: indexSpec.options.name
            });
          }
        }
        
        results.collections[key] = {
          status: 'ready',
          name: collectionName,
          indexCount: config.indexes.length
        };
        
      } catch (error) {
        logger.error('mongo_collection_error', {
          message: `Failed to initialize collection: ${key}`,
          error: error.message
        });
        results.errors.push(`${key}: ${error.message}`);
      }
    }

    // Initialize GridFS bucket for ML artifacts
    try {
      this.gridFSBucket = new GridFSBucket(this.db, {
        bucketName: 'ml_artifacts',
        chunkSizeBytes: 1024 * 1024 // 1MB chunks
      });
      
      // Create indexes for GridFS (idempotent)
      const filesCollection = this.db.collection('ml_artifacts.files');
      const chunksCollection = this.db.collection('ml_artifacts.chunks');
      
      // Custom indexes on GridFS files collection
      await filesCollection.createIndex(
        { 'metadata.tenant': 1, 'metadata.runId': 1 },
        { name: 'idx_gridfs_tenant_run' }
      );
      
      await filesCollection.createIndex(
        { 'metadata.tenant': 1, 'metadata.modelVersionId': 1 },
        { name: 'idx_gridfs_tenant_model' }
      );
      
      await filesCollection.createIndex(
        { 'metadata.sha256': 1 },
        { name: 'idx_gridfs_sha256' }
      );
      
      results.gridFS = {
        status: 'ready',
        bucketName: 'ml_artifacts'
      };
      
      logger.info('mongo_gridfs_initialized', {
        message: 'GridFS bucket initialized for ML artifacts',
        bucketName: 'ml_artifacts'
      });
      
    } catch (error) {
      logger.error('mongo_gridfs_error', {
        message: 'Failed to initialize GridFS',
        error: error.message
      });
      results.errors.push(`GridFS: ${error.message}`);
    }

    // Log summary
    logger.info('mongo_ml_initialization_complete', {
      message: 'ML collections initialization complete',
      collections: Object.keys(results.collections).length,
      gridFS: results.gridFS ? 'ready' : 'failed',
      errors: results.errors.length
    });

    if (results.errors.length > 0) {
      throw new ServerError(
        `Some collections failed to initialize: ${results.errors.join(', ')}`
      );
    }

    return results;
  }

  /**
   * Get collection reference with tenant validation
   */
  getCollection(collectionKey) {
    const config = ML_COLLECTIONS[collectionKey];
    if (!config) {
      throw new ValidationError(
        `Unknown collection: ${collectionKey}`
      );
    }
    
    if (!this.db) {
      throw new ServerError(
        'MongoDB not connected'
      );
    }
    
    return this.db.collection(config.name);
  }

  /**
   * Get GridFS bucket for artifact storage
   */
  getGridFSBucket() {
    if (!this.gridFSBucket) {
      throw new ServerError(
        'GridFS not initialized'
      );
    }
    return this.gridFSBucket;
  }

  /**
   * Update TTL for a collection
   * @param {string} collectionKey - Collection key from ML_COLLECTIONS
   * @param {number} ttlSeconds - TTL in seconds (0 to disable)
   */
  async updateTTL(collectionKey, ttlSeconds) {
    const collection = this.getCollection(collectionKey);
    const config = ML_COLLECTIONS[collectionKey];
    
    // Find TTL index
    const ttlIndex = config.indexes.find(idx => 
      idx.options.name === 'idx_ttl'
    );
    
    if (!ttlIndex) {
      throw new ValidationError(
        `Collection ${collectionKey} does not support TTL`
      );
    }
    
    try {
      // Drop existing TTL index
      await collection.dropIndex('idx_ttl');
      
      // Create new TTL index if ttlSeconds > 0
      if (ttlSeconds > 0) {
        await collection.createIndex(
          ttlIndex.key,
          {
            ...ttlIndex.options,
            expireAfterSeconds: ttlSeconds
          }
        );
      }
      
      logger.info('mongo_ttl_updated', {
        message: 'TTL updated for collection',
        collection: collectionKey,
        ttlSeconds
      });
      
      return true;
    } catch (error) {
      logger.error('mongo_ttl_error', {
        message: 'Failed to update TTL',
        collection: collectionKey,
        error: error.message
      });
      throw new ServerError(
        `Failed to update TTL: ${error.message}`
      );
    }
  }

  /**
   * Get collection statistics
   */
  async getStats() {
    if (!this.db) {
      throw new McpError(
        ErrorCode.InternalError,
        'MongoDB not connected'
      );
    }

    const stats = {};
    
    for (const [key, config] of Object.entries(ML_COLLECTIONS)) {
      try {
        const collection = this.db.collection(config.name);
        const collStats = await collection.stats();
        
        stats[key] = {
          name: config.name,
          count: collStats.count,
          size: collStats.size,
          avgObjSize: collStats.avgObjSize,
          indexCount: collStats.nindexes,
          indexSize: collStats.totalIndexSize
        };
      } catch (error) {
        stats[key] = {
          name: config.name,
          error: error.message
        };
      }
    }
    
    // GridFS stats
    try {
      const filesCollection = this.db.collection('ml_artifacts.files');
      const filesStats = await filesCollection.stats();
      
      stats.gridFS = {
        fileCount: filesStats.count,
        totalSize: filesStats.size
      };
    } catch (error) {
      stats.gridFS = {
        error: error.message
      };
    }
    
    return stats;
  }

  /**
   * Disconnect from MongoDB
   */
  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.gridFSBucket = null;
      
      logger.info('mongo_disconnected', {
        message: 'Disconnected from MongoDB'
      });
    }
  }
}

// Singleton instance
let manager = null;

/**
 * Get or create ML Collections Manager instance
 */
export function getMLCollectionsManager(mongoUri, dbName) {
  if (!manager) {
    manager = new MLCollectionsManager(mongoUri, dbName);
  }
  return manager;
}

export default MLCollectionsManager;

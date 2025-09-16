/**
 * Database mocks for testing without real database instances
 */

import { vi } from 'vitest';
import { EventEmitter } from 'events';

/**
 * Mock PostgreSQL client
 */
export class MockPostgresClient extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.queryResults = new Map();
  }

  async connect() {
    this.connected = true;
    this.emit('connect');
    return this;
  }

  async query(sql, params) {
    if (!this.connected) {
      throw new Error('Not connected to database');
    }
    
    // Return mock results based on query
    if (sql.includes('SELECT')) {
      return { rows: this.queryResults.get('select') || [] };
    }
    if (sql.includes('INSERT')) {
      return { rowCount: 1, rows: [{ id: 'mock-id' }] };
    }
    if (sql.includes('UPDATE')) {
      return { rowCount: 1 };
    }
    if (sql.includes('DELETE')) {
      return { rowCount: 1 };
    }
    
    return { rows: [] };
  }

  async end() {
    this.connected = false;
    this.emit('end');
  }

  setQueryResult(key, result) {
    this.queryResults.set(key, result);
  }
}

/**
 * Mock MongoDB client
 */
export class MockMongoClient {
  constructor() {
    this.connected = false;
    this.collections = new Map();
  }

  async connect() {
    this.connected = true;
    return this;
  }

  db(name) {
    return {
      collection: (collectionName) => {
        if (!this.collections.has(collectionName)) {
          this.collections.set(collectionName, new MockMongoCollection());
        }
        return this.collections.get(collectionName);
      },
      admin: () => ({
        ping: async () => ({ ok: 1 })
      })
    };
  }

  async close() {
    this.connected = false;
  }
}

class MockMongoCollection {
  constructor() {
    this.documents = [];
  }

  async insertOne(doc) {
    const insertedDoc = { ...doc, _id: `mock-id-${Date.now()}` };
    this.documents.push(insertedDoc);
    return { insertedId: insertedDoc._id };
  }

  async findOne(query) {
    return this.documents.find(doc => {
      return Object.entries(query).every(([key, value]) => doc[key] === value);
    }) || null;
  }

  async find(query) {
    const results = this.documents.filter(doc => {
      return Object.entries(query).every(([key, value]) => doc[key] === value);
    });
    
    return {
      toArray: async () => results
    };
  }

  async updateOne(query, update) {
    const docIndex = this.documents.findIndex(doc => {
      return Object.entries(query).every(([key, value]) => doc[key] === value);
    });
    
    if (docIndex >= 0) {
      if (update.$set) {
        Object.assign(this.documents[docIndex], update.$set);
      }
      return { modifiedCount: 1 };
    }
    
    return { modifiedCount: 0 };
  }

  async deleteOne(query) {
    const docIndex = this.documents.findIndex(doc => {
      return Object.entries(query).every(([key, value]) => doc[key] === value);
    });
    
    if (docIndex >= 0) {
      this.documents.splice(docIndex, 1);
      return { deletedCount: 1 };
    }
    
    return { deletedCount: 0 };
  }
}

/**
 * Mock Redis client
 */
export class MockRedisClient extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.data = new Map();
    this.streams = new Map();
    this.pubsub = new EventEmitter();
  }

  async connect() {
    this.connected = true;
    this.emit('connect');
    return this;
  }

  async disconnect() {
    this.connected = false;
    this.emit('end');
  }

  async ping() {
    if (!this.connected) throw new Error('Not connected');
    return 'PONG';
  }

  async get(key) {
    if (!this.connected) throw new Error('Not connected');
    return this.data.get(key) || null;
  }

  async set(key, value, options) {
    if (!this.connected) throw new Error('Not connected');
    this.data.set(key, value);
    
    if (options?.EX) {
      setTimeout(() => this.data.delete(key), options.EX * 1000);
    }
    
    return 'OK';
  }

  async del(key) {
    if (!this.connected) throw new Error('Not connected');
    const existed = this.data.has(key);
    this.data.delete(key);
    return existed ? 1 : 0;
  }

  async hset(key, field, value) {
    if (!this.connected) throw new Error('Not connected');
    let hash = this.data.get(key) || {};
    hash[field] = value;
    this.data.set(key, hash);
    return 1;
  }

  async hget(key, field) {
    if (!this.connected) throw new Error('Not connected');
    const hash = this.data.get(key);
    return hash ? hash[field] || null : null;
  }

  async hgetall(key) {
    if (!this.connected) throw new Error('Not connected');
    return this.data.get(key) || {};
  }

  async xadd(stream, id, ...fieldsAndValues) {
    if (!this.connected) throw new Error('Not connected');
    
    if (!this.streams.has(stream)) {
      this.streams.set(stream, []);
    }
    
    const streamData = this.streams.get(stream);
    const entry = {
      id: id === '*' ? `${Date.now()}-0` : id,
      fields: {}
    };
    
    for (let i = 0; i < fieldsAndValues.length; i += 2) {
      entry.fields[fieldsAndValues[i]] = fieldsAndValues[i + 1];
    }
    
    streamData.push(entry);
    return entry.id;
  }

  async xread(count, block, ...streams) {
    if (!this.connected) throw new Error('Not connected');
    
    const results = [];
    for (let i = 0; i < streams.length; i += 2) {
      const streamName = streams[i];
      const lastId = streams[i + 1];
      
      if (this.streams.has(streamName)) {
        const entries = this.streams.get(streamName).filter(e => e.id > lastId);
        if (entries.length > 0) {
          results.push([streamName, entries.slice(0, count)]);
        }
      }
    }
    
    return results.length > 0 ? results : null;
  }

  async publish(channel, message) {
    if (!this.connected) throw new Error('Not connected');
    this.pubsub.emit(channel, message);
    return 1;
  }

  async subscribe(channel) {
    if (!this.connected) throw new Error('Not connected');
    // In real Redis, this would block
    return ['subscribe', channel, 1];
  }

  duplicate() {
    const duplicate = new MockRedisClient();
    duplicate.data = this.data;
    duplicate.streams = this.streams;
    duplicate.pubsub = this.pubsub;
    return duplicate;
  }
}

/**
 * Create mock database connectors
 */
export function createMockDatabaseConnectors() {
  const pgClient = new MockPostgresClient();
  const mongoClient = new MockMongoClient();
  const redisClient = new MockRedisClient();

  return {
    postgres: {
      connect: vi.fn(async () => {
        await pgClient.connect();
        return pgClient;
      }),
      disconnect: vi.fn(async () => {
        await pgClient.end();
      }),
      checkHealth: vi.fn(async () => ({
        connected: pgClient.connected,
        latency: 1,
        version: '14.0'
      })),
      query: vi.fn(async (sql, params) => {
        return pgClient.query(sql, params);
      }),
      _client: pgClient
    },
    
    mongodb: {
      connect: vi.fn(async () => {
        await mongoClient.connect();
        return mongoClient;
      }),
      disconnect: vi.fn(async () => {
        await mongoClient.close();
      }),
      checkHealth: vi.fn(async () => ({
        connected: mongoClient.connected,
        latency: 1,
        version: '5.0'
      })),
      getCollection: vi.fn((name) => {
        return mongoClient.db('test').collection(name);
      }),
      _client: mongoClient
    },
    
    redis: {
      connect: vi.fn(async () => {
        await redisClient.connect();
        return redisClient;
      }),
      disconnect: vi.fn(async () => {
        await redisClient.disconnect();
      }),
      checkHealth: vi.fn(async () => ({
        connected: redisClient.connected,
        latency: 1,
        version: '6.2'
      })),
      get: vi.fn(async (key) => redisClient.get(key)),
      set: vi.fn(async (key, value, options) => redisClient.set(key, value, options)),
      publish: vi.fn(async (channel, message) => redisClient.publish(channel, message)),
      _client: redisClient
    }
  };
}

/**
 * Create a mock BullMQ queue
 */
export function createMockQueue() {
  const jobs = new Map();
  let jobIdCounter = 1;

  return {
    add: vi.fn(async (name, data, options) => {
      const jobId = `job-${jobIdCounter++}`;
      const job = {
        id: jobId,
        name,
        data,
        opts: options,
        progress: 0,
        attemptsMade: 0,
        finishedOn: null,
        processedOn: null
      };
      jobs.set(jobId, job);
      return job;
    }),
    
    getJobs: vi.fn(async (types) => {
      return Array.from(jobs.values());
    }),
    
    getJob: vi.fn(async (jobId) => {
      return jobs.get(jobId) || null;
    }),
    
    close: vi.fn(async () => {
      jobs.clear();
    }),
    
    on: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
    
    _jobs: jobs
  };
}

export default {
  MockPostgresClient,
  MockMongoClient,
  MockRedisClient,
  createMockDatabaseConnectors,
  createMockQueue
};

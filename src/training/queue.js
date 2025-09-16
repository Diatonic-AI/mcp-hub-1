/**
 * Training Queue Configuration
 * BullMQ queues for training, evaluation, and batch prediction with retry and backoff
 */

import { Queue, Worker, QueueEvents } from 'bullmq';
import logger from '../utils/logger.js';
import { getBullMQConnection } from '../data/redis.js';
import { TrainingError } from '../utils/errors.js';

// Queue names
export const QUEUE_NAMES = {
  TRAINING: 'ml-training',
  EVALUATION: 'ml-evaluation',
  BATCH_PREDICT: 'ml-batch-predict',
  HPO: 'ml-hpo' // Hyperparameter optimization
};

// Default job options
const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: {
    age: 24 * 3600, // Keep completed jobs for 24 hours
    count: 100      // Keep last 100 completed jobs
  },
  removeOnFail: {
    age: 7 * 24 * 3600, // Keep failed jobs for 7 days
    count: 500          // Keep last 500 failed jobs
  },
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000  // Start with 2 second delay
  }
};

// Queue configurations
const QUEUE_CONFIGS = {
  [QUEUE_NAMES.TRAINING]: {
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      attempts: 3,
      timeout: 3600000 // 1 hour timeout for training jobs
    }
  },
  [QUEUE_NAMES.EVALUATION]: {
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      attempts: 2,
      timeout: 600000 // 10 minute timeout for evaluation
    }
  },
  [QUEUE_NAMES.BATCH_PREDICT]: {
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      attempts: 3,
      timeout: 1800000 // 30 minute timeout for batch predictions
    }
  },
  [QUEUE_NAMES.HPO]: {
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      attempts: 1, // HPO jobs manage their own retries
      timeout: 7200000 // 2 hour timeout for HPO
    }
  }
};

/**
 * Queue Manager for ML training pipeline
 */
export class TrainingQueueManager {
  constructor() {
    this.queues = {};
    this.workers = {};
    this.events = {};
    this.initialized = false;
  }

  /**
   * Initialize all queues
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Get connection options for BullMQ
      const connection = getBullMQConnection();

      // Initialize each queue
      for (const [name, config] of Object.entries(QUEUE_CONFIGS)) {
        this.queues[name] = new Queue(name, {
          connection,
          defaultJobOptions: config.defaultJobOptions
        });

        // Create queue events listener
        this.events[name] = new QueueEvents(name, { connection });

        logger.info('Queue initialized', {
          queue: name,
          config: config.defaultJobOptions
        });
      }

      this.initialized = true;
      logger.info('Training queue manager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize training queues', {
        error: error.message,
        stack: error.stack
      });
      throw new TrainingError('Queue initialization failed', { cause: error });
    }
  }

  /**
   * Get a specific queue
   */
  getQueue(name) {
    if (!this.initialized) {
      throw new TrainingError('Queue manager not initialized');
    }
    
    const queue = this.queues[name];
    if (!queue) {
      throw new TrainingError(`Queue not found: ${name}`);
    }
    
    return queue;
  }

  /**
   * Add a training job to the queue
   */
  async addTrainingJob(data, options = {}) {
    const queue = this.getQueue(QUEUE_NAMES.TRAINING);
    
    const job = await queue.add('train', {
      ...data,
      enqueuedAt: new Date().toISOString()
    }, {
      ...options,
      priority: options.priority || 0
    });

    logger.info('Training job added to queue', {
      jobId: job.id,
      modelName: data.modelName,
      tenant: data.tenant
    });

    return job;
  }

  /**
   * Add an evaluation job to the queue
   */
  async addEvaluationJob(data, options = {}) {
    const queue = this.getQueue(QUEUE_NAMES.EVALUATION);
    
    const job = await queue.add('evaluate', {
      ...data,
      enqueuedAt: new Date().toISOString()
    }, options);

    logger.info('Evaluation job added to queue', {
      jobId: job.id,
      modelId: data.modelId,
      tenant: data.tenant
    });

    return job;
  }

  /**
   * Add a batch prediction job to the queue
   */
  async addBatchPredictionJob(data, options = {}) {
    const queue = this.getQueue(QUEUE_NAMES.BATCH_PREDICT);
    
    const job = await queue.add('batch_predict', {
      ...data,
      enqueuedAt: new Date().toISOString()
    }, {
      ...options,
      // Batch jobs can be deprioritized
      priority: options.priority || -1
    });

    logger.info('Batch prediction job added to queue', {
      jobId: job.id,
      modelId: data.modelId,
      inputCount: data.inputCount,
      tenant: data.tenant
    });

    return job;
  }

  /**
   * Add an HPO (hyperparameter optimization) job
   */
  async addHPOJob(data, options = {}) {
    const queue = this.getQueue(QUEUE_NAMES.HPO);
    
    const job = await queue.add('hpo', {
      ...data,
      enqueuedAt: new Date().toISOString()
    }, {
      ...options,
      // HPO jobs are high priority
      priority: options.priority || 10
    });

    logger.info('HPO job added to queue', {
      jobId: job.id,
      studyName: data.studyName,
      trials: data.numTrials,
      tenant: data.tenant
    });

    return job;
  }

  /**
   * Get job by ID from specific queue
   */
  async getJobFromQueue(queueName, jobId) {
    const queue = this.getQueue(queueName);
    return await queue.getJob(jobId);
  }

  /**
   * Get job status and progress
   */
  async getJobStatus(queueName, jobId) {
    const job = await this.getJobFromQueue(queueName, jobId);
    
    if (!job) {
      return null;
    }

    const state = await job.getState();
    const progress = job.progress;
    const logs = await job.getChildrenValues();

    return {
      id: job.id,
      name: job.name,
      data: job.data,
      state,
      progress,
      attemptsMade: job.attemptsMade,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
      failedReason: job.failedReason,
      returnvalue: job.returnvalue,
      logs
    };
  }

  /**
   * Cancel a job
   */
  async cancelJob(queueName, jobId) {
    const job = await this.getJobFromQueue(queueName, jobId);
    
    if (!job) {
      throw new TrainingError(`Job not found: ${jobId}`);
    }

    await job.remove();
    
    logger.info('Job cancelled', {
      queue: queueName,
      jobId
    });

    return true;
  }

  /**
   * Get queue metrics
   */
  async getQueueMetrics(queueName) {
    const queue = this.getQueue(queueName);
    
    const [
      waiting,
      active,
      completed,
      failed,
      delayed,
      paused
    ] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
      queue.isPaused()
    ]);

    return {
      queue: queueName,
      counts: {
        waiting,
        active,
        completed,
        failed,
        delayed
      },
      isPaused: paused
    };
  }

  /**
   * Get all queue metrics
   */
  async getAllQueueMetrics() {
    const metrics = {};
    
    for (const queueName of Object.values(QUEUE_NAMES)) {
      metrics[queueName] = await this.getQueueMetrics(queueName);
    }

    return metrics;
  }

  /**
   * Pause a queue
   */
  async pauseQueue(queueName) {
    const queue = this.getQueue(queueName);
    await queue.pause();
    
    logger.info('Queue paused', { queue: queueName });
  }

  /**
   * Resume a queue
   */
  async resumeQueue(queueName) {
    const queue = this.getQueue(queueName);
    await queue.resume();
    
    logger.info('Queue resumed', { queue: queueName });
  }

  /**
   * Clean old jobs from queue
   */
  async cleanQueue(queueName, grace = 0, limit = 100, status = 'completed') {
    const queue = this.getQueue(queueName);
    
    const jobs = await queue.clean(grace, limit, status);
    
    logger.info('Queue cleaned', {
      queue: queueName,
      jobsRemoved: jobs.length,
      status
    });

    return jobs.length;
  }

  /**
   * Get a job by ID from any queue
   */
  async getJob(jobId) {
    // Try to find the job in all queues
    for (const queueName of Object.values(QUEUE_NAMES)) {
      const queue = this.queues[queueName];
      const job = await queue.getJob(jobId);
      if (job) {
        return job;
      }
    }
    return null;
  }

  /**
   * Get all queues
   */
  getAllQueues() {
    return this.queues;
  }

  /**
   * Gracefully shutdown all queues
   */
  async shutdown() {
    logger.info('Shutting down training queue manager...');

    // Close all queue connections
    for (const [name, queue] of Object.entries(this.queues)) {
      await queue.close();
      logger.info('Queue closed', { queue: name });
    }

    // Close all event listeners
    for (const [name, events] of Object.entries(this.events)) {
      await events.close();
      logger.info('Queue events closed', { queue: name });
    }

    // Close all workers if any
    for (const [name, worker] of Object.entries(this.workers)) {
      await worker.close();
      logger.info('Worker closed', { worker: name });
    }

    this.initialized = false;
    logger.info('Training queue manager shutdown complete');
  }
}

// Export singleton instance
export const trainingQueueManager = new TrainingQueueManager();

/**
 * Training Orchestrator
 * Manages training job lifecycle: QUEUED -> RUNNING -> SUCCEEDED/FAILED
 * Writes to training_runs table and coordinates with workers
 */

import { Worker } from 'bullmq';
import logger from '../utils/logger.js';
import { query } from '../data/postgres.js';
import { getClient as getMongoClient } from '../data/mongo.js';
import { getBullMQConnection } from '../data/redis.js';
import { TrainingError } from '../utils/errors.js';
import { QUEUE_NAMES, trainingQueueManager } from './queue.js';
import { validateTrainingJob } from './job_schema.js';
import { PythonWorkerAdapter } from './adapters/python-worker.js';
import { NodeBaselineTrainer } from './adapters/node-baseline.js';

// Training status enum (matches PostgreSQL enum)
export const TRAINING_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

/**
 * Training Orchestrator
 */
export class TrainingOrchestrator {
  constructor(options = {}) {
    this.workers = {};
    this.initialized = false;
    
    // Configuration
    this.config = {
      usePythonWorker: process.env.ML_USE_PYTHON_WORKER === 'true',
      pythonWorkerUrl: process.env.ML_PYTHON_WORKER_URL || 'http://localhost:8001',
      maxConcurrentJobs: parseInt(process.env.ML_MAX_CONCURRENT_JOBS) || 5,
      ...options
    };

    // Worker adapters
    this.pythonAdapter = new PythonWorkerAdapter({
      baseUrl: this.config.pythonWorkerUrl
    });
    this.nodeTrainer = new NodeBaselineTrainer();
  }

  /**
   * Initialize orchestrator and start workers
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Initialize queue manager
      await trainingQueueManager.initialize();

      // Get Redis connection for workers
      const connection = getBullMQConnection();

      // Create training worker
      this.workers.training = new Worker(
        QUEUE_NAMES.TRAINING,
        async (job) => await this.processTrainingJob(job),
        {
          connection,
          concurrency: this.config.maxConcurrentJobs,
          autorun: false
        }
      );

      // Create evaluation worker
      this.workers.evaluation = new Worker(
        QUEUE_NAMES.EVALUATION,
        async (job) => await this.processEvaluationJob(job),
        {
          connection,
          concurrency: this.config.maxConcurrentJobs * 2, // Evaluation is faster
          autorun: false
        }
      );

      // Create batch prediction worker
      this.workers.batchPredict = new Worker(
        QUEUE_NAMES.BATCH_PREDICT,
        async (job) => await this.processBatchPredictionJob(job),
        {
          connection,
          concurrency: Math.max(1, Math.floor(this.config.maxConcurrentJobs / 2)),
          autorun: false
        }
      );

      // Set up error handlers
      for (const [name, worker] of Object.entries(this.workers)) {
        worker.on('failed', (job, err) => {
          logger.error(`Worker job failed: ${name}`, {
            jobId: job.id,
            error: err.message,
            stack: err.stack
          });
        });

        worker.on('error', (err) => {
          logger.error(`Worker error: ${name}`, {
            error: err.message,
            stack: err.stack
          });
        });
      }

      this.initialized = true;
      logger.info('Training orchestrator initialized', {
        usePythonWorker: this.config.usePythonWorker,
        maxConcurrentJobs: this.config.maxConcurrentJobs
      });
    } catch (error) {
      logger.error('Failed to initialize training orchestrator', {
        error: error.message,
        stack: error.stack
      });
      throw new TrainingError('Orchestrator initialization failed', { cause: error });
    }
  }

  /**
   * Start all workers
   */
  async start() {
    if (!this.initialized) {
      await this.initialize();
    }

    for (const [name, worker] of Object.entries(this.workers)) {
      worker.run();
      logger.info(`Worker started: ${name}`);
    }

    logger.info('Training orchestrator started');
  }

  /**
   * Stop all workers
   */
  async stop() {
    logger.info('Stopping training orchestrator workers...');
    
    for (const [name, worker] of Object.entries(this.workers)) {
      try {
        await worker.close();
        logger.info(`Worker stopped: ${name}`);
      } catch (error) {
        logger.error(`Failed to stop worker: ${name}`, {
          error: error.message
        });
      }
    }
    
    logger.info('All workers stopped');
  }

  /**
   * Cleanup connections and resources
   */
  async cleanup() {
    logger.info('Cleaning up orchestrator resources...');
    
    // Close queue manager connections
    if (trainingQueueManager) {
      await trainingQueueManager.shutdown();
    }
    
    // Close adapters
    if (this.pythonAdapter) {
      await this.pythonAdapter.close();
    }
    
    if (this.nodeTrainer) {
      await this.nodeTrainer.cleanup();
    }
    
    logger.info('Cleanup completed');
  }

  /**
   * Get statistics about workers and queues
   */
  async getStats() {
    const stats = {
      workers: {},
      queues: {}
    };
    
    // Get worker status
    for (const [name, worker] of Object.entries(this.workers)) {
      stats.workers[name] = {
        isRunning: worker.isRunning(),
        isPaused: worker.isPaused()
      };
    }
    
    // Get queue metrics
    const queueMetrics = await trainingQueueManager.getQueueMetrics();
    for (const [queueName, metrics] of Object.entries(queueMetrics)) {
      stats.queues[queueName] = metrics;
    }
    
    return stats;
  }

  /**
   * Process a training job
   */
  async processTrainingJob(job) {
    const { tenant, modelName, config, datasetRef } = job.data;
    let runId = null;

    try {
      // Remove queue-added metadata fields before validation
      const jobDataForValidation = { ...job.data };
      delete jobDataForValidation.enqueuedAt;
      delete jobDataForValidation.processedAt;
      delete jobDataForValidation.completedAt;
      
      // Validate job data
      const validatedData = await validateTrainingJob(jobDataForValidation);

      // Create training run record
      runId = await this.createTrainingRun({
        tenant,
        modelName,
        config: validatedData.config,
        datasetRef: validatedData.datasetRef,
        jobId: job.id
      });

      // Update job progress
      await job.updateProgress(10);

      // Update run status to RUNNING
      await this.updateTrainingRunStatus(runId, TRAINING_STATUS.RUNNING);

      // Execute training based on configuration
      let result;
      if (this.config.usePythonWorker) {
        // Use Python worker for real training
        result = await this.pythonAdapter.train({
          runId,
          ...validatedData
        }, (progress) => {
          job.updateProgress(10 + progress * 0.8); // 10-90% for training
        });
      } else {
        // Use Node.js baseline trainer
        result = await this.nodeTrainer.train({
          runId,
          ...validatedData
        }, (progress) => {
          job.updateProgress(10 + progress * 0.8);
        });
      }

      // Save training artifacts
      await this.saveTrainingArtifacts(runId, result.artifacts);
      await job.updateProgress(95);

      // Update run with results
      await this.completeTrainingRun(runId, {
        metrics: result.metrics,
        modelPath: result.modelPath,
        hyperparameters: result.hyperparameters
      });

      await job.updateProgress(100);

      logger.info('Training job completed successfully', {
        jobId: job.id,
        runId,
        modelName,
        metrics: result.metrics
      });

      return {
        runId,
        status: TRAINING_STATUS.SUCCEEDED,
        metrics: result.metrics,
        modelPath: result.modelPath
      };

    } catch (error) {
      logger.error('Training job failed', {
        jobId: job.id,
        runId,
        error: error.message,
        stack: error.stack
      });

      // Update run status to FAILED if we have a runId
      if (runId) {
        await this.failTrainingRun(runId, error.message);
      }

      throw error;
    }
  }

  /**
   * Process an evaluation job
   */
  async processEvaluationJob(job) {
    const { tenant, modelId, datasetRef, metrics } = job.data;

    try {
      await job.updateProgress(10);

      // Load model and evaluate
      let result;
      if (this.config.usePythonWorker) {
        result = await this.pythonAdapter.evaluate({
          modelId,
          datasetRef,
          metrics
        }, (progress) => {
          job.updateProgress(10 + progress * 0.8);
        });
      } else {
        result = await this.nodeTrainer.evaluate({
          modelId,
          datasetRef,
          metrics
        }, (progress) => {
          job.updateProgress(10 + progress * 0.8);
        });
      }

      // Save evaluation results to database
      await this.saveEvaluationResults({
        tenant,
        modelId,
        ...result
      });

      await job.updateProgress(100);

      logger.info('Evaluation job completed', {
        jobId: job.id,
        modelId,
        metrics: result.metrics
      });

      return result;

    } catch (error) {
      logger.error('Evaluation job failed', {
        jobId: job.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Process a batch prediction job
   */
  async processBatchPredictionJob(job) {
    const { tenant, modelId, batchJobId, inputs } = job.data;

    try {
      await job.updateProgress(10);

      // Update batch job status
      await this.updateBatchJobStatus(batchJobId, 'running');

      // Process predictions in chunks
      const chunkSize = 100;
      const results = [];
      
      for (let i = 0; i < inputs.length; i += chunkSize) {
        const chunk = inputs.slice(i, i + chunkSize);
        
        let predictions;
        if (this.config.usePythonWorker) {
          predictions = await this.pythonAdapter.predict({
            modelId,
            inputs: chunk
          });
        } else {
          predictions = await this.nodeTrainer.predict({
            modelId,
            inputs: chunk
          });
        }

        // Save predictions to database
        await this.savePredictions({
          tenant,
          batchJobId,
          modelId,
          predictions
        });

        results.push(...predictions);

        // Update progress
        const progress = Math.min(90, 10 + (i / inputs.length) * 80);
        await job.updateProgress(progress);
      }

      // Complete batch job
      await this.completeBatchJob(batchJobId, results.length);
      await job.updateProgress(100);

      logger.info('Batch prediction job completed', {
        jobId: job.id,
        batchJobId,
        predictionsCount: results.length
      });

      return {
        batchJobId,
        predictionsCount: results.length
      };

    } catch (error) {
      logger.error('Batch prediction job failed', {
        jobId: job.id,
        error: error.message
      });

      if (batchJobId) {
        await this.updateBatchJobStatus(batchJobId, 'failed', error.message);
      }

      throw error;
    }
  }

  /**
   * Create a training run record
   */
  async createTrainingRun({ tenant, modelName, config, datasetRef, jobId }) {
    const result = await query(
      `INSERT INTO training_runs (
        tenant_id, run_name, model_name, status, config, dataset_info, 
        started_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING id`,
      [tenant, `${modelName}-${Date.now()}`, modelName, TRAINING_STATUS.QUEUED, config, datasetRef]
    );

    const runId = result.rows[0].id;

    // Log training event
    await this.logTrainingEvent(runId, 'JOB_CREATED', { jobId });

    return runId;
  }

  /**
   * Update training run status
   */
  async updateTrainingRunStatus(runId, status, message = null) {
    await query(
      `UPDATE training_runs 
       SET status = $2, updated_at = NOW()
       WHERE id = $1`,
      [runId, status]
    );

    await this.logTrainingEvent(runId, `STATUS_${status.toUpperCase()}`, { message });
  }

  /**
   * Complete a training run
   */
  async completeTrainingRun(runId, { metrics, modelPath, hyperparameters }) {
    await query(
      `UPDATE training_runs 
       SET status = $2, 
           metrics = $3,
           hyperparameters = $4,
           model_artifact_uri = $5,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [runId, TRAINING_STATUS.SUCCEEDED, metrics, hyperparameters, modelPath]
    );

    await this.logTrainingEvent(runId, 'TRAINING_COMPLETED', { metrics });
  }

  /**
   * Fail a training run
   */
  async failTrainingRun(runId, errorMessage) {
    await query(
      `UPDATE training_runs 
       SET status = $2,
           error_message = $3,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [runId, TRAINING_STATUS.FAILED, errorMessage]
    );

    await this.logTrainingEvent(runId, 'TRAINING_FAILED', { error: errorMessage });
  }

  /**
   * Save training artifacts to MongoDB GridFS
   */
  async saveTrainingArtifacts(runId, artifacts) {
    const mongoClient = await getMongoClient();
    const db = mongoClient.db();
    
    for (const artifact of artifacts) {
      const result = await db.collection('training_artifacts').insertOne({
        runId,
        name: artifact.name,
        type: artifact.type,
        size: artifact.size,
        path: artifact.path,
        createdAt: new Date()
      });

      await this.logTrainingEvent(runId, 'ARTIFACT_SAVED', {
        artifactId: result.insertedId,
        name: artifact.name
      });
    }
  }

  /**
   * Log training event
   */
  async logTrainingEvent(runId, eventType, data = {}) {
    await query(
      `INSERT INTO training_events (run_id, event_type, event_data, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [runId, eventType, data]
    );
  }

  /**
   * Save evaluation results
   */
  async saveEvaluationResults({ tenant, modelId, metrics, confusionMatrix }) {
    const result = await query(
      `INSERT INTO evaluation_metrics (
        tenant_id, model_id, metrics, 
        accuracy, precision_score, recall, f1_score,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING id`,
      [
        tenant, modelId, metrics,
        metrics.accuracy, metrics.precision, metrics.recall, metrics.f1,
      ]
    );

    if (confusionMatrix) {
      await query(
        `INSERT INTO confusion_matrices (evaluation_id, matrix, labels, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [result.rows[0].id, confusionMatrix.matrix, confusionMatrix.labels]
      );
    }

    return result.rows[0].id;
  }

  /**
   * Update batch job status
   */
  async updateBatchJobStatus(batchJobId, status, errorMessage = null) {
    const updateFields = ['status = $2', 'updated_at = NOW()'];
    const values = [batchJobId, status];

    if (status === 'running') {
      updateFields.push('started_at = NOW()');
    } else if (status === 'completed' || status === 'failed') {
      updateFields.push('completed_at = NOW()');
    }

    if (errorMessage) {
      updateFields.push(`error_message = $${values.length + 1}`);
      values.push(errorMessage);
    }

    await query(
      `UPDATE batch_jobs SET ${updateFields.join(', ')} WHERE id = $1`,
      values
    );
  }

  /**
   * Complete batch job
   */
  async completeBatchJob(batchJobId, predictionsCount) {
    await query(
      `UPDATE batch_jobs 
       SET status = 'completed',
           predictions_count = $2,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [batchJobId, predictionsCount]
    );
  }

  /**
   * Save predictions
   */
  async savePredictions({ tenant, batchJobId, modelId, predictions }) {
    const values = predictions.map(pred => [
      tenant,
      batchJobId,
      modelId,
      pred.inputRef,
      pred.inputData,
      pred.prediction,
      pred.confidence,
      pred.latencyMs,
      new Date()
    ]);

    // Bulk insert predictions
    const placeholders = values.map((_, i) => 
      `($${i * 9 + 1}, $${i * 9 + 2}, $${i * 9 + 3}, $${i * 9 + 4}, $${i * 9 + 5}, $${i * 9 + 6}, $${i * 9 + 7}, $${i * 9 + 8}, $${i * 9 + 9})`
    ).join(', ');

    await query(
      `INSERT INTO predictions (
        tenant_id, batch_job_id, model_id, input_ref, input_data,
        prediction, confidence, latency_ms, predicted_at
      ) VALUES ${placeholders}`,
      values.flat()
    );
  }

  /**
   * Get orchestrator status
   */
  async getStatus() {
    const queueMetrics = await trainingQueueManager.getAllQueueMetrics();
    
    const workerStatus = {};
    for (const [name, worker] of Object.entries(this.workers)) {
      workerStatus[name] = {
        isRunning: worker.isRunning(),
        isPaused: worker.isPaused()
      };
    }

    return {
      initialized: this.initialized,
      config: this.config,
      queues: queueMetrics,
      workers: workerStatus
    };
  }

  /**
   * Gracefully shutdown orchestrator
   */
  async shutdown() {
    logger.info('Shutting down training orchestrator...');

    // Stop all workers
    for (const [name, worker] of Object.entries(this.workers)) {
      await worker.close();
      logger.info(`Worker stopped: ${name}`);
    }

    // Shutdown queue manager
    await trainingQueueManager.shutdown();

    this.initialized = false;
    logger.info('Training orchestrator shutdown complete');
  }
}

// Export singleton instance
export const trainingOrchestrator = new TrainingOrchestrator();

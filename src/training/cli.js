#!/usr/bin/env node
/**
 * CLI for ML Job Submission
 * Usage: node cli.js <command> [options]
 */

import { Command } from 'commander';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { trainingQueueManager } from './queue.js';
import { trainingOrchestrator } from './orchestrator.js';
import logger from '../utils/logger.js';
import { TrainingJobSchema, EvaluationJobSchema, BatchPredictionJobSchema } from './job_schema.js';

const program = new Command();

program
  .name('ml-cli')
  .description('ML Pipeline CLI for job submission and monitoring')
  .version('1.0.0');

// Submit training job
program
  .command('train')
  .description('Submit a training job')
  .option('-t, --tenant <tenant>', 'Tenant ID', 'default')
  .option('-n, --name <name>', 'Model name', 'model')
  .option('--model-version <version>', 'Model version', '1.0.0')
  .option('-f, --framework <framework>', 'ML framework (scikit-learn, pytorch, tensorflow)', 'scikit-learn')
  .option('-d, --data <path>', 'Path to training data')
  .option('-c, --config <path>', 'Path to config JSON file')
  .option('-p, --priority <priority>', 'Job priority (1-10)', '5')
  .option('--epochs <epochs>', 'Number of epochs', '10')
  .option('--batch-size <size>', 'Batch size', '32')
  .option('--learning-rate <lr>', 'Learning rate', '0.001')
  .option('--task-type <type>', 'Task type (classification, regression)', 'classification')
  .action(async (options) => {
    try {
      // Initialize queue manager
      await trainingQueueManager.initialize();

      // Build config from options and file
      let config = {
        framework: options.framework,
        hyperparameters: {
          epochs: parseInt(options.epochs),
          batchSize: parseInt(options.batchSize),
          learningRate: parseFloat(options.learningRate),
          taskType: options.taskType
        }
      };

      // Load config from file if provided
      if (options.config) {
        const configPath = resolve(options.config);
        const fileConfig = JSON.parse(await readFile(configPath, 'utf8'));
        config = { ...config, ...fileConfig };
      }

      // Build job data
      const jobData = {
        tenant: options.tenant,
        modelName: options.name,
        config,
        datasetRef: {
          source: 'file',
          path: options.data || 'synthetic',
          format: 'json'
        },
        priority: parseInt(options.priority)
      };

      // Validate job data
      const validatedData = TrainingJobSchema.parse(jobData);

      // Queue the job
      const job = await trainingQueueManager.addTrainingJob(validatedData);
      
      console.log(`✅ Training job queued successfully`);
      console.log(`   Job ID: ${job.id}`);
      console.log(`   Model: ${options.name} v${options.modelVersion}`);
      console.log(`   Framework: ${options.framework}`);
      console.log(`   Priority: ${options.priority}`);
      console.log(`   Status: QUEUED`);
      console.log('');
      console.log(`Track progress with: ml-cli status ${job.id}`);

      process.exit(0);
    } catch (error) {
      console.error('❌ Error submitting training job:', error.message);
      process.exit(1);
    }
  });

// Submit evaluation job
program
  .command('evaluate')
  .description('Submit a model evaluation job')
  .option('-t, --tenant <tenant>', 'Tenant ID', 'default')
  .option('-m, --model <modelId>', 'Model ID to evaluate')
  .option('-d, --data <path>', 'Path to evaluation data')
  .option('-p, --priority <priority>', 'Job priority (1-10)', '5')
  .option('--metrics <metrics>', 'Comma-separated metrics (accuracy,precision,recall,f1)', 'accuracy,precision,recall,f1')
  .action(async (options) => {
    try {
      await trainingQueueManager.initialize();

      const jobData = {
        tenant: options.tenant,
        modelId: options.model || 'model-001',
        datasetRef: {
          source: 'file',
          path: options.data || 'synthetic',
          format: 'json'
        },
        metrics: options.metrics.split(',').map(m => m.trim()),
        priority: parseInt(options.priority)
      };

      const validatedData = EvaluationJobSchema.parse(jobData);
      const job = await trainingQueueManager.addEvaluationJob(validatedData);
      
      console.log(`✅ Evaluation job queued successfully`);
      console.log(`   Job ID: ${job.id}`);
      console.log(`   Model ID: ${options.model}`);
      console.log(`   Metrics: ${options.metrics}`);
      console.log(`   Status: QUEUED`);

      process.exit(0);
    } catch (error) {
      console.error('❌ Error submitting evaluation job:', error.message);
      process.exit(1);
    }
  });

// Submit batch prediction job
program
  .command('predict')
  .description('Submit a batch prediction job')
  .option('-t, --tenant <tenant>', 'Tenant ID', 'default')
  .option('-m, --model <modelId>', 'Model ID for predictions')
  .option('-i, --input <path>', 'Path to input data')
  .option('-o, --output <path>', 'Path for output predictions')
  .option('-b, --batch-size <size>', 'Batch size', '100')
  .option('-p, --priority <priority>', 'Job priority (1-10)', '5')
  .action(async (options) => {
    try {
      await trainingQueueManager.initialize();

      const jobData = {
        tenant: options.tenant,
        modelId: options.model,
        inputSource: 'json',  // Default to JSON
        inputRef: options.input || 'synthetic',
        outputLocation: options.output,
        outputFormat: 'json',
        batchSize: parseInt(options.batchSize),
        priority: parseInt(options.priority)
      };

      const validatedData = BatchPredictionJobSchema.parse(jobData);
      const job = await trainingQueueManager.addBatchPredictionJob(validatedData);
      
      console.log(`✅ Batch prediction job queued successfully`);
      console.log(`   Job ID: ${job.id}`);
      console.log(`   Model ID: ${options.model}`);
      console.log(`   Batch Size: ${options.batchSize}`);
      console.log(`   Status: QUEUED`);

      process.exit(0);
    } catch (error) {
      console.error('❌ Error submitting batch prediction job:', error.message);
      process.exit(1);
    }
  });

// Check job status
program
  .command('status [jobId]')
  .description('Check job status or queue metrics')
  .action(async (jobId) => {
    try {
      await trainingQueueManager.initialize();

      if (jobId) {
        // Get specific job status
        const job = await trainingQueueManager.getJob(jobId);
        
        if (!job) {
          console.log(`❌ Job not found: ${jobId}`);
          process.exit(1);
        }

        console.log(`📊 Job Status: ${jobId}`);
        console.log(`   State: ${await job.getState()}`);
        console.log(`   Progress: ${job.progress || 0}%`);
        console.log(`   Data:`, JSON.stringify(job.data, null, 2));
        
        if (job.failedReason) {
          console.log(`   Error: ${job.failedReason}`);
        }
        
        if (job.returnvalue) {
          console.log(`   Result:`, JSON.stringify(job.returnvalue, null, 2));
        }
      } else {
        // Get queue metrics
        const metrics = await trainingQueueManager.getAllQueueMetrics();
        
        console.log('📊 Queue Metrics:');
        for (const [queueName, queueMetrics] of Object.entries(metrics)) {
          console.log(`\n  ${queueName}:`);
          console.log(`    Waiting: ${queueMetrics.counts?.waiting || 0}`);
          console.log(`    Active: ${queueMetrics.counts?.active || 0}`);
          console.log(`    Completed: ${queueMetrics.counts?.completed || 0}`);
          console.log(`    Failed: ${queueMetrics.counts?.failed || 0}`);
          console.log(`    Delayed: ${queueMetrics.counts?.delayed || 0}`);
          console.log(`    Paused: ${queueMetrics.isPaused ? 'Yes' : 'No'}`);
        }
      }

      process.exit(0);
    } catch (error) {
      console.error('❌ Error checking status:', error.message);
      process.exit(1);
    }
  });

// Start orchestrator
program
  .command('start')
  .description('Start the training orchestrator workers')
  .option('--python', 'Use Python worker instead of Node baseline', false)
  .action(async (options) => {
    try {
      console.log('🚀 Starting training orchestrator...');
      
      // Set environment variable for Python worker
      if (options.python) {
        process.env.ML_USE_PYTHON_WORKER = 'true';
        console.log('   Using Python ML worker');
      } else {
        console.log('   Using Node.js baseline trainer');
      }

      // Initialize and start orchestrator
      await trainingOrchestrator.initialize();
      await trainingOrchestrator.start();
      
      console.log('✅ Training orchestrator started successfully');
      console.log('   Press Ctrl+C to stop');

      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down orchestrator...');
        await trainingOrchestrator.shutdown();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        await trainingOrchestrator.shutdown();
        process.exit(0);
      });

      // Keep process running
      await new Promise(() => {});
      
    } catch (error) {
      console.error('❌ Error starting orchestrator:', error.message);
      process.exit(1);
    }
  });

// List models
program
  .command('list-models')
  .description('List trained models')
  .option('-t, --tenant <tenant>', 'Tenant ID', 'default')
  .option('-l, --limit <limit>', 'Number of models to show', '10')
  .action(async (options) => {
    try {
      const { query } = await import('../data/postgres.js');
      
      const result = await query(
        `SELECT 
          id, model_name, model_version, status, 
          metrics->>'accuracy' as accuracy,
          created_at, completed_at
         FROM training_runs
         WHERE tenant_id = $1 AND status = 'succeeded'
         ORDER BY created_at DESC
         LIMIT $2`,
        [options.tenant, parseInt(options.limit)]
      );

      if (result.rows.length === 0) {
        console.log('No trained models found');
        process.exit(0);
      }

      console.log('📦 Trained Models:');
      console.log('');
      
      for (const model of result.rows) {
        console.log(`  ${model.model_name} v${model.model_version}`);
        console.log(`    ID: ${model.id}`);
        console.log(`    Accuracy: ${model.accuracy || 'N/A'}`);
        console.log(`    Trained: ${model.completed_at}`);
        console.log('');
      }

      process.exit(0);
    } catch (error) {
      console.error('❌ Error listing models:', error.message);
      process.exit(1);
    }
  });

// Cancel job
program
  .command('cancel <jobId>')
  .description('Cancel a queued or running job')
  .action(async (jobId) => {
    try {
      await trainingQueueManager.initialize();
      
      const job = await trainingQueueManager.getJob(jobId);
      if (!job) {
        console.log(`❌ Job not found: ${jobId}`);
        process.exit(1);
      }

      await job.remove();
      console.log(`✅ Job cancelled: ${jobId}`);
      
      process.exit(0);
    } catch (error) {
      console.error('❌ Error cancelling job:', error.message);
      process.exit(1);
    }
  });

// Clean failed jobs
program
  .command('clean')
  .description('Clean failed and completed jobs from queues')
  .option('--failed', 'Clean only failed jobs', false)
  .option('--completed', 'Clean only completed jobs', false)
  .action(async (options) => {
    try {
      await trainingQueueManager.initialize();
      
      const queues = await trainingQueueManager.getAllQueues();
      let totalCleaned = 0;

      for (const [name, queue] of Object.entries(queues)) {
        let cleaned = 0;
        
        if (!options.completed) {
          const failed = await queue.clean(0, 1000, 'failed');
          cleaned += failed.length;
        }
        
        if (!options.failed) {
          const completed = await queue.clean(0, 1000, 'completed');
          cleaned += completed.length;
        }
        
        if (cleaned > 0) {
          console.log(`  ${name}: Cleaned ${cleaned} jobs`);
          totalCleaned += cleaned;
        }
      }

      console.log(`✅ Total jobs cleaned: ${totalCleaned}`);
      process.exit(0);
    } catch (error) {
      console.error('❌ Error cleaning jobs:', error.message);
      process.exit(1);
    }
  });

program.parse(process.argv);

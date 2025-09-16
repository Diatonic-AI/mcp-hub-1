#!/usr/bin/env node

/**
 * Training Worker Startup Script
 * Starts the training orchestrator workers to process ML/DL jobs
 */

import dotenv from 'dotenv';
import logger from '../utils/logger.js';
import { TrainingOrchestrator } from './orchestrator.js';

// Load environment variables
dotenv.config();

// Create orchestrator instance
const orchestrator = new TrainingOrchestrator({
  usePythonWorker: false, // Use Node baseline for now
  maxConcurrentJobs: 3
});

// Graceful shutdown handling
let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }
  
  isShuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully...`);
  
  try {
    // Stop all workers
    await orchestrator.stop();
    logger.info('Workers stopped successfully');
    
    // Close connections
    await orchestrator.cleanup();
    logger.info('Cleanup completed');
    
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', {
    error: error.message,
    stack: error.stack
  });
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', {
    reason,
    promise
  });
  shutdown('unhandledRejection');
});

// Start the orchestrator
async function main() {
  try {
    logger.info('Starting training orchestrator workers...');
    
    // Initialize and start
    await orchestrator.initialize();
    await orchestrator.start();
    
    logger.info('Training orchestrator workers started successfully');
    logger.info('Workers are processing jobs from the following queues:', {
      queues: [
        'ml-training',
        'ml-evaluation',
        'ml-batch-predict',
        'ml-hpo'
      ]
    });
    
    // Log status every minute
    setInterval(async () => {
      try {
        const stats = await orchestrator.getStats();
        logger.info('Worker statistics', stats);
      } catch (error) {
        logger.error('Failed to get worker stats', {
          error: error.message
        });
      }
    }, 60000);
    
  } catch (error) {
    logger.error('Failed to start training orchestrator', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Run the main function
main();

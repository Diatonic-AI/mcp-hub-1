#!/usr/bin/env node
/**
 * Start the telemetry pipeline worker
 * Processes events from Redis streams to PostgreSQL
 */

import { telemetryPipeline } from '../src/telemetry/pipeline.js';
import logger from '../src/utils/logger.js';

async function startTelemetryWorker() {
  try {
    logger.info('Starting telemetry pipeline worker...');
    
    // Initialize the pipeline
    await telemetryPipeline.initialize();
    
    // Start processing
    await telemetryPipeline.start();
    
    logger.info('Telemetry pipeline worker started successfully');
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down telemetry worker...');
      await telemetryPipeline.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down telemetry worker...');
      await telemetryPipeline.stop();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Failed to start telemetry worker', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Start the worker
startTelemetryWorker();

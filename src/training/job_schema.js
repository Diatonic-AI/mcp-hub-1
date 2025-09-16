/**
 * Job Schema Validation
 * Zod validators for job payloads to fail fast on invalid data
 */

import { z } from 'zod';
import { ValidationError } from '../utils/errors.js';
import logger from '../utils/logger.js';

// Common schemas
const TenantSchema = z.string().min(1).max(255);
const ModelNameSchema = z.string().min(1).max(255);
const ModelIdSchema = z.string().uuid();

// Training configuration schema
const TrainingConfigSchema = z.object({
  // Model configuration
  modelType: z.enum(['classification', 'regression', 'clustering', 'time_series']).optional(),
  algorithm: z.string().optional(),
  framework: z.enum(['pytorch', 'tensorflow', 'scikit-learn', 'xgboost', 'lightgbm']).optional(),
  
  // Hyperparameters
  hyperparameters: z.record(z.any()).default({}),
  
  // Training settings
  epochs: z.number().int().positive().optional(),
  batchSize: z.number().int().positive().optional(),
  learningRate: z.number().positive().optional(),
  validationSplit: z.number().min(0).max(1).optional(),
  earlyStopping: z.boolean().optional(),
  patience: z.number().int().positive().optional(),
  
  // Resource configuration
  distributed: z.boolean().optional(),
  resources: z.object({
    gpus: z.number().int().min(0).optional(),
    workers: z.number().int().positive().optional(),
    memoryMb: z.number().int().positive().optional()
  }).optional(),
  
  // Optimization settings
  optimizer: z.string().optional(),
  lossFunction: z.string().optional(),
  metrics: z.array(z.string()).optional(),
  
  // Feature engineering
  featureSpecs: z.array(z.object({
    name: z.string(),
    type: z.enum(['numeric', 'categorical', 'text', 'embedding']),
    preprocessing: z.string().optional()
  })).optional()
}).strict();

// Dataset reference schema
const DatasetRefSchema = z.object({
  // Source type
  source: z.enum(['postgres', 'mongodb', 'file', 's3', 'redis']),
  
  // Source-specific configuration
  query: z.string().optional(), // For database sources
  collection: z.string().optional(), // For MongoDB
  path: z.string().optional(), // For file/S3 sources
  bucket: z.string().optional(), // For S3
  key: z.string().optional(), // For Redis
  
  // Data configuration
  format: z.enum(['csv', 'json', 'parquet', 'tfrecord']).optional(),
  features: z.array(z.string()).optional(),
  target: z.string().optional(),
  
  // Sampling
  sampleSize: z.number().int().positive().optional(),
  sampleStrategy: z.enum(['random', 'stratified', 'time_based']).optional(),
  
  // Preprocessing
  preprocessingPipeline: z.string().optional()
}).strict();

// Training job schema
export const TrainingJobSchema = z.object({
  tenant: TenantSchema,
  modelName: ModelNameSchema,
  config: TrainingConfigSchema,
  datasetRef: DatasetRefSchema,
  
  // Optional fields
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  priority: z.number().int().min(-10).max(10).optional(),
  
  // Experiment tracking
  experimentId: z.string().optional(),
  parentRunId: z.string().uuid().optional(),
  
  // Scheduling
  scheduledAt: z.string().datetime().optional(),
  deadline: z.string().datetime().optional()
}).strict();

// Evaluation job schema
export const EvaluationJobSchema = z.object({
  tenant: TenantSchema,
  modelId: ModelIdSchema,
  datasetRef: DatasetRefSchema,
  
  // Evaluation configuration
  metrics: z.array(z.enum([
    'accuracy', 'precision', 'recall', 'f1', 
    'auc_roc', 'auc_pr', 'mse', 'rmse', 'mae', 'r2'
  ])).min(1),
  
  // Optional configuration
  confusionMatrix: z.boolean().optional(),
  featureImportance: z.boolean().optional(),
  thresholdAnalysis: z.boolean().optional(),
  
  // Comparison
  compareWithModels: z.array(ModelIdSchema).optional(),
  
  // Tags and metadata
  tags: z.array(z.string()).optional(),
  description: z.string().optional()
}).strict();

// Batch prediction job schema
export const BatchPredictionJobSchema = z.object({
  tenant: TenantSchema,
  modelId: ModelIdSchema.optional(),
  modelAlias: z.string().optional(), // Alternative to modelId
  
  // Input configuration
  inputSource: z.enum(['query', 'csv', 'json', 'parquet']),
  inputRef: z.string(), // SQL query, file path, or data reference
  
  // Output configuration
  outputLocation: z.string().optional(),
  outputFormat: z.enum(['json', 'csv', 'parquet']).optional(),
  
  // Batch configuration
  batchSize: z.number().int().positive().default(100),
  parallelism: z.number().int().positive().default(1),
  timeoutSeconds: z.number().int().positive().default(3600),
  
  // Options
  includeProbabilities: z.boolean().optional(),
  includeExplanations: z.boolean().optional(),
  
  // Metadata
  correlationId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  description: z.string().optional()
}).strict().refine(
  (data) => data.modelId || data.modelAlias,
  { message: "Either modelId or modelAlias must be provided" }
);

// HPO job schema
export const HPOJobSchema = z.object({
  tenant: TenantSchema,
  studyName: z.string(),
  modelName: ModelNameSchema,
  
  // HPO configuration
  objective: z.enum(['minimize', 'maximize']),
  metric: z.string(),
  numTrials: z.number().int().positive(),
  
  // Search space
  searchSpace: z.record(z.object({
    type: z.enum(['int', 'float', 'categorical', 'log_uniform']),
    low: z.number().optional(),
    high: z.number().optional(),
    choices: z.array(z.any()).optional(),
    step: z.number().optional()
  })),
  
  // Algorithm configuration
  algorithm: z.enum(['random', 'grid', 'bayesian', 'tpe', 'optuna']).optional(),
  seed: z.number().int().optional(),
  
  // Training configuration for each trial
  baseConfig: TrainingConfigSchema,
  datasetRef: DatasetRefSchema,
  
  // Parallel execution
  parallelTrials: z.number().int().positive().optional(),
  
  // Early stopping
  pruning: z.boolean().optional(),
  minTrials: z.number().int().positive().optional(),
  
  // Metadata
  tags: z.array(z.string()).optional(),
  description: z.string().optional()
}).strict();

/**
 * Validate training job data
 */
export async function validateTrainingJob(data) {
  try {
    const validated = TrainingJobSchema.parse(data);
    
    // Additional business logic validation
    if (validated.config.distributed && !validated.config.resources?.workers) {
      throw new ValidationError('Distributed training requires workers configuration');
    }
    
    if (validated.scheduledAt && validated.deadline) {
      const scheduled = new Date(validated.scheduledAt);
      const deadline = new Date(validated.deadline);
      if (scheduled >= deadline) {
        throw new ValidationError('Scheduled time must be before deadline');
      }
    }
    
    logger.debug('Training job validated', {
      tenant: validated.tenant,
      modelName: validated.modelName
    });
    
    return validated;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      logger.error('Training job validation failed', {
        data,
        issues,
        zodErrors: error.errors
      });
      throw new ValidationError('Invalid training job data', { issues });
    }
    throw error;
  }
}

/**
 * Validate evaluation job data
 */
export async function validateEvaluationJob(data) {
  try {
    const validated = EvaluationJobSchema.parse(data);
    
    logger.debug('Evaluation job validated', {
      tenant: validated.tenant,
      modelId: validated.modelId
    });
    
    return validated;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      throw new ValidationError('Invalid evaluation job data', { issues });
    }
    throw error;
  }
}

/**
 * Validate batch prediction job data
 */
export async function validateBatchPredictionJob(data) {
  try {
    const validated = BatchPredictionJobSchema.parse(data);
    
    // Additional validation
    if (validated.batchSize > 1000) {
      throw new ValidationError('Batch size cannot exceed 1000');
    }
    
    if (validated.parallelism > 10) {
      throw new ValidationError('Parallelism cannot exceed 10');
    }
    
    logger.debug('Batch prediction job validated', {
      tenant: validated.tenant,
      modelId: validated.modelId,
      modelAlias: validated.modelAlias
    });
    
    return validated;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      throw new ValidationError('Invalid batch prediction job data', { issues });
    }
    throw error;
  }
}

/**
 * Validate HPO job data
 */
export async function validateHPOJob(data) {
  try {
    const validated = HPOJobSchema.parse(data);
    
    // Additional validation
    if (validated.numTrials > 1000) {
      throw new ValidationError('Number of trials cannot exceed 1000');
    }
    
    if (validated.parallelTrials && validated.parallelTrials > validated.numTrials) {
      throw new ValidationError('Parallel trials cannot exceed total trials');
    }
    
    // Validate search space
    for (const [param, config] of Object.entries(validated.searchSpace)) {
      if (config.type === 'categorical' && (!config.choices || config.choices.length === 0)) {
        throw new ValidationError(`Categorical parameter ${param} must have choices`);
      }
      
      if ((config.type === 'int' || config.type === 'float') && 
          (config.low === undefined || config.high === undefined)) {
        throw new ValidationError(`Numeric parameter ${param} must have low and high bounds`);
      }
      
      if (config.low !== undefined && config.high !== undefined && config.low >= config.high) {
        throw new ValidationError(`Parameter ${param}: low must be less than high`);
      }
    }
    
    logger.debug('HPO job validated', {
      tenant: validated.tenant,
      studyName: validated.studyName,
      numTrials: validated.numTrials
    });
    
    return validated;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      throw new ValidationError('Invalid HPO job data', { issues });
    }
    throw error;
  }
}

// Export schemas for external use
export const schemas = {
  TrainingJobSchema,
  EvaluationJobSchema,
  BatchPredictionJobSchema,
  HPOJobSchema
};

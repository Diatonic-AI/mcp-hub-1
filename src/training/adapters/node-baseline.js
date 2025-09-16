/**
 * Node.js Baseline Trainer Adapter
 * Simple ML trainer using JavaScript libraries for testing and baseline models
 */

import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs/promises';
import logger from '../../utils/logger.js';

// Trainer states
const TrainerState = {
  IDLE: 'idle',
  PREPARING: 'preparing',
  TRAINING: 'training',
  EVALUATING: 'evaluating',
  SAVING: 'saving',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

/**
 * Simple Linear Regression implementation
 */
class LinearRegression {
  constructor() {
    this.weights = null;
    this.bias = null;
    this.featureMeans = null;
    this.featureStds = null;
  }

  /**
   * Normalize features
   */
  normalize(X) {
    if (!this.featureMeans) {
      // Calculate means and stds
      const nSamples = X.length;
      const nFeatures = X[0].length;
      
      this.featureMeans = new Array(nFeatures).fill(0);
      this.featureStds = new Array(nFeatures).fill(0);
      
      // Calculate means
      for (let i = 0; i < nSamples; i++) {
        for (let j = 0; j < nFeatures; j++) {
          this.featureMeans[j] += X[i][j];
        }
      }
      
      for (let j = 0; j < nFeatures; j++) {
        this.featureMeans[j] /= nSamples;
      }
      
      // Calculate stds
      for (let i = 0; i < nSamples; i++) {
        for (let j = 0; j < nFeatures; j++) {
          this.featureStds[j] += Math.pow(X[i][j] - this.featureMeans[j], 2);
        }
      }
      
      for (let j = 0; j < nFeatures; j++) {
        this.featureStds[j] = Math.sqrt(this.featureStds[j] / nSamples) || 1;
      }
    }
    
    // Normalize
    const XNorm = X.map(row => 
      row.map((val, idx) => (val - this.featureMeans[idx]) / this.featureStds[idx])
    );
    
    return XNorm;
  }

  /**
   * Fit the model using gradient descent
   */
  fit(X, y, options = {}) {
    const learningRate = options.learningRate || 0.01;
    const epochs = options.epochs || 100;
    const verbose = options.verbose || false;
    
    // Normalize features
    const XNorm = this.normalize(X);
    
    const nSamples = XNorm.length;
    const nFeatures = XNorm[0].length;
    
    // Initialize weights and bias
    this.weights = new Array(nFeatures).fill(0).map(() => Math.random() * 0.01);
    this.bias = 0;
    
    const history = {
      loss: []
    };
    
    // Gradient descent
    for (let epoch = 0; epoch < epochs; epoch++) {
      let totalLoss = 0;
      
      // Calculate predictions
      const predictions = this.predict(X, true);
      
      // Calculate gradients
      const dw = new Array(nFeatures).fill(0);
      let db = 0;
      
      for (let i = 0; i < nSamples; i++) {
        const error = predictions[i] - y[i];
        totalLoss += error * error;
        
        for (let j = 0; j < nFeatures; j++) {
          dw[j] += error * XNorm[i][j];
        }
        db += error;
      }
      
      // Update weights and bias
      for (let j = 0; j < nFeatures; j++) {
        this.weights[j] -= (learningRate * dw[j]) / nSamples;
      }
      this.bias -= (learningRate * db) / nSamples;
      
      // Record loss
      const avgLoss = totalLoss / nSamples;
      history.loss.push(avgLoss);
      
      if (verbose && epoch % 10 === 0) {
        logger.debug(`Epoch ${epoch}: Loss = ${avgLoss.toFixed(6)}`);
      }
    }
    
    return history;
  }

  /**
   * Make predictions
   */
  predict(X, useNormalized = false) {
    if (!this.weights) {
      throw new Error('Model not trained yet');
    }
    
    const XToUse = useNormalized ? this.normalize(X) : this.normalize(X);
    
    return XToUse.map(row => {
      let pred = this.bias;
      for (let j = 0; j < row.length; j++) {
        pred += this.weights[j] * row[j];
      }
      return pred;
    });
  }

  /**
   * Calculate R-squared score
   */
  score(X, y) {
    const predictions = this.predict(X);
    const yMean = y.reduce((a, b) => a + b, 0) / y.length;
    
    let ssRes = 0;
    let ssTot = 0;
    
    for (let i = 0; i < y.length; i++) {
      ssRes += Math.pow(y[i] - predictions[i], 2);
      ssTot += Math.pow(y[i] - yMean, 2);
    }
    
    return 1 - (ssRes / ssTot);
  }

  /**
   * Export model parameters
   */
  toJSON() {
    return {
      weights: this.weights,
      bias: this.bias,
      featureMeans: this.featureMeans,
      featureStds: this.featureStds
    };
  }

  /**
   * Load model parameters
   */
  fromJSON(params) {
    this.weights = params.weights;
    this.bias = params.bias;
    this.featureMeans = params.featureMeans;
    this.featureStds = params.featureStds;
  }
}

/**
 * Simple Logistic Regression implementation
 */
class LogisticRegression {
  constructor() {
    this.weights = null;
    this.bias = null;
    this.featureMeans = null;
    this.featureStds = null;
  }

  /**
   * Sigmoid function
   */
  sigmoid(z) {
    return 1 / (1 + Math.exp(-z));
  }

  /**
   * Normalize features (same as LinearRegression)
   */
  normalize(X) {
    if (!this.featureMeans) {
      const nSamples = X.length;
      const nFeatures = X[0].length;
      
      this.featureMeans = new Array(nFeatures).fill(0);
      this.featureStds = new Array(nFeatures).fill(0);
      
      for (let i = 0; i < nSamples; i++) {
        for (let j = 0; j < nFeatures; j++) {
          this.featureMeans[j] += X[i][j];
        }
      }
      
      for (let j = 0; j < nFeatures; j++) {
        this.featureMeans[j] /= nSamples;
      }
      
      for (let i = 0; i < nSamples; i++) {
        for (let j = 0; j < nFeatures; j++) {
          this.featureStds[j] += Math.pow(X[i][j] - this.featureMeans[j], 2);
        }
      }
      
      for (let j = 0; j < nFeatures; j++) {
        this.featureStds[j] = Math.sqrt(this.featureStds[j] / nSamples) || 1;
      }
    }
    
    const XNorm = X.map(row => 
      row.map((val, idx) => (val - this.featureMeans[idx]) / this.featureStds[idx])
    );
    
    return XNorm;
  }

  /**
   * Fit the model
   */
  fit(X, y, options = {}) {
    const learningRate = options.learningRate || 0.01;
    const epochs = options.epochs || 100;
    const verbose = options.verbose || false;
    
    const XNorm = this.normalize(X);
    
    const nSamples = XNorm.length;
    const nFeatures = XNorm[0].length;
    
    this.weights = new Array(nFeatures).fill(0).map(() => Math.random() * 0.01);
    this.bias = 0;
    
    const history = {
      loss: [],
      accuracy: []
    };
    
    for (let epoch = 0; epoch < epochs; epoch++) {
      let totalLoss = 0;
      let correct = 0;
      
      const predictions = this.predictProba(X, true);
      
      const dw = new Array(nFeatures).fill(0);
      let db = 0;
      
      for (let i = 0; i < nSamples; i++) {
        const error = predictions[i] - y[i];
        
        // Binary cross-entropy loss
        const loss = -y[i] * Math.log(predictions[i] + 1e-7) - 
                     (1 - y[i]) * Math.log(1 - predictions[i] + 1e-7);
        totalLoss += loss;
        
        // Check accuracy
        const predClass = predictions[i] >= 0.5 ? 1 : 0;
        if (predClass === y[i]) correct++;
        
        for (let j = 0; j < nFeatures; j++) {
          dw[j] += error * XNorm[i][j];
        }
        db += error;
      }
      
      for (let j = 0; j < nFeatures; j++) {
        this.weights[j] -= (learningRate * dw[j]) / nSamples;
      }
      this.bias -= (learningRate * db) / nSamples;
      
      const avgLoss = totalLoss / nSamples;
      const accuracy = correct / nSamples;
      
      history.loss.push(avgLoss);
      history.accuracy.push(accuracy);
      
      if (verbose && epoch % 10 === 0) {
        logger.debug(`Epoch ${epoch}: Loss = ${avgLoss.toFixed(6)}, Accuracy = ${accuracy.toFixed(4)}`);
      }
    }
    
    return history;
  }

  /**
   * Predict probabilities
   */
  predictProba(X, useNormalized = false) {
    if (!this.weights) {
      throw new Error('Model not trained yet');
    }
    
    const XToUse = useNormalized ? this.normalize(X) : this.normalize(X);
    
    return XToUse.map(row => {
      let z = this.bias;
      for (let j = 0; j < row.length; j++) {
        z += this.weights[j] * row[j];
      }
      return this.sigmoid(z);
    });
  }

  /**
   * Predict classes
   */
  predict(X) {
    const probas = this.predictProba(X);
    return probas.map(p => p >= 0.5 ? 1 : 0);
  }

  /**
   * Calculate accuracy
   */
  score(X, y) {
    const predictions = this.predict(X);
    let correct = 0;
    
    for (let i = 0; i < y.length; i++) {
      if (predictions[i] === y[i]) correct++;
    }
    
    return correct / y.length;
  }

  /**
   * Export model parameters
   */
  toJSON() {
    return {
      weights: this.weights,
      bias: this.bias,
      featureMeans: this.featureMeans,
      featureStds: this.featureStds
    };
  }

  /**
   * Load model parameters
   */
  fromJSON(params) {
    this.weights = params.weights;
    this.bias = params.bias;
    this.featureMeans = params.featureMeans;
    this.featureStds = params.featureStds;
  }
}

/**
 * Node.js Baseline Trainer Adapter
 */
export class NodeBaselineTrainer extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.modelsDir = options.modelsDir || path.join(process.cwd(), 'ml-workers', 'models');
    this.dataDir = options.dataDir || path.join(process.cwd(), 'ml-workers', 'data');
    
    this.state = TrainerState.IDLE;
    this.currentModel = null;
    this.metrics = {};
  }

  /**
   * Initialize trainer
   */
  async initialize() {
    logger.info('Initializing Node.js baseline trainer');
    
    // Create necessary directories
    await fs.mkdir(this.modelsDir, { recursive: true });
    await fs.mkdir(this.dataDir, { recursive: true });
    
    return true;
  }

  /**
   * Generate synthetic data for testing
   */
  generateSyntheticData(options = {}) {
    const nSamples = options.nSamples || 1000;
    const nFeatures = options.nFeatures || 10;
    const taskType = options.taskType || 'regression';
    const noise = options.noise || 0.1;
    
    const X = [];
    const y = [];
    
    // Generate random features
    for (let i = 0; i < nSamples; i++) {
      const sample = [];
      for (let j = 0; j < nFeatures; j++) {
        sample.push(Math.random() * 10 - 5); // Random values between -5 and 5
      }
      X.push(sample);
    }
    
    // Generate target values
    if (taskType === 'regression') {
      // Linear relationship with noise
      const trueWeights = new Array(nFeatures).fill(0).map(() => Math.random() * 2 - 1);
      const trueBias = Math.random() * 2 - 1;
      
      for (let i = 0; i < nSamples; i++) {
        let target = trueBias;
        for (let j = 0; j < nFeatures; j++) {
          target += trueWeights[j] * X[i][j];
        }
        target += (Math.random() - 0.5) * noise;
        y.push(target);
      }
    } else {
      // Classification with logistic boundary
      const trueWeights = new Array(nFeatures).fill(0).map(() => Math.random() * 2 - 1);
      const trueBias = Math.random() * 2 - 1;
      
      for (let i = 0; i < nSamples; i++) {
        let logit = trueBias;
        for (let j = 0; j < nFeatures; j++) {
          logit += trueWeights[j] * X[i][j];
        }
        const prob = 1 / (1 + Math.exp(-logit));
        y.push(Math.random() < prob ? 1 : 0);
      }
    }
    
    return { X, y };
  }

  /**
   * Split data into train and validation sets
   */
  trainTestSplit(X, y, testSize = 0.2) {
    const nSamples = X.length;
    const nTest = Math.floor(nSamples * testSize);
    const nTrain = nSamples - nTest;
    
    // Shuffle indices
    const indices = Array.from({ length: nSamples }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    
    // Split data
    const XTrain = [];
    const yTrain = [];
    const XTest = [];
    const yTest = [];
    
    for (let i = 0; i < nTrain; i++) {
      XTrain.push(X[indices[i]]);
      yTrain.push(y[indices[i]]);
    }
    
    for (let i = nTrain; i < nSamples; i++) {
      XTest.push(X[indices[i]]);
      yTest.push(y[indices[i]]);
    }
    
    return { XTrain, yTrain, XTest, yTest };
  }

  /**
   * Train a model
   */
  async train(jobData, progressCallback) {
    if (this.state !== TrainerState.IDLE) {
      throw new Error(`Trainer is not idle, current state: ${this.state}`);
    }

    this.state = TrainerState.PREPARING;
    this.emit('stateChange', this.state);

    const {
      jobId,
      tenantId,
      modelName,
      modelVersion,
      hyperparameters,
      dataConfig,
      outputPath
    } = jobData;

    logger.info('Starting Node.js baseline training job', {
      jobId,
      modelName,
      taskType: hyperparameters.taskType
    });

    try {
      // Emit progress
      this.emit('progress', {
        jobId,
        message: 'Preparing data',
        timestamp: new Date().toISOString()
      });
      if (progressCallback) progressCallback(0.1);

      // Generate or load data
      let X, y;
      if (dataConfig?.path) {
        // Load data from file (implementation would depend on format)
        logger.info('Loading data from', dataConfig.path);
        // For now, generate synthetic data
        ({ X, y } = this.generateSyntheticData({
          ...hyperparameters,
          nSamples: dataConfig.nSamples || 1000
        }));
      } else {
        // Generate synthetic data
        ({ X, y } = this.generateSyntheticData(hyperparameters));
      }

      // Split data
      const { XTrain, yTrain, XTest, yTest } = this.trainTestSplit(X, y, 0.2);

      this.emit('progress', {
        jobId,
        message: 'Data prepared',
        metrics: {
          train_samples: XTrain.length,
          test_samples: XTest.length,
          n_features: XTrain[0].length
        },
        timestamp: new Date().toISOString()
      });
      if (progressCallback) progressCallback(0.3);

      // Create model
      this.state = TrainerState.TRAINING;
      this.emit('stateChange', this.state);

      const taskType = hyperparameters.taskType || 'regression';
      let model;
      
      if (taskType === 'regression') {
        model = new LinearRegression();
      } else {
        model = new LogisticRegression();
      }

      // Train model
      const history = model.fit(XTrain, yTrain, {
        learningRate: hyperparameters.learningRate || 0.01,
        epochs: hyperparameters.epochs || 100,
        verbose: true
      });

      // Evaluate model
      this.state = TrainerState.EVALUATING;
      this.emit('stateChange', this.state);

      const trainScore = model.score(XTrain, yTrain);
      const testScore = model.score(XTest, yTest);

      const metrics = {
        train_score: trainScore,
        test_score: testScore,
        final_loss: history.loss[history.loss.length - 1]
      };

      if (taskType === 'classification' && history.accuracy) {
        metrics.train_accuracy = history.accuracy[history.accuracy.length - 1];
      }

      this.emit('progress', {
        jobId,
        message: 'Model evaluated',
        metrics,
        timestamp: new Date().toISOString()
      });
      if (progressCallback) progressCallback(0.8);

      // Save model
      this.state = TrainerState.SAVING;
      this.emit('stateChange', this.state);

      const modelPath = outputPath || path.join(this.modelsDir, `${modelName}_${modelVersion}.json`);
      
      const modelData = {
        type: taskType === 'regression' ? 'LinearRegression' : 'LogisticRegression',
        name: modelName,
        version: modelVersion,
        tenantId,
        parameters: model.toJSON(),
        metrics,
        history,
        trainedAt: new Date().toISOString()
      };

      await fs.writeFile(modelPath, JSON.stringify(modelData, null, 2));

      this.emit('progress', {
        jobId,
        message: 'Model saved',
        metrics: {
          ...metrics,
          model_path: modelPath
        },
        timestamp: new Date().toISOString()
      });
      if (progressCallback) progressCallback(1.0);

      // Complete
      this.state = TrainerState.COMPLETED;
      this.emit('stateChange', this.state);
      this.currentModel = model;

      return {
        success: true,
        jobId,
        modelPath,
        metrics,
        history,
        artifacts: [
          { name: 'model', type: 'json', path: modelPath, size: 0 }
        ],
        hyperparameters: hyperparameters
      };

    } catch (error) {
      this.state = TrainerState.FAILED;
      this.emit('stateChange', this.state);
      
      logger.error('Training failed', { error: error.message });
      throw error;
      
    } finally {
      // Reset to idle after a delay
      setTimeout(() => {
        this.state = TrainerState.IDLE;
        this.emit('stateChange', this.state);
      }, 1000);
    }
  }

  /**
   * Evaluate a model
   */
  async evaluate(jobData, progressCallback) {
    const {
      jobId,
      modelPath,
      dataConfig
    } = jobData;

    logger.info('Executing evaluation job', { jobId, modelPath });

    try {
      // Load model
      const modelData = JSON.parse(await fs.readFile(modelPath, 'utf-8'));
      
      let model;
      if (modelData.type === 'LinearRegression') {
        model = new LinearRegression();
      } else {
        model = new LogisticRegression();
      }
      
      model.fromJSON(modelData.parameters);

      // Generate test data
      const { X, y } = this.generateSyntheticData({
        taskType: modelData.type === 'LinearRegression' ? 'regression' : 'classification',
        nSamples: dataConfig?.nSamples || 200
      });

      // Evaluate
      const score = model.score(X, y);
      
      const metrics = {
        score,
        model_type: modelData.type,
        test_samples: X.length
      };

      if (modelData.type === 'LogisticRegression') {
        metrics.accuracy = score;
      } else {
        metrics.r2_score = score;
      }

      return {
        success: true,
        jobId,
        metrics
      };

    } catch (error) {
      logger.error('Evaluation failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Make batch predictions
   */
  async predict(jobData) {
    const {
      jobId,
      modelPath,
      batchSize,
      outputPath
    } = jobData;

    logger.info('Executing batch prediction job', { jobId, modelPath });

    try {
      // Load model
      const modelData = JSON.parse(await fs.readFile(modelPath, 'utf-8'));
      
      let model;
      if (modelData.type === 'LinearRegression') {
        model = new LinearRegression();
      } else {
        model = new LogisticRegression();
      }
      
      model.fromJSON(modelData.parameters);

      // Generate data for prediction
      const nSamples = batchSize || 100;
      const nFeatures = modelData.parameters.weights.length;
      
      const X = [];
      for (let i = 0; i < nSamples; i++) {
        const sample = [];
        for (let j = 0; j < nFeatures; j++) {
          sample.push(Math.random() * 10 - 5);
        }
        X.push(sample);
      }

      // Make predictions
      const predictions = model.predict ? model.predict(X) : model.predictProba(X);

      // Save predictions
      const predPath = outputPath || path.join(this.dataDir, `predictions_${jobId}.json`);
      
      const predictionData = {
        jobId,
        modelName: modelData.name,
        modelVersion: modelData.version,
        predictions,
        samples: X,
        timestamp: new Date().toISOString()
      };

      await fs.writeFile(predPath, JSON.stringify(predictionData, null, 2));

      return {
        success: true,
        jobId,
        predictions: predictions.length,
        outputPath: predPath
      };

    } catch (error) {
      logger.error('Batch prediction failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Get current state
   */
  getState() {
    return {
      state: this.state,
      hasModel: !!this.currentModel,
      metrics: this.metrics
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    this.currentModel = null;
    this.state = 'idle';
    logger.info('Node baseline trainer cleaned up');
  }
}

export default NodeBaselineTrainer;

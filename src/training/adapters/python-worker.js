/**
 * Python Worker Adapter for ML Training
 * Bridges Node.js orchestrator with Python ML training scripts
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs/promises';
import logger from '../../utils/logger.js';

// Python worker states
const WorkerState = {
  IDLE: 'idle',
  PREPARING: 'preparing',
  TRAINING: 'training',
  EVALUATING: 'evaluating',
  SAVING: 'saving',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

/**
 * Python ML Worker Adapter
 * Manages communication with Python training processes
 */
export class PythonWorkerAdapter extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.pythonPath = options.pythonPath || 'python3';
    this.scriptsDir = options.scriptsDir || path.join(process.cwd(), 'ml-workers', 'scripts');
    this.modelsDir = options.modelsDir || path.join(process.cwd(), 'ml-workers', 'models');
    this.dataDir = options.dataDir || path.join(process.cwd(), 'ml-workers', 'data');
    this.venvPath = options.venvPath || path.join(process.cwd(), 'ml-workers', 'venv');
    
    this.currentProcess = null;
    this.state = WorkerState.IDLE;
    this.metrics = {};
  }

  /**
   * Initialize worker environment
   */
  async initialize() {
    logger.info('Initializing Python worker adapter', {
      pythonPath: this.pythonPath,
      scriptsDir: this.scriptsDir,
      venvPath: this.venvPath
    });

    // Create necessary directories
    await fs.mkdir(this.scriptsDir, { recursive: true });
    await fs.mkdir(this.modelsDir, { recursive: true });
    await fs.mkdir(this.dataDir, { recursive: true });

    // Check if Python is available
    const pythonAvailable = await this.checkPythonEnvironment();
    if (!pythonAvailable) {
      throw new Error('Python environment not available or properly configured');
    }

    // Create main training script if it doesn't exist
    await this.ensureTrainingScript();

    return true;
  }

  /**
   * Check Python environment availability
   */
  async checkPythonEnvironment() {
    try {
      return new Promise((resolve) => {
        const checkProcess = spawn(this.pythonPath, ['--version']);
        
        checkProcess.on('close', (code) => {
          resolve(code === 0);
        });
        
        checkProcess.on('error', () => {
          resolve(false);
        });
      });
    } catch (error) {
      logger.error('Failed to check Python environment', { error: error.message });
      return false;
    }
  }

  /**
   * Ensure training script exists
   */
  async ensureTrainingScript() {
    const scriptPath = path.join(this.scriptsDir, 'train_model.py');
    
    try {
      await fs.access(scriptPath);
    } catch {
      // Create a default training script
      const defaultScript = await this.generateDefaultTrainingScript();
      await fs.writeFile(scriptPath, defaultScript);
      logger.info('Created default training script', { path: scriptPath });
    }
  }

  /**
   * Generate default training script
   */
  generateDefaultTrainingScript() {
    return `#!/usr/bin/env python3
"""
ML Training Worker Script
Handles model training, evaluation, and saving
"""

import sys
import json
import time
import pickle
import numpy as np
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional

# Add common ML library imports based on framework
try:
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import DataLoader, TensorDataset
    ML_FRAMEWORK = 'pytorch'
except ImportError:
    try:
        import tensorflow as tf
        from tensorflow import keras
        ML_FRAMEWORK = 'tensorflow'
    except ImportError:
        from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
        from sklearn.model_selection import train_test_split
        from sklearn.metrics import accuracy_score, mean_squared_error
        ML_FRAMEWORK = 'sklearn'

def log_progress(message: str, metrics: Optional[Dict] = None):
    """Log training progress to stdout for Node.js to capture"""
    log_entry = {
        'timestamp': datetime.utcnow().isoformat(),
        'message': message,
        'metrics': metrics or {}
    }
    print(json.dumps(log_entry))
    sys.stdout.flush()

def load_data(config: Dict[str, Any]):
    """Load training data based on configuration"""
    data_path = config.get('dataPath')
    
    if not data_path:
        # Generate synthetic data for demo
        log_progress("Generating synthetic data for demo")
        if config.get('taskType') == 'classification':
            from sklearn.datasets import make_classification
            X, y = make_classification(
                n_samples=1000,
                n_features=20,
                n_informative=15,
                n_classes=2,
                random_state=42
            )
        else:
            from sklearn.datasets import make_regression
            X, y = make_regression(
                n_samples=1000,
                n_features=20,
                n_informative=15,
                noise=0.1,
                random_state=42
            )
        return X, y
    
    # Load actual data from path
    # Implementation depends on data format
    log_progress(f"Loading data from {data_path}")
    # ... data loading logic ...
    return None, None

def create_model(config: Dict[str, Any]):
    """Create model based on configuration and framework"""
    model_type = config.get('modelType', 'default')
    task_type = config.get('taskType', 'classification')
    
    if ML_FRAMEWORK == 'sklearn':
        if task_type == 'classification':
            return RandomForestClassifier(
                n_estimators=config.get('nEstimators', 100),
                max_depth=config.get('maxDepth', 10),
                random_state=42
            )
        else:
            return RandomForestRegressor(
                n_estimators=config.get('nEstimators', 100),
                max_depth=config.get('maxDepth', 10),
                random_state=42
            )
    
    elif ML_FRAMEWORK == 'pytorch':
        class SimpleNN(nn.Module):
            def __init__(self, input_dim, hidden_dim=64, output_dim=1):
                super().__init__()
                self.fc1 = nn.Linear(input_dim, hidden_dim)
                self.fc2 = nn.Linear(hidden_dim, hidden_dim)
                self.fc3 = nn.Linear(hidden_dim, output_dim)
                self.relu = nn.ReLU()
                self.dropout = nn.Dropout(0.2)
                
            def forward(self, x):
                x = self.relu(self.fc1(x))
                x = self.dropout(x)
                x = self.relu(self.fc2(x))
                x = self.dropout(x)
                x = self.fc3(x)
                return x
        
        return SimpleNN(
            input_dim=config.get('inputDim', 20),
            hidden_dim=config.get('hiddenDim', 64),
            output_dim=config.get('outputDim', 1)
        )
    
    elif ML_FRAMEWORK == 'tensorflow':
        model = keras.Sequential([
            keras.layers.Dense(64, activation='relu', input_shape=(config.get('inputDim', 20),)),
            keras.layers.Dropout(0.2),
            keras.layers.Dense(64, activation='relu'),
            keras.layers.Dropout(0.2),
            keras.layers.Dense(config.get('outputDim', 1))
        ])
        return model
    
    return None

def train_model(model, X_train, y_train, X_val, y_val, config: Dict[str, Any]):
    """Train the model based on framework"""
    epochs = config.get('epochs', 10)
    batch_size = config.get('batchSize', 32)
    learning_rate = config.get('learningRate', 0.001)
    
    history = {'train_loss': [], 'val_loss': [], 'train_metric': [], 'val_metric': []}
    
    if ML_FRAMEWORK == 'sklearn':
        # Simple fit for sklearn
        log_progress("Training sklearn model")
        model.fit(X_train, y_train)
        
        # Evaluate
        train_pred = model.predict(X_train)
        val_pred = model.predict(X_val)
        
        if config.get('taskType') == 'classification':
            train_metric = accuracy_score(y_train, train_pred)
            val_metric = accuracy_score(y_val, val_pred)
            metric_name = 'accuracy'
        else:
            train_metric = mean_squared_error(y_train, train_pred)
            val_metric = mean_squared_error(y_val, val_pred)
            metric_name = 'mse'
        
        history['train_metric'] = [train_metric]
        history['val_metric'] = [val_metric]
        
        log_progress(f"Training complete", {
            f'train_{metric_name}': train_metric,
            f'val_{metric_name}': val_metric
        })
    
    elif ML_FRAMEWORK == 'pytorch':
        # PyTorch training loop
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        model = model.to(device)
        
        # Convert data to tensors
        X_train_t = torch.FloatTensor(X_train).to(device)
        y_train_t = torch.FloatTensor(y_train).to(device)
        X_val_t = torch.FloatTensor(X_val).to(device)
        y_val_t = torch.FloatTensor(y_val).to(device)
        
        # Create data loaders
        train_dataset = TensorDataset(X_train_t, y_train_t)
        train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
        
        # Setup optimizer and loss
        optimizer = optim.Adam(model.parameters(), lr=learning_rate)
        criterion = nn.MSELoss() if config.get('taskType') == 'regression' else nn.BCEWithLogitsLoss()
        
        # Training loop
        for epoch in range(epochs):
            model.train()
            train_loss = 0
            
            for batch_X, batch_y in train_loader:
                optimizer.zero_grad()
                outputs = model(batch_X).squeeze()
                loss = criterion(outputs, batch_y)
                loss.backward()
                optimizer.step()
                train_loss += loss.item()
            
            # Validation
            model.eval()
            with torch.no_grad():
                val_outputs = model(X_val_t).squeeze()
                val_loss = criterion(val_outputs, y_val_t).item()
            
            avg_train_loss = train_loss / len(train_loader)
            history['train_loss'].append(avg_train_loss)
            history['val_loss'].append(val_loss)
            
            log_progress(f"Epoch {epoch+1}/{epochs}", {
                'epoch': epoch + 1,
                'train_loss': avg_train_loss,
                'val_loss': val_loss
            })
    
    elif ML_FRAMEWORK == 'tensorflow':
        # TensorFlow/Keras training
        model.compile(
            optimizer=keras.optimizers.Adam(learning_rate=learning_rate),
            loss='mse' if config.get('taskType') == 'regression' else 'binary_crossentropy',
            metrics=['mae'] if config.get('taskType') == 'regression' else ['accuracy']
        )
        
        history_tf = model.fit(
            X_train, y_train,
            validation_data=(X_val, y_val),
            epochs=epochs,
            batch_size=batch_size,
            verbose=0,
            callbacks=[
                keras.callbacks.LambdaCallback(
                    on_epoch_end=lambda epoch, logs: log_progress(
                        f"Epoch {epoch+1}/{epochs}",
                        {'epoch': epoch + 1, **logs}
                    )
                )
            ]
        )
        
        history = history_tf.history
    
    return model, history

def save_model(model, config: Dict[str, Any], history: Dict):
    """Save trained model"""
    model_path = Path(config.get('modelPath', 'model.pkl'))
    model_path.parent.mkdir(parents=True, exist_ok=True)
    
    log_progress(f"Saving model to {model_path}")
    
    if ML_FRAMEWORK == 'sklearn':
        with open(model_path, 'wb') as f:
            pickle.dump(model, f)
    elif ML_FRAMEWORK == 'pytorch':
        torch.save({
            'model_state_dict': model.state_dict(),
            'config': config,
            'history': history
        }, model_path)
    elif ML_FRAMEWORK == 'tensorflow':
        model.save(model_path)
    
    # Save training history
    history_path = model_path.parent / f"{model_path.stem}_history.json"
    with open(history_path, 'w') as f:
        json.dump(history, f, indent=2, default=str)
    
    log_progress("Model saved successfully", {
        'model_path': str(model_path),
        'history_path': str(history_path)
    })
    
    return str(model_path)

def main():
    """Main training entry point"""
    # Get configuration from command line
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'No configuration provided'}))
        sys.exit(1)
    
    try:
        config = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        print(json.dumps({'error': f'Invalid JSON configuration: {e}'}))
        sys.exit(1)
    
    log_progress("Starting training job", {'framework': ML_FRAMEWORK})
    
    try:
        # Load data
        X, y = load_data(config)
        
        # Split data
        from sklearn.model_selection import train_test_split
        X_train, X_val, y_train, y_val = train_test_split(
            X, y, test_size=0.2, random_state=42
        )
        
        log_progress("Data loaded and split", {
            'train_samples': len(X_train),
            'val_samples': len(X_val)
        })
        
        # Create model
        model = create_model(config)
        log_progress("Model created", {'model_type': type(model).__name__})
        
        # Train model
        model, history = train_model(model, X_train, y_train, X_val, y_val, config)
        
        # Save model
        model_path = save_model(model, config, history)
        
        # Final metrics
        final_metrics = {
            'status': 'completed',
            'model_path': model_path,
            'final_train_loss': history.get('train_loss', [0])[-1] if history.get('train_loss') else None,
            'final_val_loss': history.get('val_loss', [0])[-1] if history.get('val_loss') else None,
            'training_time': time.time()
        }
        
        log_progress("Training completed successfully", final_metrics)
        
    except Exception as e:
        error_msg = {'error': str(e), 'status': 'failed'}
        print(json.dumps(error_msg))
        sys.exit(1)

if __name__ == '__main__':
    main()
`;
  }

  /**
   * Train a model
   */
  async train(jobData, progressCallback) {
    if (this.state !== WorkerState.IDLE) {
      throw new Error(`Worker is not idle, current state: ${this.state}`);
    }

    this.state = WorkerState.PREPARING;
    this.emit('stateChange', this.state);

    const {
      jobId,
      tenantId,
      modelName,
      modelVersion,
      framework,
      hyperparameters,
      dataConfig,
      outputPath
    } = jobData;

    logger.info('Starting Python training job', {
      jobId,
      modelName,
      framework
    });

    // Prepare configuration for Python script
    const config = {
      jobId,
      tenantId,
      modelName,
      modelVersion,
      framework: framework || 'sklearn',
      taskType: hyperparameters.taskType || 'classification',
      ...hyperparameters,
      dataPath: dataConfig?.path,
      modelPath: outputPath || path.join(this.modelsDir, `${modelName}_${modelVersion}.pkl`)
    };

    // Use virtual environment Python if available
    const pythonCmd = await this.getPythonCommand();
    const scriptPath = path.join(this.scriptsDir, 'train_model.py');
    
    return new Promise((resolve, reject) => {
      try {
        this.state = WorkerState.TRAINING;
        this.emit('stateChange', this.state);

        // Spawn Python process
        this.currentProcess = spawn(pythonCmd, [
          scriptPath,
          JSON.stringify(config)
        ], {
          cwd: this.scriptsDir,
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1', // Ensure immediate output
            TF_CPP_MIN_LOG_LEVEL: '2' // Reduce TensorFlow logging
          }
        });

        let outputBuffer = '';
        let errorBuffer = '';
        const metrics = [];

        // Handle stdout (progress and metrics)
        this.currentProcess.stdout.on('data', (data) => {
          outputBuffer += data.toString();
          
          // Try to parse JSON lines
          const lines = outputBuffer.split('\n');
          outputBuffer = lines.pop(); // Keep incomplete line in buffer
          
          for (const line of lines) {
            if (line.trim()) {
              try {
                const message = JSON.parse(line);
                
                if (message.error) {
                  this.emit('error', new Error(message.error));
                } else {
                  // Emit progress event
                  this.emit('progress', {
                    jobId,
                    message: message.message,
                    metrics: message.metrics,
                    timestamp: message.timestamp
                  });
                  
                  // Call progress callback if provided
                  if (progressCallback && message.metrics?.progress) {
                    progressCallback(message.metrics.progress);
                  }
                  
                  // Store metrics
                  if (message.metrics) {
                    metrics.push(message.metrics);
                  }
                }
              } catch (e) {
                // Not JSON, just log it
                logger.debug('Python output', { output: line });
              }
            }
          }
        });

        // Handle stderr
        this.currentProcess.stderr.on('data', (data) => {
          errorBuffer += data.toString();
          logger.warn('Python stderr', { error: errorBuffer });
        });

        // Handle process exit
        this.currentProcess.on('close', (code) => {
          this.currentProcess = null;
          
          if (code === 0) {
            this.state = WorkerState.COMPLETED;
            this.emit('stateChange', this.state);
            
            // Extract final metrics
            const finalMetrics = metrics[metrics.length - 1] || {};
            
            resolve({
              success: true,
              jobId,
              modelPath: finalMetrics.model_path || config.modelPath,
              metrics: finalMetrics,
              history: metrics,
              artifacts: [],
              hyperparameters: config
            });
          } else {
            this.state = WorkerState.FAILED;
            this.emit('stateChange', this.state);
            
            reject(new Error(`Python process exited with code ${code}: ${errorBuffer}`));
          }
        });

        // Handle process errors
        this.currentProcess.on('error', (error) => {
          this.state = WorkerState.FAILED;
          this.emit('stateChange', this.state);
          reject(error);
        });

      } catch (error) {
        this.state = WorkerState.FAILED;
        this.emit('stateChange', this.state);
        reject(error);
      }
    });
  }

  /**
   * Evaluate a model
   */
  async evaluate(jobData, progressCallback) {
    // Similar to training but with evaluation script
    // Implementation would be similar to executeTraining
    logger.info('Executing evaluation job', { jobId: jobData.jobId });
    
    // For now, return mock results
    return {
      success: true,
      jobId: jobData.jobId,
      metrics: {
        accuracy: 0.92,
        precision: 0.91,
        recall: 0.93,
        f1_score: 0.92
      }
    };
  }

  /**
   * Make batch predictions
   */
  async predict(jobData) {
    // Similar to training but with prediction script
    logger.info('Executing batch prediction job', { jobId: jobData.jobId });
    
    // For now, return mock results
    return {
      success: true,
      jobId: jobData.jobId,
      predictions: jobData.batchSize || 100,
      outputPath: jobData.outputPath
    };
  }

  /**
   * Get Python command (use venv if available)
   */
  async getPythonCommand() {
    const venvPython = path.join(this.venvPath, 'bin', 'python');
    
    try {
      await fs.access(venvPython);
      return venvPython;
    } catch {
      return this.pythonPath;
    }
  }

  /**
   * Stop current process
   */
  async stop() {
    if (this.currentProcess) {
      logger.info('Stopping Python worker process');
      this.currentProcess.kill('SIGTERM');
      
      // Give it time to gracefully shutdown
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Force kill if still running
      if (this.currentProcess) {
        this.currentProcess.kill('SIGKILL');
      }
      
      this.currentProcess = null;
    }
    
    this.state = WorkerState.IDLE;
    this.emit('stateChange', this.state);
  }

  /**
   * Get current state
   */
  getState() {
    return {
      state: this.state,
      hasActiveProcess: !!this.currentProcess,
      metrics: this.metrics
    };
  }

  /**
   * Close adapter and cleanup resources
   */
  async close() {
    if (this.currentProcess) {
      await this.cancel();
    }
    logger.info('Python worker adapter closed');
  }
}

export default PythonWorkerAdapter;

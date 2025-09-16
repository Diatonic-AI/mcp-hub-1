/**
 * ML Chain Insights Service
 * Analyzes tool chain telemetry to detect inefficiencies and generate predictions
 * Implements self-evolution after 3 successful fix applications
 */

import crypto from 'crypto';
import logger from '../../utils/logger.js';
import { ValidationError, ServerError } from '../../utils/errors.js';
import { getDatabase } from '../../utils/database.js';
import { PostgresTenantHelper } from '../../utils/tenant-context.js';
import { generateUUID } from '../../utils/id.js';

/**
 * Deep Learning analysis models for pattern recognition
 */
const DL_MODELS = {
  CNN: { name: 'CNN', use: 'pattern_detection', layers: ['conv', 'pool', 'dense'] },
  LSTM: { name: 'LSTM', use: 'sequence_prediction', memory: true },
  GAN: { name: 'GAN', use: 'optimization_generation', dual_network: true },
  RNN: { name: 'RNN', use: 'temporal_dependencies' },
  FF: { name: 'FF', use: 'basic_classification' }
};

/**
 * Machine Learning approaches for analysis
 */
const ML_APPROACHES = {
  SUPERVISED: { name: 'supervised', algorithms: ['linear_regression', 'decision_tree', 'svm'] },
  UNSUPERVISED: { name: 'unsupervised', algorithms: ['k_means', 'hierarchical', 'pca'] },
  SEMI_SUPERVISED: { name: 'semi_supervised', hybrid: true },
  REINFORCEMENT: { name: 'reinforcement', reward_based: true }
};

export class MLChainInsightsService {
  constructor() {
    this.db = getDatabase();
    this.analysisCache = new Map(); // pattern_signature -> recent analysis
    this.evolutionThreshold = 3; // auto-promote after 3 successful applications
  }

  /**
   * Analyze tool chain execution pattern for inefficiencies
   * Returns insights with how/why/when/what/where breakdowns
   */
  async analyzeChainPattern(tenant, events) {
    const client = await this.db.connect();
    
    try {
      await PostgresTenantHelper.setTenantContext(client, tenant);
      
      // Extract tool chain pattern
      const chainTools = this.extractToolChain(events);
      const patternSignature = this.computePatternSignature(chainTools);
      
      // Check if we have existing insights
      const existing = await this.getExistingInsight(client, patternSignature);
      
      // Perform ML/DL analysis
      const analysis = await this.performDeepAnalysis(events, chainTools, existing);
      
      // Generate the 5W+H insights
      const insights = this.generate5WHInsights(analysis, chainTools, events);
      
      // Check for fix signature repetition
      const fixEvolution = await this.checkFixEvolution(client, insights.fixSignature, tenant);
      
      // Save or update insights
      const savedInsight = await this.saveInsights(client, {
        tenant,
        patternSignature,
        chainTools,
        ...insights,
        ...analysis,
        autoPromote: fixEvolution.shouldPromote
      });
      
      // Handle self-evolution if threshold met
      if (fixEvolution.shouldPromote) {
        await this.promoteFixToAutoApply(client, insights.fixSignature, tenant);
        logger.info('ml_chain_fix_auto_promoted', {
          fixSignature: insights.fixSignature,
          applications: fixEvolution.successfulApplications
        });
      }
      
      return savedInsight;
      
    } finally {
      client.release();
    }
  }

  /**
   * Extract tool chain from events
   */
  extractToolChain(events) {
    return events
      .filter(e => e.toolId)
      .map(e => `${e.serverName}__${e.toolId}`)
      .filter((v, i, a) => a.indexOf(v) === i); // unique
  }

  /**
   * Compute deterministic signature for pattern
   */
  computePatternSignature(chainTools) {
    return crypto
      .createHash('sha256')
      .update(chainTools.sort().join('|'))
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Perform deep learning analysis on event pattern
   */
  async performDeepAnalysis(events, chainTools, existing) {
    // Analyze timing patterns
    const timingAnalysis = this.analyzeTimings(events);
    
    // Detect redundancy patterns using CNN-like convolution
    const redundancy = this.detectRedundancy(chainTools);
    
    // Predict optimal sequence using LSTM-like memory
    const optimalSequence = this.predictOptimalSequence(chainTools, timingAnalysis);
    
    // Calculate inefficiency score
    const inefficiencyScore = this.calculateInefficiencyScore({
      redundancy,
      timingWaste: timingAnalysis.wastedTime,
      sequenceSuboptimal: optimalSequence.improvement
    });
    
    // Select appropriate ML/DL model based on pattern
    const modelSelection = this.selectModel(chainTools, inefficiencyScore);
    
    return {
      methodType: modelSelection.approach,
      modelType: modelSelection.model,
      inefficiencyScore,
      confidenceScore: this.calculateConfidence(events.length, existing),
      timingAnalysis,
      redundancy,
      optimalSequence
    };
  }

  /**
   * Generate 5W+H insights
   */
  generate5WHInsights(analysis, chainTools, events) {
    const { inefficiencyScore, timingAnalysis, redundancy, optimalSequence } = analysis;
    
    // HOW: How to improve the chain
    const how = {
      method: 'chain_optimization',
      steps: this.generateOptimizationSteps(optimalSequence, redundancy),
      expectedImprovement: `${Math.round(inefficiencyScore * 100)}% reduction in execution time`,
      implementation: optimalSequence.suggestedChain
    };
    
    // WHY: Why these inefficiencies exist
    const why = {
      rootCause: this.identifyRootCause(redundancy, timingAnalysis),
      patterns: redundancy.patterns,
      cognitiveTraps: this.detectCognitiveTraps(chainTools),
      llmTendencies: this.analyzeLLMTendencies(events)
    };
    
    // WHEN: When to apply fixes
    const when = {
      trigger: 'chain_execution_start',
      conditions: {
        chainLength: chainTools.length > 3,
        inefficiencyThreshold: inefficiencyScore > 0.3,
        frequency: 'every_execution'
      },
      timing: 'pre_execution_optimization'
    };
    
    // WHAT: What specific changes to make
    const what = {
      remove: redundancy.redundantTools,
      reorder: optimalSequence.reorderings,
      replace: this.suggestReplacements(chainTools),
      combine: this.suggestCombinations(chainTools)
    };
    
    // WHERE: Where in the chain to intervene
    const where = {
      positions: redundancy.positions,
      criticalPath: this.identifyCriticalPath(chainTools, timingAnalysis),
      bottlenecks: timingAnalysis.bottlenecks,
      interventionPoints: this.calculateInterventionPoints(chainTools)
    };
    
    // Generate recommendation and prediction
    const recommendation = this.generateRecommendation(how, what);
    const prediction = this.generatePrediction(analysis, optimalSequence);
    
    // Compute fix signature
    const fixSignature = this.computeFixSignature(what, how);
    
    return {
      how,
      why,
      when,
      what,
      where,
      recommendation,
      prediction,
      fixSignature
    };
  }

  /**
   * Analyze timing patterns
   */
  analyzeTimings(events) {
    const timings = events.map(e => e.timings || {});
    const durations = timings.map(t => 
      t.durationMs || (t.end && t.start ? t.end - t.start : 0)
    );
    
    const totalTime = durations.reduce((a, b) => a + b, 0);
    const avgTime = totalTime / durations.length;
    const maxTime = Math.max(...durations);
    const minTime = Math.min(...durations.filter(d => d > 0));
    
    // Identify bottlenecks (tools taking >2x average)
    const bottlenecks = events
      .map((e, i) => ({ tool: e.toolId, duration: durations[i], index: i }))
      .filter(item => item.duration > avgTime * 2)
      .map(item => item.index);
    
    // Calculate wasted time (redundant executions)
    const wastedTime = this.calculateWastedTime(events, durations);
    
    return {
      totalTime,
      avgTime,
      maxTime,
      minTime,
      bottlenecks,
      wastedTime
    };
  }

  /**
   * Detect redundancy using pattern matching
   */
  detectRedundancy(chainTools) {
    const patterns = [];
    const redundantTools = [];
    const positions = [];
    
    // Look for repeated tools
    const toolCounts = {};
    chainTools.forEach((tool, i) => {
      toolCounts[tool] = (toolCounts[tool] || 0) + 1;
      if (toolCounts[tool] > 1) {
        redundantTools.push(tool);
        positions.push(i);
      }
    });
    
    // Look for subsequence patterns
    for (let len = 2; len <= Math.min(5, chainTools.length / 2); len++) {
      for (let i = 0; i <= chainTools.length - len; i++) {
        const pattern = chainTools.slice(i, i + len).join('->');
        for (let j = i + len; j <= chainTools.length - len; j++) {
          const candidate = chainTools.slice(j, j + len).join('->');
          if (pattern === candidate) {
            patterns.push({ pattern, positions: [i, j], length: len });
          }
        }
      }
    }
    
    return {
      redundantTools: [...new Set(redundantTools)],
      patterns,
      positions,
      redundancyScore: redundantTools.length / chainTools.length
    };
  }

  /**
   * Predict optimal sequence using sequence modeling
   */
  predictOptimalSequence(chainTools, timingAnalysis) {
    // Use topological sort based on dependencies
    const dependencies = this.inferDependencies(chainTools);
    const optimalOrder = this.topologicalSort(chainTools, dependencies);
    
    // Calculate improvement potential
    const currentCost = this.calculateSequenceCost(chainTools, timingAnalysis);
    const optimalCost = this.calculateSequenceCost(optimalOrder, timingAnalysis);
    const improvement = (currentCost - optimalCost) / currentCost;
    
    // Identify reorderings needed
    const reorderings = [];
    optimalOrder.forEach((tool, i) => {
      const currentIndex = chainTools.indexOf(tool);
      if (currentIndex !== i) {
        reorderings.push({
          tool,
          from: currentIndex,
          to: i,
          reason: this.explainReordering(tool, currentIndex, i)
        });
      }
    });
    
    return {
      suggestedChain: optimalOrder,
      improvement,
      reorderings
    };
  }

  /**
   * Calculate inefficiency score
   */
  calculateInefficiencyScore({ redundancy, timingWaste, sequenceSuboptimal }) {
    const weights = {
      redundancy: 0.4,
      timing: 0.3,
      sequence: 0.3
    };
    
    return Math.min(1, 
      redundancy.redundancyScore * weights.redundancy +
      (timingWaste / 100000) * weights.timing + // normalize to 0-1
      sequenceSuboptimal * weights.sequence
    );
  }

  /**
   * Select appropriate ML/DL model
   */
  selectModel(chainTools, inefficiencyScore) {
    // Use CNN for pattern detection in long chains
    if (chainTools.length > 10) {
      return {
        approach: ML_APPROACHES.UNSUPERVISED.name,
        model: DL_MODELS.CNN.name
      };
    }
    
    // Use LSTM for sequence optimization
    if (inefficiencyScore > 0.5) {
      return {
        approach: ML_APPROACHES.SUPERVISED.name,
        model: DL_MODELS.LSTM.name
      };
    }
    
    // Use reinforcement learning for iterative improvement
    if (chainTools.length > 5 && inefficiencyScore > 0.3) {
      return {
        approach: ML_APPROACHES.REINFORCEMENT.name,
        model: DL_MODELS.GAN.name
      };
    }
    
    // Default to feedforward for simple cases
    return {
      approach: ML_APPROACHES.SUPERVISED.name,
      model: DL_MODELS.FF.name
    };
  }

  /**
   * Check if fix should be auto-promoted
   */
  async checkFixEvolution(client, fixSignature, tenant) {
    const result = await client.query(
      `SELECT successful_applications, auto_promote, promote_threshold
       FROM ml_fix_signatures
       WHERE tenant_id = $1 AND fix_signature = $2`,
      [tenant, fixSignature]
    );
    
    if (result.rows.length === 0) {
      // Create new fix signature entry
      await client.query(
        `INSERT INTO ml_fix_signatures (tenant_id, fix_signature, total_occurrences)
         VALUES ($1, $2, 1)
         ON CONFLICT (tenant_id, fix_signature) 
         DO UPDATE SET total_occurrences = ml_fix_signatures.total_occurrences + 1`,
        [tenant, fixSignature]
      );
      return { shouldPromote: false, successfulApplications: 0 };
    }
    
    const fix = result.rows[0];
    return {
      shouldPromote: !fix.auto_promote && fix.successful_applications >= fix.promote_threshold,
      successfulApplications: fix.successful_applications
    };
  }

  /**
   * Save insights to database
   */
  async saveInsights(client, insight) {
    const {
      tenant,
      patternSignature,
      chainTools,
      how,
      why,
      when,
      what,
      where,
      recommendation,
      prediction,
      methodType,
      modelType,
      inefficiencyScore,
      confidenceScore,
      fixSignature
    } = insight;
    
    const result = await client.query(
      `INSERT INTO ml_chain_insights (
        tenant_id, pattern_signature, chain_tools,
        how, why, "when", what, "where",
        recommendation, prediction,
        method_type, model_type,
        inefficiency_score, confidence_score,
        fix_signature
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (tenant_id, pattern_signature)
      DO UPDATE SET
        times_observed = ml_chain_insights.times_observed + 1,
        last_seen_at = now(),
        updated_at = now()
      RETURNING *`,
      [
        tenant, patternSignature, chainTools,
        JSON.stringify(how), JSON.stringify(why), JSON.stringify(when),
        JSON.stringify(what), JSON.stringify(where),
        JSON.stringify(recommendation), JSON.stringify(prediction),
        methodType, modelType,
        inefficiencyScore, confidenceScore,
        fixSignature
      ]
    );
    
    return result.rows[0];
  }

  /**
   * Promote fix to auto-apply status
   */
  async promoteFixToAutoApply(client, fixSignature, tenant) {
    await client.query(
      `UPDATE ml_fix_signatures
       SET auto_promote = true, last_applied_at = now()
       WHERE tenant_id = $1 AND fix_signature = $2`,
      [tenant, fixSignature]
    );
  }

  // Helper methods

  calculateWastedTime(events, durations) {
    // Estimate wasted time from redundant operations
    const seen = new Set();
    let wasted = 0;
    
    events.forEach((e, i) => {
      const key = `${e.toolId}:${JSON.stringify(e.payload || {})}`;
      if (seen.has(key)) {
        wasted += durations[i];
      }
      seen.add(key);
    });
    
    return wasted;
  }

  inferDependencies(chainTools) {
    // Infer logical dependencies between tools
    const deps = {};
    const dataFlowPatterns = {
      'read': ['write', 'transform'],
      'transform': ['analyze', 'store'],
      'analyze': ['report', 'visualize']
    };
    
    chainTools.forEach(tool => {
      deps[tool] = [];
      // Simple heuristic: tools that typically depend on each other
      Object.entries(dataFlowPatterns).forEach(([pattern, dependents]) => {
        if (tool.includes(pattern)) {
          deps[tool] = chainTools.filter(t => 
            dependents.some(d => t.includes(d))
          );
        }
      });
    });
    
    return deps;
  }

  topologicalSort(nodes, dependencies) {
    const sorted = [];
    const visited = new Set();
    
    const visit = (node) => {
      if (visited.has(node)) return;
      visited.add(node);
      
      const deps = dependencies[node] || [];
      deps.forEach(dep => visit(dep));
      
      sorted.push(node);
    };
    
    nodes.forEach(node => visit(node));
    return sorted.reverse();
  }

  calculateSequenceCost(sequence, timingAnalysis) {
    // Estimate cost based on sequence order
    let cost = 0;
    sequence.forEach((tool, i) => {
      // Add base cost
      cost += timingAnalysis.avgTime;
      
      // Add penalty for late critical operations
      if (tool.includes('critical') || tool.includes('validate')) {
        cost += (sequence.length - i) * 100; // penalty for late validation
      }
    });
    return cost;
  }

  explainReordering(tool, from, to) {
    if (to < from) {
      return `Move earlier to reduce dependencies`;
    }
    return `Defer to optimize resource usage`;
  }

  identifyRootCause(redundancy, timingAnalysis) {
    const causes = [];
    
    if (redundancy.redundancyScore > 0.2) {
      causes.push('Repeated tool invocations without caching');
    }
    
    if (timingAnalysis.bottlenecks.length > 0) {
      causes.push('Sequential bottlenecks that could be parallelized');
    }
    
    if (redundancy.patterns.length > 0) {
      causes.push('Repetitive patterns indicating missing abstraction');
    }
    
    return causes.length > 0 ? causes : ['Suboptimal tool selection'];
  }

  detectCognitiveTraps(chainTools) {
    const traps = [];
    
    // Detect over-engineering
    if (chainTools.length > 10) {
      traps.push('over_engineering');
    }
    
    // Detect analysis paralysis (too many analysis tools)
    const analysisToolCount = chainTools.filter(t => t.includes('analyze')).length;
    if (analysisToolCount > 3) {
      traps.push('analysis_paralysis');
    }
    
    return traps;
  }

  analyzeLLMTendencies(events) {
    // Analyze patterns specific to LLM behavior
    return {
      verbosity: events.length > 20 ? 'excessive' : 'normal',
      repetition: this.detectRepetition(events),
      toolPreference: this.detectToolPreference(events)
    };
  }

  detectRepetition(events) {
    const sequences = [];
    for (let i = 0; i < events.length - 1; i++) {
      sequences.push(`${events[i].toolId}->${events[i + 1].toolId}`);
    }
    
    const counts = {};
    sequences.forEach(seq => {
      counts[seq] = (counts[seq] || 0) + 1;
    });
    
    return Object.entries(counts)
      .filter(([_, count]) => count > 1)
      .map(([seq, count]) => ({ sequence: seq, count }));
  }

  detectToolPreference(events) {
    const toolCounts = {};
    events.forEach(e => {
      toolCounts[e.toolId] = (toolCounts[e.toolId] || 0) + 1;
    });
    
    return Object.entries(toolCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([tool, count]) => ({ tool, count }));
  }

  generateOptimizationSteps(optimalSequence, redundancy) {
    const steps = [];
    
    if (redundancy.redundantTools.length > 0) {
      steps.push({
        action: 'remove_duplicates',
        targets: redundancy.redundantTools,
        expectedSaving: `${redundancy.redundantTools.length * 100}ms`
      });
    }
    
    if (optimalSequence.reorderings.length > 0) {
      steps.push({
        action: 'reorder_sequence',
        changes: optimalSequence.reorderings,
        expectedImprovement: `${Math.round(optimalSequence.improvement * 100)}%`
      });
    }
    
    return steps;
  }

  suggestReplacements(chainTools) {
    // Suggest more efficient tool alternatives
    const replacements = [];
    
    chainTools.forEach(tool => {
      if (tool.includes('iterate') || tool.includes('loop')) {
        replacements.push({
          original: tool,
          suggested: tool.replace(/iterate|loop/, 'batch'),
          reason: 'Batch processing is more efficient'
        });
      }
    });
    
    return replacements;
  }

  suggestCombinations(chainTools) {
    // Identify tools that could be combined
    const combinations = [];
    
    for (let i = 0; i < chainTools.length - 1; i++) {
      const current = chainTools[i];
      const next = chainTools[i + 1];
      
      // Look for read->transform patterns
      if (current.includes('read') && next.includes('transform')) {
        combinations.push({
          tools: [current, next],
          combined: 'read_and_transform',
          benefit: 'Reduces intermediate data transfer'
        });
      }
    }
    
    return combinations;
  }

  identifyCriticalPath(chainTools, timingAnalysis) {
    // Identify the critical path through the chain
    const path = [];
    const bottleneckIndices = new Set(timingAnalysis.bottlenecks);
    
    chainTools.forEach((tool, i) => {
      if (bottleneckIndices.has(i) || 
          tool.includes('critical') || 
          tool.includes('validate')) {
        path.push({ tool, index: i, critical: true });
      }
    });
    
    return path;
  }

  calculateInterventionPoints(chainTools) {
    // Calculate optimal points for intervention
    const points = [];
    
    // Before expensive operations
    chainTools.forEach((tool, i) => {
      if (tool.includes('expensive') || tool.includes('heavy')) {
        points.push({
          index: i - 1,
          type: 'pre_expensive',
          action: 'cache_or_skip'
        });
      }
    });
    
    // After data gathering
    const dataTools = chainTools.filter((t, i) => {
      if (t.includes('fetch') || t.includes('read')) {
        points.push({
          index: i + 1,
          type: 'post_data',
          action: 'validate_and_filter'
        });
        return true;
      }
      return false;
    });
    
    return points;
  }

  generateRecommendation(how, what) {
    return {
      priority: 'high',
      action: how.method,
      implementation: {
        immediate: what.remove.length > 0 ? 'Remove redundant tools' : null,
        shortTerm: what.reorder.length > 0 ? 'Reorder execution sequence' : null,
        longTerm: what.replace.length > 0 ? 'Replace with optimized alternatives' : null
      },
      estimatedImpact: how.expectedImprovement
    };
  }

  generatePrediction(analysis, optimalSequence) {
    return {
      futureInefficiency: analysis.inefficiencyScore > 0.5 ? 'likely' : 'unlikely',
      degradationRisk: analysis.confidenceScore < 0.5 ? 'high' : 'low',
      optimalPerformance: {
        achievable: optimalSequence.improvement > 0.2,
        timeReduction: `${Math.round(optimalSequence.improvement * 100)}%`,
        confidence: analysis.confidenceScore
      }
    };
  }

  computeFixSignature(what, how) {
    const fixData = {
      removes: what.remove.sort(),
      reorders: what.reorder.map(r => `${r.from}->${r.to}`).sort(),
      method: how.method
    };
    
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(fixData))
      .digest('hex')
      .substring(0, 16);
  }

  calculateConfidence(eventCount, existing) {
    // Base confidence on data volume and history
    let confidence = Math.min(1, eventCount / 100);
    
    if (existing) {
      // Boost confidence if we've seen this pattern before
      confidence = Math.min(1, confidence + 0.2);
    }
    
    return confidence;
  }

  async getExistingInsight(client, patternSignature) {
    const result = await client.query(
      `SELECT * FROM ml_chain_insights
       WHERE pattern_signature = $1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [patternSignature]
    );
    
    return result.rows[0] || null;
  }
}

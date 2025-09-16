/**
 * Enhanced ML Telemetry Data Points
 * Implements 20 critical metrics for ML/DL process optimization
 * Each metric is designed to provide deeper insights for better orchestration
 */

import crypto from 'crypto';
import logger from '../../utils/logger.js';
import { ValidationError, ServerError } from '../../utils/errors.js';
import { generateUUID, generateGID, createEnvelope } from '../../utils/id.js';
import { getTenantContextManager } from '../../utils/tenant-context.js';

/**
 * Enhanced Telemetry Metrics Categories
 */
export const TELEMETRY_CATEGORIES = {
  TOKEN_ANALYTICS: 'token_analytics',
  CONTEXT_OPTIMIZATION: 'context_optimization',
  SEMANTIC_QUALITY: 'semantic_quality',
  INTERACTION_PATTERNS: 'interaction_patterns',
  GRADIENT_HEALTH: 'gradient_health',
  FEATURE_DYNAMICS: 'feature_dynamics',
  HALLUCINATION_DETECTION: 'hallucination_detection',
  CHAIN_COHERENCE: 'chain_coherence',
  PROMPT_EFFECTIVENESS: 'prompt_effectiveness',
  MEMORY_PERFORMANCE: 'memory_performance',
  CROSS_MODAL: 'cross_modal',
  RETRY_INTELLIGENCE: 'retry_intelligence',
  LATENT_EXPLORATION: 'latent_exploration',
  TOOL_SYNERGY: 'tool_synergy',
  UNCERTAINTY: 'uncertainty',
  DATA_LINEAGE: 'data_lineage',
  FEEDBACK_VELOCITY: 'feedback_velocity',
  RESOURCE_EFFICIENCY: 'resource_efficiency',
  ERROR_PROPAGATION: 'error_propagation',
  MODEL_STALENESS: 'model_staleness'
};

/**
 * Enhanced ML Telemetry Metrics Collector
 * Collects and analyzes 20 critical data points for ML/DL optimization
 */
export class EnhancedMLTelemetryMetrics {
  constructor() {
    this.tenantManager = getTenantContextManager();
    this.metricsBuffer = new Map();
    this.aggregationWindow = 60000; // 1 minute aggregation window
  }

  /**
   * 1. Token Consumption Analytics
   * Track token usage per operation, model, and chain execution
   */
  async collectTokenAnalytics(context) {
    const { operationId, modelId, chainId, tenant } = context;
    
    const metrics = {
      id: generateUUID(),
      category: TELEMETRY_CATEGORIES.TOKEN_ANALYTICS,
      tenant,
      operationId,
      modelId,
      chainId,
      timestamp: new Date(),
      data: {
        inputTokens: context.inputTokens || 0,
        outputTokens: context.outputTokens || 0,
        totalTokens: (context.inputTokens || 0) + (context.outputTokens || 0),
        tokenPerSecond: context.tokenPerSecond || 0,
        costEstimate: this.calculateTokenCost(context),
        efficiency: this.calculateTokenEfficiency(context),
        wastedTokens: context.wastedTokens || 0,
        tokenDistribution: {
          system: context.systemTokens || 0,
          user: context.userTokens || 0,
          assistant: context.assistantTokens || 0
        }
      }
    };

    await this.bufferMetric(metrics);
    return metrics;
  }

  /**
   * 2. Context Window Utilization
   * Measure utilized vs. wasted context window, optimize packing
   */
  async collectContextUtilization(context) {
    const { operationId, modelId, tenant } = context;
    
    const maxContextSize = context.maxContextSize || 128000;
    const usedContext = context.usedContext || 0;
    const utilization = (usedContext / maxContextSize) * 100;
    
    const metrics = {
      id: generateUUID(),
      category: TELEMETRY_CATEGORIES.CONTEXT_OPTIMIZATION,
      tenant,
      operationId,
      modelId,
      timestamp: new Date(),
      data: {
        maxContextSize,
        usedContext,
        utilization,
        wastedSpace: maxContextSize - usedContext,
        packingEfficiency: this.calculatePackingEfficiency(context),
        fragmentationScore: context.fragmentationScore || 0,
        optimalPacking: this.suggestOptimalPacking(context),
        retrievalCount: context.retrievalCount || 0,
        relevantChunks: context.relevantChunks || 0,
        irrelevantChunks: context.irrelevantChunks || 0
      }
    };

    await this.bufferMetric(metrics);
    return metrics;
  }

  /**
   * 3. Semantic Drift Detection
   * Detect divergence in embedding space distances between consecutive outputs
   */
  async collectSemanticDrift(context) {
    const { operationId, embeddings, previousEmbeddings, tenant } = context;
    
    const drift = this.calculateEmbeddingDistance(embeddings, previousEmbeddings);
    const threshold = context.driftThreshold || 0.3;
    
    const metrics = {
      id: generateUUID(),
      category: TELEMETRY_CATEGORIES.SEMANTIC_QUALITY,
      tenant,
      operationId,
      timestamp: new Date(),
      data: {
        driftScore: drift,
        driftThreshold: threshold,
        isDrifting: drift > threshold,
        embeddingDimensions: embeddings?.length || 0,
        cosineSimilarity: this.calculateCosineSimilarity(embeddings, previousEmbeddings),
        euclideanDistance: this.calculateEuclideanDistance(embeddings, previousEmbeddings),
        semanticCoherence: context.semanticCoherence || 0,
        topicConsistency: context.topicConsistency || 0,
        driftHistory: context.driftHistory || []
      }
    };

    await this.bufferMetric(metrics);
    return metrics;
  }

  /**
   * 4. Tool Interaction Entropy
   * Analyze predictability vs. randomness in tool selection
   */
  async collectToolEntropy(context) {
    const { operationId, toolSequence, tenant } = context;
    
    const entropy = this.calculateSequenceEntropy(toolSequence);
    const predictability = 1 - entropy;
    
    const metrics = {
      id: generateUUID(),
      category: TELEMETRY_CATEGORIES.INTERACTION_PATTERNS,
      tenant,
      operationId,
      timestamp: new Date(),
      data: {
        entropy,
        predictability,
        uniqueTools: new Set(toolSequence).size,
        totalTools: toolSequence.length,
        repetitionRatio: this.calculateRepetitionRatio(toolSequence),
        transitionMatrix: this.buildTransitionMatrix(toolSequence),
        mostCommonPatterns: this.findCommonPatterns(toolSequence),
        anomalousSequences: this.detectAnomalousSequences(toolSequence),
        optimalOrder: this.suggestOptimalOrder(toolSequence)
      }
    };

    await this.bufferMetric(metrics);
    return metrics;
  }

  /**
   * 5. Gradient Flow Health Metrics
   * Monitor gradient magnitudes, vanishing/exploding gradients
   */
  async collectGradientHealth(context) {
    const { operationId, modelId, gradients, tenant } = context;
    
    const gradientStats = this.analyzeGradients(gradients);
    
    const metrics = {
      id: generateUUID(),
      category: TELEMETRY_CATEGORIES.GRADIENT_HEALTH,
      tenant,
      operationId,
      modelId,
      timestamp: new Date(),
      data: {
        meanGradient: gradientStats.mean,
        stdGradient: gradientStats.std,
        maxGradient: gradientStats.max,
        minGradient: gradientStats.min,
        vanishingScore: gradientStats.vanishing,
        explodingScore: gradientStats.exploding,
        gradientNorm: gradientStats.norm,
        layerGradients: context.layerGradients || {},
        clipCount: context.clipCount || 0,
        healthStatus: this.determineGradientHealth(gradientStats)
      }
    };

    await this.bufferMetric(metrics);
    return metrics;
  }

  /**
   * 6. Feature Importance Dynamics
   * Track feature importance change over time and contexts
   */
  async collectFeatureImportance(context) {
    const { operationId, features, previousFeatures, tenant } = context;
    
    const importanceChange = this.calculateImportanceChange(features, previousFeatures);
    
    const metrics = {
      id: generateUUID(),
      category: TELEMETRY_CATEGORIES.FEATURE_DYNAMICS,
      tenant,
      operationId,
      timestamp: new Date(),
      data: {
        topFeatures: this.getTopFeatures(features, 10),
        importanceChange,
        volatility: this.calculateFeatureVolatility(context.featureHistory),
        emergingFeatures: this.identifyEmergingFeatures(features, previousFeatures),
        decliningFeatures: this.identifyDecliningFeatures(features, previousFeatures),
        featureCorrelations: this.calculateFeatureCorrelations(features),
        redundantFeatures: this.identifyRedundantFeatures(features),
        featureContribution: context.featureContribution || {}
      }
    };

    await this.bufferMetric(metrics);
    return metrics;
  }

  /**
   * 7. Hallucination Detection Score
   * Quantify likelihood of fabricated content generation
   */
  async collectHallucinationScore(context) {
    const { operationId, output, groundTruth, tenant } = context;
    
    const hallucinationScore = this.calculateHallucinationScore(output, groundTruth);
    
    const metrics = {
      id: generateUUID(),
      category: TELEMETRY_CATEGORIES.HALLUCINATION_DETECTION,
      tenant,
      operationId,
      timestamp: new Date(),
      data: {
        hallucinationScore,
        confidence: context.confidence || 0,
        factualityScore: this.calculateFactuality(output, groundTruth),
        consistencyScore: context.consistencyScore || 0,
        contradictions: this.detectContradictions(output),
        unsupportedClaims: this.findUnsupportedClaims(output, groundTruth),
        hallucinationType: this.classifyHallucination(hallucinationScore),
        mitigationSuggestions: this.suggestMitigation(hallucinationScore)
      }
    };

    await this.bufferMetric(metrics);
    return metrics;
  }

  /**
   * 8. Chain Coherence Index
   * Measure logical consistency across multi-step tool chains
   */
  async collectChainCoherence(context) {
    const { chainId, steps, tenant } = context;
    
    const coherenceScore = this.calculateChainCoherence(steps);
    
    const metrics = {
      id: generateUUID(),
      category: TELEMETRY_CATEGORIES.CHAIN_COHERENCE,
      tenant,
      chainId,
      timestamp: new Date(),
      data: {
        coherenceScore,
        logicalConsistency: this.assessLogicalConsistency(steps),
        dataFlowIntegrity: this.checkDataFlowIntegrity(steps),
        stepDependencies: this.analyzeDependencies(steps),
        breakPoints: this.identifyBreakPoints(steps),
        redundantSteps: this.findRedundantSteps(steps),
        missingSteps: this.identifyMissingSteps(steps),
        optimizationOpportunities: this.findOptimizations(steps)
      }
    };

    await this.bufferMetric(metrics);
    return metrics;
  }

  /**
   * 9. Prompt Template Effectiveness
   * Track success and quality metrics for prompt templates
   */
  async collectPromptEffectiveness(context) {
    const { templateId, promptId, result, tenant } = context;
    
    const effectiveness = this.calculatePromptEffectiveness(result);
    
    const metrics = {
      id: generateUUID(),
      category: TELEMETRY_CATEGORIES.PROMPT_EFFECTIVENESS,
      tenant,
      templateId,
      promptId,
      timestamp: new Date(),
      data: {
        effectiveness,
        successRate: context.successRate || 0,
        responseQuality: this.assessResponseQuality(result),
        tokenEfficiency: context.tokenEfficiency || 0,
        clarityScore: this.calculateClarity(context.prompt),
        ambiguityScore: this.calculateAmbiguity(context.prompt),
        templateVariations: context.variations || [],
        bestPerforming: this.identifyBestTemplate(context.history),
        improvementSuggestions: this.suggestPromptImprovements(context)
      }
    };

    await this.bufferMetric(metrics);
    return metrics;
  }

  /**
   * 10. Memory Pressure Indicators
   * Monitor working memory usage, cache hit rates, allocation patterns
   */
  async collectMemoryPressure(context) {
    const { operationId, tenant } = context;
    
    const memoryStats = this.analyzeMemoryUsage(context);
    
    const metrics = {
      id: generateUUID(),
      category: TELEMETRY_CATEGORIES.MEMORY_PERFORMANCE,
      tenant,
      operationId,
      timestamp: new Date(),
      data: {
        workingMemoryUsage: memoryStats.working,
        peakMemoryUsage: memoryStats.peak,
        cacheHitRate: memoryStats.cacheHitRate,
        cacheMissRate: memoryStats.cacheMissRate,
        allocationRate: memoryStats.allocationRate,
        gcPressure: memoryStats.gcPressure,
        memoryLeakRisk: this.assessMemoryLeakRisk(memoryStats),
        fragmentationScore: memoryStats.fragmentation,
        optimizationOpportunities: this.suggestMemoryOptimizations(memoryStats)
      }
    };

    await this.bufferMetric(metrics);
    return metrics;
  }

  /**
   * 11. Cross-Modal Alignment Scores
   * Measure alignment between different data modalities
   */
  async collectCrossModalAlignment(context) {
    const { operationId, modalities, tenant } = context;
    
    const alignmentScores = this.calculateModalAlignment(modalities);
    
    const metrics = {
      id: generateUUID(),
      category: TELEMETRY_CATEGORIES.CROSS_MODAL,
      tenant,
      operationId,
      timestamp: new Date(),
      data: {
        overallAlignment: alignmentScores.overall,
        pairwiseAlignments: alignmentScores.pairwise,
        modalityCount: modalities.length,
        dominantModality: this.identifyDominantModality(modalities),
        weakLinks: this.identifyWeakLinks(alignmentScores),
        fusionQuality: this.assessFusionQuality(modalities),
        modalityContributions: this.calculateModalityContributions(modalities),
        alignmentImprovement: this.suggestAlignmentImprovements(alignmentScores)
      }
    };

    await this.bufferMetric(metrics);
    return metrics;
  }

  /**
   * 12. Retry Pattern Intelligence
   * Analyze retry patterns distinguishing systematic failures
   */
  async collectRetryIntelligence(context) {
    const { operationId, retryHistory, tenant } = context;
    
    const retryAnalysis = this.analyzeRetryPatterns(retryHistory);
    
    const metrics = {
      id: generateUUID(),
      category: TELEMETRY_CATEGORIES.RETRY_INTELLIGENCE,
      tenant,
      operationId,
      timestamp: new Date(),
      data: {
        totalRetries: retryHistory.length,
        systematicFailures: retryAnalysis.systematic,
        transientFailures: retryAnalysis.transient,
        retrySuccessRate: retryAnalysis.successRate,
        avgRetriesNeeded: retryAnalysis.avgRetries,
        backoffEffectiveness: retryAnalysis.backoffScore,
        failurePatterns: retryAnalysis.patterns,
        predictedRetryNeed: this.predictRetryNeed(context),
        optimalRetryStrategy: this.suggestRetryStrategy(retryAnalysis)
      }
    };

    await this.bufferMetric(metrics);
    return metrics;
  }

  /**
   * 13. Latent Space Coverage
   * Assess model's exploration of latent representation space
   */
  async collectLatentCoverage(context) {
    const { modelId, latentVectors, tenant } = context;
    
    const coverage = this.calculateLatentCoverage(latentVectors);
    
    const metrics = {
      id: generateUUID(),
      category: TELEMETRY_CATEGORIES.LATENT_EXPLORATION,
      tenant,
      modelId,
      timestamp: new Date(),
      data: {
        coverageScore: coverage.score,
        exploredRegions: coverage.regions,
        densityMap: coverage.density,
        clusters: coverage.clusters,
        outliers: coverage.outliers,
        diversityScore: this.calculateDiversity(latentVectors),
        unexploredAreas: this.identifyUnexploredAreas(coverage),
        explorationRecommendations: this.suggestExploration(coverage)
      }
    };

    await this.bufferMetric(metrics);
    return metrics;
  }

  /**
   * 14. Tool Composition Synergy
   * Evaluate how well tools function together or cause interference
   */
  async collectToolSynergy(context) {
    const { chainId, tools, interactions, tenant } = context;
    
    const synergyAnalysis = this.analyzeToolSynergy(tools, interactions);
    
    const metrics = {
      id: generateUUID(),
      category: TELEMETRY_CATEGORIES.TOOL_SYNERGY,
      tenant,
      chainId,
      timestamp: new Date(),
      data: {
        synergyScore: synergyAnalysis.overall,
        positiveInteractions: synergyAnalysis.positive,
        negativeInteractions: synergyAnalysis.negative,
        interferencePatterns: synergyAnalysis.interference,
        complementaryPairs: synergyAnalysis.complementary,
        conflictingPairs: synergyAnalysis.conflicting,
        optimalCombinations: this.findOptimalCombinations(tools),
        avoidCombinations: this.findProblematicCombinations(tools),
        compositionSuggestions: this.suggestCompositions(synergyAnalysis)
      }
    };

    await this.bufferMetric(metrics);
    return metrics;
  }

  /**
   * 15. Uncertainty Quantification Metrics
   * Track confidence calibration and uncertainty estimates
   */
  async collectUncertaintyMetrics(context) {
    const { operationId, predictions, confidences, tenant } = context;
    
    const uncertainty = this.quantifyUncertainty(predictions, confidences);
    
    const metrics = {
      id: generateUUID(),
      category: TELEMETRY_CATEGORIES.UNCERTAINTY,
      tenant,
      operationId,
      timestamp: new Date(),
      data: {
        epistemicUncertainty: uncertainty.epistemic,
        aleatoricUncertainty: uncertainty.aleatoric,
        totalUncertainty: uncertainty.total,
        calibrationError: this.calculateCalibrationError(predictions, confidences),
        overconfidence: uncertainty.overconfidence,
        underconfidence: uncertainty.underconfidence,
        reliabilityDiagram: this.generateReliabilityDiagram(predictions, confidences),
        uncertaintyThreshold: context.threshold || 0.2,
        requiresReview: uncertainty.total > (context.threshold || 0.2)
      }
    };

    await this.bufferMetric(metrics);
    return metrics;
  }

  /**
   * 16. Data Lineage Completeness
   * Measure traceability of data transformations
   */
  async collectDataLineage(context) {
    const { operationId, lineage, tenant } = context;
    
    const completeness = this.assessLineageCompleteness(lineage);
    
    const metrics = {
      id: generateUUID(),
      category: TELEMETRY_CATEGORIES.DATA_LINEAGE,
      tenant,
      operationId,
      timestamp: new Date(),
      data: {
        completenessScore: completeness.score,
        tracedTransformations: completeness.traced,
        untracedTransformations: completeness.untraced,
        lineageDepth: completeness.depth,
        branchingFactor: completeness.branching,
        missingLinks: completeness.missing,
        dataProvenance: this.extractProvenance(lineage),
        transformationChain: this.buildTransformationChain(lineage),
        lineageGaps: this.identifyLineageGaps(lineage),
        recommendations: this.suggestLineageImprovements(completeness)
      }
    };

    await this.bufferMetric(metrics);
    return metrics;
  }

  /**
   * 17. Feedback Loop Velocity
   * Track speed of incorporating system feedback
   */
  async collectFeedbackVelocity(context) {
    const { feedbackEvents, tenant } = context;
    
    const velocity = this.calculateFeedbackVelocity(feedbackEvents);
    
    const metrics = {
      id: generateUUID(),
      category: TELEMETRY_CATEGORIES.FEEDBACK_VELOCITY,
      tenant,
      timestamp: new Date(),
      data: {
        avgResponseTime: velocity.avgResponse,
        minResponseTime: velocity.minResponse,
        maxResponseTime: velocity.maxResponse,
        incorporationRate: velocity.incorporationRate,
        feedbackBacklog: velocity.backlog,
        processingRate: velocity.processingRate,
        adaptationSpeed: velocity.adaptationSpeed,
        feedbackEffectiveness: this.assessFeedbackEffectiveness(feedbackEvents),
        bottlenecks: this.identifyFeedbackBottlenecks(velocity),
        accelerationOpportunities: this.suggestAcceleration(velocity)
      }
    };

    await this.bufferMetric(metrics);
    return metrics;
  }

  /**
   * 18. Resource Utilization Efficiency
   * Measure actual vs. theoretical resource use (CPU, GPU, network)
   */
  async collectResourceEfficiency(context) {
    const { operationId, resources, tenant } = context;
    
    const efficiency = this.calculateResourceEfficiency(resources);
    
    const metrics = {
      id: generateUUID(),
      category: TELEMETRY_CATEGORIES.RESOURCE_EFFICIENCY,
      tenant,
      operationId,
      timestamp: new Date(),
      data: {
        cpuEfficiency: efficiency.cpu,
        gpuEfficiency: efficiency.gpu,
        memoryEfficiency: efficiency.memory,
        networkEfficiency: efficiency.network,
        overallEfficiency: efficiency.overall,
        wastedResources: efficiency.wasted,
        underutilized: efficiency.underutilized,
        bottleneckResource: efficiency.bottleneck,
        scalingPotential: this.assessScalingPotential(resources),
        optimizationSuggestions: this.suggestResourceOptimizations(efficiency)
      }
    };

    await this.bufferMetric(metrics);
    return metrics;
  }

  /**
   * 19. Error Propagation Coefficient
   * Monitor error cascade and amplification
   */
  async collectErrorPropagation(context) {
    const { chainId, errors, tenant } = context;
    
    const propagation = this.analyzeErrorPropagation(errors);
    
    const metrics = {
      id: generateUUID(),
      category: TELEMETRY_CATEGORIES.ERROR_PROPAGATION,
      tenant,
      chainId,
      timestamp: new Date(),
      data: {
        propagationCoefficient: propagation.coefficient,
        amplificationFactor: propagation.amplification,
        cascadeDepth: propagation.depth,
        affectedSteps: propagation.affected,
        errorChains: propagation.chains,
        criticalPaths: propagation.critical,
        containmentPoints: this.identifyContainmentPoints(errors),
        mitigationStrategies: this.suggestErrorMitigation(propagation),
        resilienceScore: this.calculateResilience(propagation)
      }
    };

    await this.bufferMetric(metrics);
    return metrics;
  }

  /**
   * 20. Model Staleness Indicator
   * Detect model performance degradation due to data shift
   */
  async collectModelStaleness(context) {
    const { modelId, performanceHistory, tenant } = context;
    
    const staleness = this.assessModelStaleness(performanceHistory);
    
    const metrics = {
      id: generateUUID(),
      category: TELEMETRY_CATEGORIES.MODEL_STALENESS,
      tenant,
      modelId,
      timestamp: new Date(),
      data: {
        stalenessScore: staleness.score,
        performanceDegradation: staleness.degradation,
        dataShiftDetected: staleness.dataShift,
        conceptDrift: staleness.conceptDrift,
        lastRetraining: staleness.lastRetrained,
        daysSinceRetrain: staleness.daysSince,
        degradationRate: staleness.rate,
        predictedFailureDate: staleness.predictedFailure,
        retrainingUrgency: this.assessRetrainingUrgency(staleness),
        recommendations: this.suggestRetrainingStrategy(staleness)
      }
    };

    await this.bufferMetric(metrics);
    return metrics;
  }

  // Helper Methods

  calculateTokenCost(context) {
    const costPerToken = context.costPerToken || 0.00001;
    const totalTokens = (context.inputTokens || 0) + (context.outputTokens || 0);
    return totalTokens * costPerToken;
  }

  calculateTokenEfficiency(context) {
    const usefulTokens = context.totalTokens - (context.wastedTokens || 0);
    return context.totalTokens > 0 ? usefulTokens / context.totalTokens : 0;
  }

  calculatePackingEfficiency(context) {
    const idealPacking = context.idealPacking || 1.0;
    const actualPacking = context.actualPacking || 0.5;
    return actualPacking / idealPacking;
  }

  calculateEmbeddingDistance(embeddings, previousEmbeddings) {
    if (!embeddings || !previousEmbeddings) return 0;
    
    let sum = 0;
    for (let i = 0; i < embeddings.length; i++) {
      sum += Math.pow(embeddings[i] - (previousEmbeddings[i] || 0), 2);
    }
    return Math.sqrt(sum);
  }

  calculateCosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  calculateEuclideanDistance(a, b) {
    if (!a || !b) return Infinity;
    return this.calculateEmbeddingDistance(a, b);
  }

  calculateSequenceEntropy(sequence) {
    if (!sequence || sequence.length === 0) return 0;
    
    const frequency = {};
    for (const item of sequence) {
      frequency[item] = (frequency[item] || 0) + 1;
    }
    
    let entropy = 0;
    const total = sequence.length;
    
    for (const count of Object.values(frequency)) {
      const probability = count / total;
      if (probability > 0) {
        entropy -= probability * Math.log2(probability);
      }
    }
    
    return entropy;
  }

  calculateRepetitionRatio(sequence) {
    if (!sequence || sequence.length === 0) return 0;
    
    const unique = new Set(sequence).size;
    return 1 - (unique / sequence.length);
  }

  buildTransitionMatrix(sequence) {
    const matrix = {};
    
    for (let i = 0; i < sequence.length - 1; i++) {
      const from = sequence[i];
      const to = sequence[i + 1];
      
      if (!matrix[from]) matrix[from] = {};
      matrix[from][to] = (matrix[from][to] || 0) + 1;
    }
    
    return matrix;
  }

  findCommonPatterns(sequence, minLength = 2, maxLength = 5) {
    const patterns = {};
    
    for (let len = minLength; len <= maxLength && len <= sequence.length; len++) {
      for (let i = 0; i <= sequence.length - len; i++) {
        const pattern = sequence.slice(i, i + len).join('->');
        patterns[pattern] = (patterns[pattern] || 0) + 1;
      }
    }
    
    return Object.entries(patterns)
      .filter(([_, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  }

  detectAnomalousSequences(sequence) {
    // Simplified anomaly detection
    const anomalies = [];
    const transitionMatrix = this.buildTransitionMatrix(sequence);
    
    for (let i = 0; i < sequence.length - 1; i++) {
      const from = sequence[i];
      const to = sequence[i + 1];
      
      if (transitionMatrix[from] && transitionMatrix[from][to] === 1) {
        // Rare transition
        anomalies.push({ index: i, from, to, rarity: 'unique' });
      }
    }
    
    return anomalies;
  }

  suggestOptimalOrder(sequence) {
    // Simplified optimization suggestion
    const frequency = {};
    for (const item of sequence) {
      frequency[item] = (frequency[item] || 0) + 1;
    }
    
    return Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .map(([item]) => item);
  }

  analyzeGradients(gradients) {
    if (!gradients || gradients.length === 0) {
      return { mean: 0, std: 0, max: 0, min: 0, vanishing: 0, exploding: 0, norm: 0 };
    }
    
    const mean = gradients.reduce((a, b) => a + b, 0) / gradients.length;
    const variance = gradients.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / gradients.length;
    const std = Math.sqrt(variance);
    
    return {
      mean,
      std,
      max: Math.max(...gradients),
      min: Math.min(...gradients),
      vanishing: gradients.filter(g => Math.abs(g) < 1e-8).length / gradients.length,
      exploding: gradients.filter(g => Math.abs(g) > 1e3).length / gradients.length,
      norm: Math.sqrt(gradients.reduce((a, b) => a + b * b, 0))
    };
  }

  determineGradientHealth(stats) {
    if (stats.vanishing > 0.5) return 'unhealthy:vanishing';
    if (stats.exploding > 0.1) return 'unhealthy:exploding';
    if (stats.std < 0.001) return 'warning:low_variance';
    if (stats.std > 100) return 'warning:high_variance';
    return 'healthy';
  }

  async bufferMetric(metric) {
    const key = `${metric.tenant}_${metric.category}`;
    
    if (!this.metricsBuffer.has(key)) {
      this.metricsBuffer.set(key, []);
    }
    
    this.metricsBuffer.get(key).push(metric);
    
    // Trigger aggregation if buffer is large enough
    if (this.metricsBuffer.get(key).length >= 100) {
      await this.aggregateAndFlush(key);
    }
  }

  async aggregateAndFlush(key) {
    const metrics = this.metricsBuffer.get(key);
    if (!metrics || metrics.length === 0) return;
    
    // Aggregate metrics here (simplified for now)
    const aggregated = {
      category: metrics[0].category,
      tenant: metrics[0].tenant,
      count: metrics.length,
      startTime: metrics[0].timestamp,
      endTime: metrics[metrics.length - 1].timestamp,
      data: this.aggregateMetricData(metrics)
    };
    
    // Log aggregated metrics
    logger.info('ml_telemetry_aggregated', aggregated);
    
    // Clear buffer
    this.metricsBuffer.set(key, []);
    
    return aggregated;
  }

  aggregateMetricData(metrics) {
    // Simplified aggregation - in production, this would be more sophisticated
    const aggregated = {};
    
    for (const metric of metrics) {
      for (const [key, value] of Object.entries(metric.data)) {
        if (typeof value === 'number') {
          if (!aggregated[key]) {
            aggregated[key] = { sum: 0, count: 0, min: Infinity, max: -Infinity };
          }
          aggregated[key].sum += value;
          aggregated[key].count++;
          aggregated[key].min = Math.min(aggregated[key].min, value);
          aggregated[key].max = Math.max(aggregated[key].max, value);
        }
      }
    }
    
    // Calculate averages
    for (const key of Object.keys(aggregated)) {
      if (aggregated[key].count > 0) {
        aggregated[key].avg = aggregated[key].sum / aggregated[key].count;
      }
    }
    
    return aggregated;
  }

  // Additional helper methods would be implemented here...
  calculateImportanceChange(features, previousFeatures) {
    // Simplified implementation
    return 0.1;
  }

  getTopFeatures(features, n) {
    // Return top n features
    return features ? features.slice(0, n) : [];
  }

  calculateFeatureVolatility(history) {
    // Calculate variance in feature importance over time
    return 0.2;
  }

  identifyEmergingFeatures(features, previousFeatures) {
    // Find features gaining importance
    return [];
  }

  identifyDecliningFeatures(features, previousFeatures) {
    // Find features losing importance
    return [];
  }

  calculateFeatureCorrelations(features) {
    // Calculate correlation matrix
    return {};
  }

  identifyRedundantFeatures(features) {
    // Find highly correlated features
    return [];
  }

  calculateHallucinationScore(output, groundTruth) {
    // Simplified hallucination detection
    return Math.random() * 0.3; // Placeholder
  }

  calculateFactuality(output, groundTruth) {
    // Assess factual accuracy
    return 0.85;
  }

  detectContradictions(output) {
    // Find logical contradictions
    return [];
  }

  findUnsupportedClaims(output, groundTruth) {
    // Identify claims without support
    return [];
  }

  classifyHallucination(score) {
    if (score < 0.1) return 'minimal';
    if (score < 0.3) return 'low';
    if (score < 0.5) return 'moderate';
    if (score < 0.7) return 'high';
    return 'severe';
  }

  suggestMitigation(score) {
    const suggestions = [];
    if (score > 0.3) suggestions.push('Increase temperature parameter');
    if (score > 0.5) suggestions.push('Add factual grounding constraints');
    if (score > 0.7) suggestions.push('Use retrieval-augmented generation');
    return suggestions;
  }
  
  // ... Additional helper method implementations ...
}

// Singleton instance
let enhancedMetrics = null;

/**
 * Get or create Enhanced ML Telemetry Metrics instance
 */
export function getEnhancedMLTelemetryMetrics() {
  if (!enhancedMetrics) {
    enhancedMetrics = new EnhancedMLTelemetryMetrics();
  }
  return enhancedMetrics;
}

export default EnhancedMLTelemetryMetrics;

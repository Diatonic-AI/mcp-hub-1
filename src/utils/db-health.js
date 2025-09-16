/**
 * Unified Database Health Check Module
 * Provides health monitoring for PostgreSQL, MongoDB, and Redis
 */

import postgresDb from '../data/postgres.js';
import mongoDb from '../data/mongo.js';
import redisDb from '../data/redis.js';
import logger from './logger.js';

/**
 * Check PostgreSQL health
 * @returns {Promise<Object>} Health status
 */
const checkPostgresHealth = async () => {
    try {
        const status = await postgresDb.testConnection();
        const poolStats = postgresDb.getPoolStats();
        
        return {
            service: 'PostgreSQL',
            connected: status.connected,
            latency: null, // Will be measured in enhanced version
            details: {
                ...status.info,
                pool: poolStats
            },
            error: status.error || null
        };
    } catch (error) {
        logger.error('PostgreSQL health check failed', {
            code: 'HEALTH_PG_ERROR',
            error: error.message
        });
        
        return {
            service: 'PostgreSQL',
            connected: false,
            latency: null,
            details: null,
            error: error.message
        };
    }
};

/**
 * Check MongoDB health
 * @returns {Promise<Object>} Health status
 */
const checkMongoHealth = async () => {
    try {
        const status = await mongoDb.testConnection();
        
        return {
            service: 'MongoDB',
            connected: status.connected,
            latency: null,
            details: status.info,
            error: status.error || null
        };
    } catch (error) {
        logger.error('MongoDB health check failed', {
            code: 'HEALTH_MONGO_ERROR',
            error: error.message
        });
        
        return {
            service: 'MongoDB',
            connected: false,
            latency: null,
            details: null,
            error: error.message
        };
    }
};

/**
 * Check Redis health
 * @returns {Promise<Object>} Health status
 */
const checkRedisHealth = async () => {
    try {
        const status = await redisDb.testConnection();
        
        return {
            service: 'Redis',
            connected: status.connected,
            latency: null,
            details: status.info,
            error: status.error || null
        };
    } catch (error) {
        logger.error('Redis health check failed', {
            code: 'HEALTH_REDIS_ERROR',
            error: error.message
        });
        
        return {
            service: 'Redis',
            connected: false,
            latency: null,
            details: null,
            error: error.message
        };
    }
};

/**
 * Check all database health statuses
 * @param {Object} options - Health check options
 * @param {boolean} options.includeDetails - Include detailed information
 * @param {Array<string>} options.services - Specific services to check
 * @returns {Promise<Object>} Combined health status
 */
export const checkAllHealth = async (options = {}) => {
    const {
        includeDetails = true,
        services = ['postgresql', 'mongodb', 'redis']
    } = options;
    
    const startTime = Date.now();
    const healthChecks = [];
    
    // Check requested services in parallel
    const checkPromises = [];
    
    if (services.includes('postgresql')) {
        checkPromises.push(checkPostgresHealth());
    }
    
    if (services.includes('mongodb')) {
        checkPromises.push(checkMongoHealth());
    }
    
    if (services.includes('redis')) {
        checkPromises.push(checkRedisHealth());
    }
    
    const results = await Promise.allSettled(checkPromises);
    
    // Process results
    for (const result of results) {
        if (result.status === 'fulfilled') {
            healthChecks.push(result.value);
        } else {
            healthChecks.push({
                service: 'Unknown',
                connected: false,
                latency: null,
                details: null,
                error: result.reason?.message || 'Health check failed'
            });
        }
    }
    
    const duration = Date.now() - startTime;
    const allHealthy = healthChecks.every(check => check.connected);
    const healthyCount = healthChecks.filter(check => check.connected).length;
    
    const response = {
        ok: allHealthy,
        timestamp: new Date().toISOString(),
        duration,
        summary: {
            total: healthChecks.length,
            healthy: healthyCount,
            unhealthy: healthChecks.length - healthyCount
        },
        services: {}
    };
    
    // Build service-specific responses
    for (const check of healthChecks) {
        const serviceName = check.service.toLowerCase();
        response.services[serviceName] = {
            connected: check.connected,
            error: check.error
        };
        
        if (includeDetails && check.details) {
            response.services[serviceName].details = check.details;
        }
    }
    
    // Add ML-specific health indicators
    response.mlPipeline = {
        ready: allHealthy,
        components: {
            metadata: response.services.postgresql?.connected || false,
            artifacts: response.services.mongodb?.connected || false,
            cache: response.services.redis?.connected || false
        }
    };
    
    logger.info('Database health check completed', {
        code: 'HEALTH_CHECK_COMPLETE',
        ok: allHealthy,
        duration,
        summary: response.summary
    });
    
    return response;
};

/**
 * Check ML pipeline specific health
 * @returns {Promise<Object>} ML pipeline health status
 */
export const checkMLPipelineHealth = async () => {
    const health = await checkAllHealth();
    
    // Additional ML-specific checks
    const mlChecks = {
        featureStore: false,
        modelRegistry: false,
        trainingQueue: false,
        inferenceCache: false
    };
    
    try {
        // Check if PostgreSQL ML tables exist
        if (health.services.postgresql?.connected) {
            const result = await postgresDb.query(`
                SELECT COUNT(*) as table_count
                FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name IN (
                    'model_registry', 'training_runs', 'evaluation_metrics',
                    'predictions', 'ab_tests', 'data_drift'
                )
            `);
            
            mlChecks.modelRegistry = parseInt(result.rows[0].table_count) > 0;
        }
        
        // Check Redis feature store connectivity
        if (health.services.redis?.connected) {
            const testFeature = await redisDb.getFeatures('health_check', 'test');
            mlChecks.featureStore = true; // Connected
            mlChecks.inferenceCache = true; // Available
        }
        
        // Check BullMQ queue connectivity
        if (health.services.redis?.connected) {
            const bullConnection = redisDb.getBullMQConnection();
            mlChecks.trainingQueue = bullConnection !== null;
        }
    } catch (error) {
        logger.warn('ML pipeline health check partial failure', {
            code: 'ML_HEALTH_PARTIAL',
            error: error.message
        });
    }
    
    return {
        ...health,
        mlPipeline: {
            ready: health.ok && Object.values(mlChecks).some(v => v),
            components: {
                ...health.mlPipeline.components,
                ...mlChecks
            },
            recommendations: generateRecommendations(health, mlChecks)
        }
    };
};

/**
 * Generate health recommendations
 * @param {Object} health - Overall health status
 * @param {Object} mlChecks - ML-specific checks
 * @returns {Array<string>} Recommendations
 */
const generateRecommendations = (health, mlChecks) => {
    const recommendations = [];
    
    if (!health.services.postgresql?.connected) {
        recommendations.push('PostgreSQL is not connected. Check connection settings and ensure the database is running.');
    }
    
    if (!health.services.mongodb?.connected) {
        recommendations.push('MongoDB is not connected. Model artifacts storage will be unavailable.');
    }
    
    if (!health.services.redis?.connected) {
        recommendations.push('Redis is not connected. Feature caching and job queues will be unavailable.');
    }
    
    if (!mlChecks.modelRegistry && health.services.postgresql?.connected) {
        recommendations.push('ML tables not found in PostgreSQL. Run migrations to create required tables.');
    }
    
    if (!mlChecks.trainingQueue && health.services.redis?.connected) {
        recommendations.push('Training queue not configured. Initialize BullMQ queues for training orchestration.');
    }
    
    if (recommendations.length === 0 && health.ok) {
        recommendations.push('All systems operational. ML pipeline is ready.');
    }
    
    return recommendations;
};

/**
 * Start health monitoring with intervals
 * @param {Object} options - Monitoring options
 * @param {number} options.interval - Check interval in ms
 * @param {Function} options.onUnhealthy - Callback for unhealthy state
 * @returns {Object} Monitor handle with stop method
 */
export const startHealthMonitoring = (options = {}) => {
    const {
        interval = 60000, // 1 minute default
        onUnhealthy = null
    } = options;
    
    let intervalId = null;
    let lastHealthy = true;
    
    const performCheck = async () => {
        try {
            const health = await checkMLPipelineHealth();
            
            if (!health.ok && lastHealthy && onUnhealthy) {
                onUnhealthy(health);
            }
            
            lastHealthy = health.ok;
            
            if (!health.ok) {
                logger.warn('Health check detected issues', {
                    code: 'HEALTH_ISSUES',
                    summary: health.summary,
                    recommendations: health.mlPipeline.recommendations
                });
            }
        } catch (error) {
            logger.error('Health monitoring error', {
                code: 'HEALTH_MONITOR_ERROR',
                error: error.message
            });
        }
    };
    
    // Start monitoring
    performCheck(); // Initial check
    intervalId = setInterval(performCheck, interval);
    
    logger.info('Health monitoring started', {
        code: 'HEALTH_MONITOR_START',
        interval
    });
    
    // Return monitor handle
    return {
        stop: () => {
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
                logger.info('Health monitoring stopped', {
                    code: 'HEALTH_MONITOR_STOP'
                });
            }
        },
        checkNow: performCheck
    };
};

export default {
    checkAllHealth,
    checkMLPipelineHealth,
    startHealthMonitoring
};

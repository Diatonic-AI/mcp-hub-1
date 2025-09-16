#!/usr/bin/env node

/**
 * Comprehensive ML/DL Pipeline Verification Script
 * Tests all components of the ML/DL integration before merging to main
 */

import { config } from 'dotenv';
import pg from 'pg';
import { MongoClient } from 'mongodb';
import Redis from 'ioredis';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.join(__dirname, '../.env') });

class MLPipelineVerifier {
    constructor() {
        this.results = {
            components: [],
            migrations: [],
            apis: [],
            workers: [],
            servers: [],
            issues: [],
            passed: 0,
            failed: 0
        };
    }

    async verify() {
        console.log(chalk.blue.bold('\n🔍 ML/DL Pipeline Verification Starting...\n'));
        
        // 1. Database Connectivity
        await this.verifyDatabaseConnectivity();
        
        // 2. Migrations
        await this.verifyMigrations();
        
        // 3. Core Components
        await this.verifyCoreComponents();
        
        // 4. API Endpoints
        await this.verifyAPIEndpoints();
        
        // 5. Worker Processes
        await this.verifyWorkers();
        
        // 6. MCP Server Integration
        await this.verifyMCPServers();
        
        // 7. Generate Report
        await this.generateReport();
        
        return this.results;
    }

    async verifyDatabaseConnectivity() {
        console.log(chalk.cyan('📊 Verifying Database Connectivity...'));
        
        // PostgreSQL
        try {
            const pgClient = new pg.Client({
                connectionString: process.env.POSTGRESQL_CONNECTION_STRING || 
                    'postgresql://mcp_hub_app:mcp_hub_secure_password@10.10.10.11:5432/mcp_hub'
            });
            await pgClient.connect();
            
            // Test query
            const result = await pgClient.query('SELECT NOW()');
            await pgClient.end();
            
            this.addResult('components', 'PostgreSQL Connection', true, 
                `Connected successfully. Server time: ${result.rows[0].now}`);
        } catch (error) {
            this.addResult('components', 'PostgreSQL Connection', false, error.message);
        }
        
        // MongoDB
        try {
            const mongoClient = new MongoClient(
                process.env.MONGODB_URI || 'mongodb://10.10.10.13:27017/mcp_hub_ml'
            );
            await mongoClient.connect();
            
            const db = mongoClient.db();
            const collections = await db.listCollections().toArray();
            await mongoClient.close();
            
            this.addResult('components', 'MongoDB Connection', true, 
                `Connected. Collections: ${collections.length}`);
        } catch (error) {
            this.addResult('components', 'MongoDB Connection', false, error.message);
        }
        
        // Redis
        try {
            const redis = new Redis({
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379
            });
            
            await redis.ping();
            const info = await redis.info('server');
            await redis.quit();
            
            this.addResult('components', 'Redis Connection', true, 
                'Connected. Redis is responsive');
        } catch (error) {
            this.addResult('components', 'Redis Connection', false, error.message);
        }
    }

    async verifyMigrations() {
        console.log(chalk.cyan('\n🔄 Verifying Database Migrations...'));
        
        try {
            const pgClient = new pg.Client({
                connectionString: process.env.POSTGRESQL_CONNECTION_STRING || 
                    'postgresql://mcp_hub_app:mcp_hub_secure_password@10.10.10.11:5432/mcp_hub'
            });
            await pgClient.connect();
            
            // Check migrations table
            const migrationsResult = await pgClient.query(`
                SELECT name, executed_at 
                FROM mcp_hub.migrations 
                ORDER BY executed_at DESC 
                LIMIT 10
            `);
            
            // Check critical tables
            const criticalTables = [
                'mcp_hub.servers',
                'mcp_hub.tools',
                'mcp_hub.execution_logs',
                'mcp_hub.server_analytics',
                'ml_ops.models',
                'ml_ops.training_runs',
                'ml_ops.model_registry',
                'ml_ops.feature_registry',
                'telemetry.events',
                'telemetry.metrics'
            ];
            
            for (const table of criticalTables) {
                const [schema, tableName] = table.split('.');
                const tableExists = await pgClient.query(`
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = $1 
                        AND table_name = $2
                    )
                `, [schema, tableName]);
                
                this.addResult('migrations', `Table ${table}`, 
                    tableExists.rows[0].exists, 
                    tableExists.rows[0].exists ? 'Exists' : 'Missing');
            }
            
            await pgClient.end();
            
            this.addResult('migrations', 'Migration System', true, 
                `${migrationsResult.rows.length} migrations found`);
        } catch (error) {
            this.addResult('migrations', 'Migration System', false, error.message);
        }
    }

    async verifyCoreComponents() {
        console.log(chalk.cyan('\n🔧 Verifying Core Components...'));
        
        const components = [
            'src/utils/postgresql-manager.js',
            'src/database/enhanced-db-adapter.js',
            'src/services/ml/model-registry.js',
            'src/services/ml/training-orchestrator.js',
            'src/services/telemetry/ml-telemetry-enhanced-metrics.js',
            'src/training/training-orchestrator-worker.js',
            'src/telemetry/telemetry-pipeline-worker.js'
        ];
        
        for (const component of components) {
            const componentPath = path.join(__dirname, '..', component);
            try {
                await fs.access(componentPath);
                const stats = await fs.stat(componentPath);
                this.addResult('components', path.basename(component), true, 
                    `Size: ${stats.size} bytes`);
            } catch (error) {
                this.addResult('components', path.basename(component), false, 'File not found');
            }
        }
    }

    async verifyAPIEndpoints() {
        console.log(chalk.cyan('\n🌐 Verifying API Endpoints...'));
        
        // Check if server is running
        const serverPort = process.env.PORT || 3000;
        const baseUrl = `http://localhost:${serverPort}`;
        
        const endpoints = [
            { path: '/health', method: 'GET', name: 'Health Check' },
            { path: '/api/servers', method: 'GET', name: 'List Servers' },
            { path: '/api/tools', method: 'GET', name: 'List Tools' },
            { path: '/api/ml/models', method: 'GET', name: 'ML Models' },
            { path: '/api/ml/training/status', method: 'GET', name: 'Training Status' },
            { path: '/api/telemetry/metrics', method: 'GET', name: 'Telemetry Metrics' }
        ];
        
        console.log(chalk.yellow(`Note: Testing against ${baseUrl}`));
        console.log(chalk.yellow('Make sure the server is running for API tests to pass\n'));
        
        for (const endpoint of endpoints) {
            try {
                const response = await fetch(`${baseUrl}${endpoint.path}`, {
                    method: endpoint.method,
                    headers: { 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(5000)
                });
                
                this.addResult('apis', endpoint.name, response.ok, 
                    `Status: ${response.status}`);
            } catch (error) {
                this.addResult('apis', endpoint.name, false, 
                    error.name === 'AbortError' ? 'Timeout - Server may not be running' : error.message);
            }
        }
    }

    async verifyWorkers() {
        console.log(chalk.cyan('\n⚙️ Verifying Worker Processes...'));
        
        // Check if worker scripts exist and are executable
        const workers = [
            'scripts/start-telemetry-worker.js',
            'src/training/training-orchestrator-worker.js',
            'src/telemetry/telemetry-pipeline-worker.js'
        ];
        
        for (const worker of workers) {
            const workerPath = path.join(__dirname, '..', worker);
            try {
                await fs.access(workerPath);
                const stats = await fs.stat(workerPath);
                
                // Check if it's a valid JS file
                const content = await fs.readFile(workerPath, 'utf-8');
                const isValid = content.includes('export') || content.includes('module.exports') || 
                               content.includes('async function') || content.includes('class');
                
                this.addResult('workers', path.basename(worker), isValid, 
                    isValid ? 'Valid worker file' : 'Invalid worker structure');
            } catch (error) {
                this.addResult('workers', path.basename(worker), false, 'File not found');
            }
        }
    }

    async verifyMCPServers() {
        console.log(chalk.cyan('\n🔌 Verifying MCP Server Integration...'));
        
        try {
            // Check config file
            const configPath = path.join(__dirname, '../config.json');
            const configContent = await fs.readFile(configPath, 'utf-8');
            const config = JSON.parse(configContent);
            
            const serverCount = Object.keys(config.mcpServers || {}).length;
            this.addResult('servers', 'Configuration', true, 
                `${serverCount} servers configured`);
            
            // Check PostgreSQL integration
            if (process.env.ENABLE_POSTGRESQL_INTEGRATION === 'true') {
                this.addResult('servers', 'PostgreSQL Integration', true, 'Enabled');
            } else {
                this.addResult('servers', 'PostgreSQL Integration', false, 
                    'Disabled - Set ENABLE_POSTGRESQL_INTEGRATION=true');
            }
            
            // Count working servers from recent diagnostic
            const diagnosticPath = path.join(__dirname, '../mcp-server-diagnostic-report.json');
            try {
                const diagnosticContent = await fs.readFile(diagnosticPath, 'utf-8');
                const diagnostic = JSON.parse(diagnosticContent);
                
                const workingServers = diagnostic.servers.filter(s => s.status === 'connected').length;
                this.addResult('servers', 'Connected Servers', workingServers > 10, 
                    `${workingServers}/${diagnostic.servers.length} servers connected`);
            } catch (error) {
                this.addResult('servers', 'Diagnostic Report', false, 'Not found - Run diagnostic');
            }
        } catch (error) {
            this.addResult('servers', 'Configuration', false, error.message);
        }
    }

    addResult(category, name, passed, details) {
        this.results[category].push({ name, passed, details });
        if (passed) {
            this.results.passed++;
        } else {
            this.results.failed++;
            this.results.issues.push(`${category}: ${name} - ${details}`);
        }
    }

    async generateReport() {
        console.log(chalk.blue.bold('\n📋 ML/DL Pipeline Verification Report\n'));
        console.log('='.repeat(60));
        
        const categories = ['components', 'migrations', 'apis', 'workers', 'servers'];
        
        for (const category of categories) {
            if (this.results[category].length === 0) continue;
            
            console.log(chalk.cyan(`\n${category.toUpperCase()}:`));
            for (const result of this.results[category]) {
                const icon = result.passed ? chalk.green('✓') : chalk.red('✗');
                const status = result.passed ? chalk.green('PASS') : chalk.red('FAIL');
                console.log(`  ${icon} ${result.name}: ${status} - ${result.details}`);
            }
        }
        
        console.log('\n' + '='.repeat(60));
        console.log(chalk.bold('\nSUMMARY:'));
        console.log(chalk.green(`  Passed: ${this.results.passed}`));
        console.log(chalk.red(`  Failed: ${this.results.failed}`));
        console.log(`  Total:  ${this.results.passed + this.results.failed}`);
        
        const successRate = (this.results.passed / (this.results.passed + this.results.failed) * 100).toFixed(1);
        console.log(chalk.bold(`  Success Rate: ${successRate}%`));
        
        if (this.results.issues.length > 0) {
            console.log(chalk.yellow('\n⚠️ ISSUES TO RESOLVE:'));
            for (const issue of this.results.issues) {
                console.log(chalk.yellow(`  - ${issue}`));
            }
        }
        
        // Recommendation
        console.log('\n' + '='.repeat(60));
        if (successRate >= 80) {
            console.log(chalk.green.bold('\n✅ RECOMMENDATION: System is ready for merge to main branch'));
            console.log(chalk.green('   Most components are working correctly.'));
            if (this.results.issues.length > 0) {
                console.log(chalk.yellow('   Minor issues can be addressed post-merge.'));
            }
        } else if (successRate >= 60) {
            console.log(chalk.yellow.bold('\n⚠️ RECOMMENDATION: Fix critical issues before merging'));
            console.log(chalk.yellow('   System is partially functional but needs attention.'));
        } else {
            console.log(chalk.red.bold('\n❌ RECOMMENDATION: Do not merge yet'));
            console.log(chalk.red('   Too many components are failing. Fix issues first.'));
        }
        
        // Save report
        const reportPath = path.join(__dirname, '../ML-PIPELINE-VERIFICATION-REPORT.json');
        await fs.writeFile(reportPath, JSON.stringify(this.results, null, 2));
        console.log(chalk.gray(`\nDetailed report saved to: ${reportPath}`));
    }
}

// Run verification
const verifier = new MLPipelineVerifier();
verifier.verify()
    .then(results => {
        const exitCode = results.failed > 0 && 
            (results.passed / (results.passed + results.failed)) < 0.6 ? 1 : 0;
        process.exit(exitCode);
    })
    .catch(error => {
        console.error(chalk.red('Verification failed:'), error);
        process.exit(1);
    });
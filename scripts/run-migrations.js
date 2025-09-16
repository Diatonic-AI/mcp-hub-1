#!/usr/bin/env node

/**
 * PostgreSQL Migration Runner
 * Executes SQL migrations in numerical order
 * Usage: node scripts/run-migrations.js [--dry-run] [--from=005] [--to=010]
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../src/data/postgres.js';
import logger from '../src/utils/logger.js';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.split('=');
  acc[key.replace(/^--/, '')] = value || true;
  return acc;
}, {});

const isDryRun = args['dry-run'] === true;
const fromMigration = parseInt(args.from || '001');
const toMigration = parseInt(args.to || '999');

// Migration tracking table
const MIGRATION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS migration_history (
  id SERIAL PRIMARY KEY,
  migration_name VARCHAR(255) NOT NULL UNIQUE,
  executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  execution_time_ms INTEGER,
  checksum VARCHAR(64),
  applied_by VARCHAR(255) DEFAULT CURRENT_USER
);
`;

/**
 * Get list of migration files in order
 */
async function getMigrationFiles() {
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = await fs.readdir(migrationsDir);
  
  // Filter SQL files and sort numerically
  const migrations = files
    .filter(f => f.endsWith('.sql'))
    .filter(f => {
      const num = parseInt(f.split('_')[0]);
      return !isNaN(num) && num >= fromMigration && num <= toMigration;
    })
    .sort((a, b) => {
      const numA = parseInt(a.split('_')[0]);
      const numB = parseInt(b.split('_')[0]);
      return numA - numB;
    });
  
  return migrations.map(f => ({
    filename: f,
    filepath: path.join(migrationsDir, f),
    number: parseInt(f.split('_')[0])
  }));
}

/**
 * Check if migration has been applied
 */
async function isMigrationApplied(migrationName) {
  try {
    const result = await query(
      'SELECT migration_name FROM migration_history WHERE migration_name = $1',
      [migrationName]
    );
    return result.rows.length > 0;
  } catch (error) {
    // Table might not exist yet
    return false;
  }
}

/**
 * Calculate simple checksum for migration content
 */
function calculateChecksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Execute a single migration
 */
async function executeMigration(migration) {
  const startTime = Date.now();
  const content = await fs.readFile(migration.filepath, 'utf8');
  const checksum = calculateChecksum(content);
  
  if (isDryRun) {
    logger.info('DRY RUN', {
      migration: migration.filename,
      checksum,
      lines: content.split('\n').length
    });
    return;
  }
  
  // Begin transaction
  await query('BEGIN');
  
  try {
    // Execute migration SQL
    await query(content);
    
    // Record in history
    await query(
      `INSERT INTO migration_history (migration_name, execution_time_ms, checksum) 
       VALUES ($1, $2, $3)`,
      [migration.filename, Date.now() - startTime, checksum]
    );
    
    // Commit transaction
    await query('COMMIT');
    
    logger.info('Migration applied successfully', {
      migration: migration.filename,
      executionTime: `${Date.now() - startTime}ms`,
      checksum
    });
  } catch (error) {
    // Rollback on error
    await query('ROLLBACK');
    throw error;
  }
}

/**
 * Main migration runner
 */
async function runMigrations() {
  logger.info('Starting migration runner', {
    isDryRun,
    fromMigration,
    toMigration,
    tenant: process.env.DEFAULT_TENANT || 'default'
  });
  
  try {
    // Ensure migration history table exists
    if (!isDryRun) {
      await query(MIGRATION_TABLE_SQL);
    }
    
    // Get migrations to run
    const migrations = await getMigrationFiles();
    logger.info(`Found ${migrations.length} migration files`);
    
    // Check and execute each migration
    let appliedCount = 0;
    let skippedCount = 0;
    
    for (const migration of migrations) {
      const isApplied = await isMigrationApplied(migration.filename);
      
      if (isApplied) {
        logger.info('Migration already applied, skipping', {
          migration: migration.filename
        });
        skippedCount++;
        continue;
      }
      
      logger.info('Executing migration', {
        migration: migration.filename,
        number: migration.number
      });
      
      await executeMigration(migration);
      appliedCount++;
    }
    
    // Summary
    logger.info('Migration runner completed', {
      total: migrations.length,
      applied: appliedCount,
      skipped: skippedCount,
      isDryRun
    });
    
    // Show current migration state
    if (!isDryRun) {
      const history = await query(
        `SELECT migration_name, executed_at, execution_time_ms 
         FROM migration_history 
         ORDER BY migration_name DESC 
         LIMIT 5`
      );
      
      logger.info('Recent migrations', {
        migrations: history.rows
      });
    }
    
    process.exit(0);
  } catch (error) {
    logger.error('Migration runner failed', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Run migrations
runMigrations();

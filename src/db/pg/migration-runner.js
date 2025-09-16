/**
 * PostgreSQL Migration Runner
 * Manages ML schema migrations with idempotent execution
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../../utils/logger.js';
import { ServerError } from '../../utils/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class MigrationRunner {
  constructor(client) {
    this.client = client;
    this.migrationsPath = path.join(__dirname, 'migrations', 'ml');
  }

  /**
   * Run all pending migrations
   */
  async run() {
    try {
      // Ensure schema version table exists
      await this.ensureSchemaVersionTable();
      
      // Get migration files
      const migrations = await this.getMigrationFiles();
      
      // Apply each migration
      for (const migrationFile of migrations) {
        await this.applyMigration(migrationFile);
      }
      
      logger.info('All ML migrations completed successfully');
    } catch (error) {
      logger.error('MIGRATION_ERROR', 'Failed to run migrations', { 
        error: error.message 
      }, false);
      throw new ServerError(`Migration failed: ${error.message}`);
    }
  }

  /**
   * Ensure schema version table exists
   */
  async ensureSchemaVersionTable() {
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS ml_schema_version (
        id serial PRIMARY KEY,
        version_key text UNIQUE NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now(),
        description text
      );
    `);
  }

  /**
   * Get list of migration files in order
   */
  async getMigrationFiles() {
    try {
      const files = await fs.readdir(this.migrationsPath);
      return files
        .filter(f => f.endsWith('.js'))
        .sort(); // Alphabetical order ensures correct sequence
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.warn('No migrations directory found', { 
          path: this.migrationsPath 
        });
        return [];
      }
      throw error;
    }
  }

  /**
   * Apply a single migration
   */
  async applyMigration(filename) {
    const filepath = path.join(this.migrationsPath, filename);
    
    try {
      // Import migration module
      const migrationModule = await import(filepath);
      const migration = migrationModule.default;
      
      if (!migration.id || !migration.up) {
        throw new Error(`Invalid migration format in ${filename}`);
      }
      
      // Check if already applied
      const result = await this.client.query(
        'SELECT 1 FROM ml_schema_version WHERE version_key = $1',
        [migration.id]
      );
      
      if (result.rows.length > 0) {
        logger.debug(`Migration ${migration.id} already applied, skipping`);
        return;
      }
      
      // Apply migration
      logger.info(`Applying migration: ${migration.id}`);
      await migration.up(this.client, logger);
      
      // Record as applied (handled in migration itself for atomicity)
      logger.info(`Migration ${migration.id} applied successfully`);
      
    } catch (error) {
      logger.error('MIGRATION_APPLY_ERROR', `Failed to apply migration ${filename}`, {
        error: error.message,
        migration: filename
      }, false);
      throw error;
    }
  }

  /**
   * Rollback a specific migration (if down method exists)
   */
  async rollback(migrationId) {
    const files = await this.getMigrationFiles();
    
    for (const filename of files) {
      const filepath = path.join(this.migrationsPath, filename);
      const migrationModule = await import(filepath);
      const migration = migrationModule.default;
      
      if (migration.id === migrationId) {
        if (!migration.down) {
          throw new Error(`Migration ${migrationId} does not support rollback`);
        }
        
        logger.info(`Rolling back migration: ${migrationId}`);
        await migration.down(this.client, logger);
        
        // Remove from schema version table
        await this.client.query(
          'DELETE FROM ml_schema_version WHERE version_key = $1',
          [migrationId]
        );
        
        logger.info(`Migration ${migrationId} rolled back successfully`);
        return;
      }
    }
    
    throw new Error(`Migration ${migrationId} not found`);
  }

  /**
   * Get list of applied migrations
   */
  async getAppliedMigrations() {
    await this.ensureSchemaVersionTable();
    
    const result = await this.client.query(
      'SELECT version_key, applied_at, description FROM ml_schema_version ORDER BY applied_at'
    );
    
    return result.rows;
  }

  /**
   * Check if a specific migration has been applied
   */
  async isApplied(migrationId) {
    await this.ensureSchemaVersionTable();
    
    const result = await this.client.query(
      'SELECT 1 FROM ml_schema_version WHERE version_key = $1',
      [migrationId]
    );
    
    return result.rows.length > 0;
  }
}

/**
 * Helper function to run migrations with a client
 */
export async function runMigrations(client) {
  const runner = new MigrationRunner(client);
  await runner.run();
  return runner;
}

export default MigrationRunner;

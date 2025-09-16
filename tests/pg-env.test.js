/**
 * Unit tests for PostgreSQL environment variable resolver
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseBooleanEnv,
  resolvePostgresIntegrationEnv,
  logPostgresIntegrationResolution,
  getResolutionDescription
} from '../src/utils/pg-env.js';
import logger from '../src/utils/logger.js';

// Mock logger to prevent actual logging during tests
vi.mock('../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('parseBooleanEnv', () => {
  it('should parse truthy values correctly', () => {
    const truthyValues = ['1', 'true', 'TRUE', 'yes', 'YES', 'on', 'ON', 'enable', 'ENABLED'];
    
    for (const value of truthyValues) {
      expect(parseBooleanEnv(value)).toBe(true);
    }
  });
  
  it('should parse falsy values correctly', () => {
    const falsyValues = ['0', 'false', 'FALSE', 'no', 'NO', 'off', 'OFF', 'disable', 'DISABLED'];
    
    for (const value of falsyValues) {
      expect(parseBooleanEnv(value)).toBe(false);
    }
  });
  
  it('should handle null and undefined', () => {
    expect(parseBooleanEnv(null)).toBeUndefined();
    expect(parseBooleanEnv(undefined)).toBeUndefined();
  });
  
  it('should handle invalid values', () => {
    expect(parseBooleanEnv('maybe')).toBeUndefined();
    expect(parseBooleanEnv('invalid')).toBeUndefined();
    expect(parseBooleanEnv('2')).toBeUndefined();
  });
  
  it('should handle whitespace', () => {
    expect(parseBooleanEnv('  true  ')).toBe(true);
    expect(parseBooleanEnv('  false  ')).toBe(false);
  });
});

describe('resolvePostgresIntegrationEnv', () => {
  let originalEnv;
  
  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear all PostgreSQL-related environment variables
    delete process.env.ENABLE_POSTGRESQL_INTEGRATION;
    delete process.env.ENABLE_POSTGRES_INTEGRATION;
    delete process.env.ENABLE_POSTGRES;
    delete process.env.PG_INTEGRATION_ENABLED;
    delete process.env.DISABLE_POSTGRESQL_INTEGRATION;
    delete process.env.DISABLE_POSTGRES_INTEGRATION;
    delete process.env.POSTGRES_PASSWORD;
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });
  
  describe('DISABLE flags take precedence', () => {
    it('should disable when DISABLE_POSTGRESQL_INTEGRATION is true (regardless of password)', () => {
      const env = {
        DISABLE_POSTGRESQL_INTEGRATION: 'true',
        POSTGRES_PASSWORD: 'secret'
      };
      
      const result = resolvePostgresIntegrationEnv(env);
      
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled_by_flag');
      expect(result.flagsUsed.hasPassword).toBe(true);
    });
    
    it('should disable when DISABLE_POSTGRES_INTEGRATION is true', () => {
      const env = {
        DISABLE_POSTGRES_INTEGRATION: 'yes',
        ENABLE_POSTGRESQL_INTEGRATION: 'true',
        POSTGRES_PASSWORD: 'secret'
      };
      
      const result = resolvePostgresIntegrationEnv(env);
      
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled_by_flag');
    });
  });
  
  describe('ENABLE flags with password requirements', () => {
    it('should enable when ENABLE_POSTGRESQL_INTEGRATION=true and password is present', () => {
      const env = {
        ENABLE_POSTGRESQL_INTEGRATION: 'true',
        POSTGRES_PASSWORD: 'secret'
      };
      
      const result = resolvePostgresIntegrationEnv(env);
      
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('enabled_by_flag');
      expect(result.flagsUsed.hasPassword).toBe(true);
    });
    
    it('should auto-disable when ENABLE_POSTGRESQL_INTEGRATION=true but password is missing', () => {
      const env = {
        ENABLE_POSTGRESQL_INTEGRATION: 'true'
        // No POSTGRES_PASSWORD
      };
      
      const result = resolvePostgresIntegrationEnv(env);
      
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('password_missing_auto_disabled');
      expect(result.flagsUsed.hasPassword).toBe(false);
    });
    
    it('should auto-disable when ENABLE_POSTGRESQL_INTEGRATION=true but password is empty', () => {
      const env = {
        ENABLE_POSTGRESQL_INTEGRATION: 'true',
        POSTGRES_PASSWORD: ''
      };
      
      const result = resolvePostgresIntegrationEnv(env);
      
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('password_missing_auto_disabled');
      expect(result.flagsUsed.hasPassword).toBe(false);
    });
    
    it('should disable when ENABLE_POSTGRESQL_INTEGRATION=false', () => {
      const env = {
        ENABLE_POSTGRESQL_INTEGRATION: 'false',
        POSTGRES_PASSWORD: 'secret'
      };
      
      const result = resolvePostgresIntegrationEnv(env);
      
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled_by_flag');
    });
  });
  
  describe('Legacy alias support', () => {
    it('should work with ENABLE_POSTGRES_INTEGRATION alias', () => {
      const env = {
        ENABLE_POSTGRES_INTEGRATION: 'true',
        POSTGRES_PASSWORD: 'secret'
      };
      
      const result = resolvePostgresIntegrationEnv(env);
      
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('enabled_by_flag');
    });
    
    it('should work with ENABLE_POSTGRES alias', () => {
      const env = {
        ENABLE_POSTGRES: 'true',
        POSTGRES_PASSWORD: 'secret'
      };
      
      const result = resolvePostgresIntegrationEnv(env);
      
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('enabled_by_flag');
    });
    
    it('should work with PG_INTEGRATION_ENABLED alias', () => {
      const env = {
        PG_INTEGRATION_ENABLED: 'yes',
        POSTGRES_PASSWORD: 'secret'
      };
      
      const result = resolvePostgresIntegrationEnv(env);
      
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('enabled_by_flag');
    });
  });
  
  describe('Precedence rules', () => {
    it('should prioritize canonical ENABLE_POSTGRESQL_INTEGRATION over aliases', () => {
      const env = {
        ENABLE_POSTGRESQL_INTEGRATION: 'false',
        ENABLE_POSTGRES: 'true',
        POSTGRES_PASSWORD: 'secret'
      };
      
      const result = resolvePostgresIntegrationEnv(env);
      
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled_by_flag');
    });
    
    it('should use first available alias when canonical is not set', () => {
      const env = {
        ENABLE_POSTGRES_INTEGRATION: 'false',
        ENABLE_POSTGRES: 'true',
        POSTGRES_PASSWORD: 'secret'
      };
      
      const result = resolvePostgresIntegrationEnv(env);
      
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled_by_flag');
    });
  });
  
  describe('No flags - safe defaults', () => {
    it('should disable when no flags and no password', () => {
      const env = {};
      
      const result = resolvePostgresIntegrationEnv(env);
      
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('no_flags_password_missing');
      expect(result.flagsUsed.hasPassword).toBe(false);
    });
    
    it('should enable when no flags but password is present', () => {
      const env = {
        POSTGRES_PASSWORD: 'secret'
      };
      
      const result = resolvePostgresIntegrationEnv(env);
      
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('no_flags_password_present');
      expect(result.flagsUsed.hasPassword).toBe(true);
    });
  });
  
  describe('Complex scenarios', () => {
    it('should disable wins over enable when both are truthy', () => {
      const env = {
        DISABLE_POSTGRESQL_INTEGRATION: 'true',
        ENABLE_POSTGRESQL_INTEGRATION: 'true',
        POSTGRES_PASSWORD: 'secret'
      };
      
      const result = resolvePostgresIntegrationEnv(env);
      
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled_by_flag');
    });
    
    it('should handle mixed flag types correctly', () => {
      const env = {
        DISABLE_POSTGRES_INTEGRATION: '0',    // false -> ignored
        ENABLE_POSTGRESQL_INTEGRATION: '1',   // true -> enabled
        POSTGRES_PASSWORD: 'secret'
      };
      
      const result = resolvePostgresIntegrationEnv(env);
      
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('enabled_by_flag');
    });
  });
});

describe('getResolutionDescription', () => {
  it('should provide human-readable descriptions', () => {
    const testCases = [
      { 
        input: { enabled: false, reason: 'disabled_by_flag' },
        expected: 'Disabled by environment flag'
      },
      {
        input: { enabled: true, reason: 'enabled_by_flag' },
        expected: 'Enabled by environment flag with password present'
      },
      {
        input: { enabled: false, reason: 'password_missing_auto_disabled' },
        expected: 'Auto-disabled due to missing PostgreSQL password (prevents restart loops)'
      },
      {
        input: { enabled: false, reason: 'no_flags_password_missing' },
        expected: 'Auto-disabled due to missing password (no explicit flags)'
      },
      {
        input: { enabled: true, reason: 'no_flags_password_present' },
        expected: 'Auto-enabled due to password presence (no explicit flags)'
      }
    ];
    
    for (const { input, expected } of testCases) {
      expect(getResolutionDescription(input)).toBe(expected);
    }
  });
});

describe('logPostgresIntegrationResolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  it('should log enabled integration properly', () => {
    const resolution = {
      enabled: true,
      reason: 'enabled_by_flag',
      flagsUsed: { disableFlag: 'unset', enableFlag: 'set', hasPassword: true }
    };
    
    logPostgresIntegrationResolution(resolution);
    
    expect(logger.info).toHaveBeenCalledWith(
      'PostgreSQL integration enabled',
      expect.objectContaining({
        enabled: true,
        reason: 'enabled_by_flag'
      })
    );
  });
  
  it('should log disabled integration with guidance', () => {
    const resolution = {
      enabled: false,
      reason: 'password_missing_auto_disabled',
      flagsUsed: { disableFlag: 'unset', enableFlag: 'set', hasPassword: false }
    };
    
    logPostgresIntegrationResolution(resolution);
    
    expect(logger.info).toHaveBeenCalledWith(
      'PostgreSQL integration disabled',
      expect.objectContaining({
        enabled: false,
        reason: 'password_missing_auto_disabled'
      })
    );
    
    expect(logger.info).toHaveBeenCalledWith(
      'To enable PostgreSQL integration, set POSTGRES_PASSWORD environment variable'
    );
  });
  
  it('should provide helpful guidance for no flags scenario', () => {
    const resolution = {
      enabled: false,
      reason: 'no_flags_password_missing',
      flagsUsed: { disableFlag: 'unset', enableFlag: 'unset', hasPassword: false }
    };
    
    logPostgresIntegrationResolution(resolution);
    
    expect(logger.info).toHaveBeenCalledWith(
      'PostgreSQL integration auto-disabled due to missing password. Set ENABLE_POSTGRESQL_INTEGRATION=true and POSTGRES_PASSWORD to enable'
    );
  });
});

import { expect } from 'chai';
import sinon from 'sinon';
import { TenantContextManager } from '../../src/utils/tenant-context.js';

describe('TenantContextManager', function() {
  let tenantManager;
  let mockPgClient;
  let mockMongoCollection;

  beforeEach(function() {
    // Create new instance for each test
    tenantManager = new TenantContextManager();
    
    // Mock PostgreSQL client
    mockPgClient = {
      query: sinon.stub().resolves({ rows: [] })
    };
    
    // Mock MongoDB collection
    mockMongoCollection = {
      find: sinon.stub().returns({
        toArray: sinon.stub().resolves([])
      }),
      findOne: sinon.stub().resolves(null),
      insertOne: sinon.stub().resolves({ insertedId: 'test-id' }),
      updateOne: sinon.stub().resolves({ modifiedCount: 1 }),
      deleteOne: sinon.stub().resolves({ deletedCount: 1 }),
      aggregate: sinon.stub().returns({
        toArray: sinon.stub().resolves([])
      })
    };
  });

  afterEach(function() {
    // Clean up
    if (tenantManager && tenantManager.currentTenant) {
      tenantManager.currentTenant = null;
      tenantManager.tenantStack = [];
    }
    sinon.restore();
  });

  describe('Instance Creation', function() {
    it('should create new instances', function() {
      const instance1 = new TenantContextManager();
      const instance2 = new TenantContextManager();
      
      expect(instance1).to.not.equal(instance2);
      expect(instance1).to.be.instanceOf(TenantContextManager);
      expect(instance2).to.be.instanceOf(TenantContextManager);
    });
  });

  describe('resolveTenant', function() {
    it('should resolve tenant from explicit parameter', function() {
      const tenant = tenantManager.resolveTenant({
        explicit: 'explicit_tenant'
      });
      
      expect(tenant).to.equal('explicit_tenant');
    });

    it('should resolve tenant from request headers', function() {
      const tenant = tenantManager.resolveTenant({
        headers: {
          'x-tenant-id': 'header_tenant'
        }
      });
      
      expect(tenant).to.equal('header_tenant');
    });

    it('should resolve tenant from alternative header', function() {
      const tenant = tenantManager.resolveTenant({
        headers: {
          'tenant': 'alt_header_tenant'
        }
      });
      
      expect(tenant).to.equal('alt_header_tenant');
    });

    it('should resolve tenant from config', function() {
      const tenant = tenantManager.resolveTenant({
        config: {
          tenant: 'config_tenant'
        }
      });
      
      expect(tenant).to.equal('config_tenant');
    });

    it('should resolve tenant from environment variable', function() {
      process.env.TENANT_ID = 'env_tenant';
      
      const tenant = tenantManager.resolveTenant({});
      
      expect(tenant).to.equal('env_tenant');
      
      delete process.env.TENANT_ID;
    });

    it('should resolve tenant from current context', function() {
      tenantManager.setTenant('context_tenant');
      
      const tenant = tenantManager.resolveTenant({});
      
      expect(tenant).to.equal('context_tenant');
    });

    it('should return default tenant when no source available', function() {
      const tenant = tenantManager.resolveTenant({});
      
      expect(tenant).to.equal('default');
    });

    it('should follow priority order', function() {
      process.env.TENANT_ID = 'env_tenant';
      tenantManager.setTenant('context_tenant');
      
      // Explicit takes precedence
      let tenant = tenantManager.resolveTenant({
        explicit: 'explicit_tenant',
        headers: { 'x-tenant-id': 'header_tenant' },
        config: { tenant: 'config_tenant' }
      });
      expect(tenant).to.equal('explicit_tenant');
      
      // Headers take precedence over config
      tenant = tenantManager.resolveTenant({
        headers: { 'x-tenant-id': 'header_tenant' },
        config: { tenant: 'config_tenant' }
      });
      expect(tenant).to.equal('header_tenant');
      
      // Config takes precedence over env
      tenant = tenantManager.resolveTenant({
        config: { tenant: 'config_tenant' }
      });
      expect(tenant).to.equal('config_tenant');
      
      delete process.env.TENANT_ID;
    });
  });

  describe('isValidTenant', function() {
    it('should validate correct tenant formats', function() {
      const validTenants = [
        'tenant',
        'tenant_123',
        'tenant-456',
        'tenant-with_mix',
        'a',
        '123',
        'UPPERCASE',
        'camelCase'
      ];
      
      validTenants.forEach(tenant => {
        expect(tenantManager.isValidTenant(tenant)).to.be.true;
      });
    });

    it('should reject invalid tenant formats', function() {
      const invalidTenants = [
        '',
        ' ',
        'tenant with space',
        'tenant@special',
        'tenant#hash',
        'tenant$dollar',
        'tenant.dot',
        null,
        undefined,
        123, // number
        true // boolean
      ];
      
      invalidTenants.forEach(tenant => {
        expect(tenantManager.isValidTenant(tenant)).to.be.false;
      });
    });
  });

  describe('Context Management', function() {
    it('should set and get context', function() {
      tenantManager.setTenant('test_tenant');
      
      expect(tenantManager.getTenant()).to.equal('test_tenant');
      expect(tenantManager.currentTenant).to.equal('test_tenant');
    });

    it('should clear context', function() {
      tenantManager.setTenant('test_tenant');
      tenantManager.currentTenant = null;
      
      expect(tenantManager.getTenant()).to.be.null;
      expect(tenantManager.currentTenant).to.be.null;
    });

    it('should validate tenant on setTenant', function() {
      expect(() => tenantManager.setTenant('invalid tenant')).to.throw('Invalid tenant');
      expect(() => tenantManager.setTenant('valid_tenant')).to.not.throw();
    });
  });

  describe('Context Stack', function() {
    it('should push and pop context', function() {
      tenantManager.setTenant('tenant1');
      
      tenantManager.pushTenant('tenant2');
      expect(tenantManager.getTenant()).to.equal('tenant2');
      
      tenantManager.pushTenant('tenant3');
      expect(tenantManager.getTenant()).to.equal('tenant3');
      
      const popped1 = tenantManager.popTenant();
      expect(popped1).to.equal('tenant3');
      expect(tenantManager.getTenant()).to.equal('tenant2');
      
      const popped2 = tenantManager.popTenant();
      expect(popped2).to.equal('tenant2');
      expect(tenantManager.getTenant()).to.equal('tenant1');
    });

    it('should throw when popping empty stack', function() {
      expect(() => tenantManager.popTenant()).to.throw('Tenant stack underflow');
    });

    it('should validate tenant on push', function() {
      expect(() => tenantManager.pushTenant('invalid tenant')).to.throw('Invalid tenant');
      expect(() => tenantManager.pushTenant('valid_tenant')).to.not.throw();
    });
  });

  describe('withTenant', function() {
    it('should execute function with temporary tenant context', async function() {
      tenantManager.setTenant('original_tenant');
      
      let capturedTenant;
      const result = await tenantManager.withTenant(async () => {
        capturedTenant = tenantManager.getTenant();
        return 'test_result';
      }, 'temp_tenant');
      
      expect(capturedTenant).to.equal('temp_tenant');
      expect(result).to.equal('test_result');
      expect(tenantManager.getTenant()).to.equal('original_tenant');
    });

    it('should restore context even on error', async function() {
      tenantManager.setTenant('original_tenant');
      
      try {
        await tenantManager.withTenant(async () => {
          throw new Error('Test error');
        }, 'temp_tenant');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error.message).to.equal('Test error');
      }
      
      expect(tenantManager.getTenant()).to.equal('original_tenant');
    });

    it('should handle synchronous functions', async function() {
      const result = await tenantManager.withTenant(() => {
        return 'sync_result';
      }, 'temp_tenant');
      
      expect(result).to.equal('sync_result');
    });
  });

  // PostgreSQL and MongoDB integration tests would go here
  // These features are implemented in separate helper classes:
  // - PostgresTenantHelper for PostgreSQL RLS
  // - MongoTenantHelper for MongoDB filtering


  describe('Integration Scenarios', function() {
    it('should handle nested tenant contexts', async function() {
      tenantManager.setTenant('tenant1');
      
      await tenantManager.withTenant(async () => {
        expect(tenantManager.getTenant()).to.equal('tenant2');
        
        await tenantManager.withTenant(async () => {
          expect(tenantManager.getTenant()).to.equal('tenant3');
        }, 'tenant3');
        
        expect(tenantManager.getTenant()).to.equal('tenant2');
      }, 'tenant2');
      
      expect(tenantManager.getTenant()).to.equal('tenant1');
    });

    it('should maintain tenant isolation in concurrent operations', async function() {
      const results = await Promise.all([
        tenantManager.withTenant(async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return tenantManager.getTenant();
        }, 'tenant1'),
        tenantManager.withTenant(async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          return tenantManager.getTenant();
        }, 'tenant2'),
        tenantManager.withTenant(async () => {
          return tenantManager.getTenant();
        }, 'tenant3')
      ]);
      
      expect(results).to.deep.equal(['tenant1', 'tenant2', 'tenant3']);
    });

    it('should resolve tenant through full chain', function() {
      // Set up multiple sources
      process.env.TENANT_ID = 'env_tenant';
      process.env.DEFAULT_TENANT = 'env_default';
      tenantManager.setTenant('context_tenant');
      
      // Test resolution with all sources
      const sources = {
        explicit: 'explicit',
        headers: { 'x-tenant-id': 'header' },
        config: { tenant: 'config' }
      };
      
      const resolved = tenantManager.resolveTenant(sources);
      expect(resolved).to.equal('explicit');
      
      // Clean up
      delete process.env.TENANT_ID;
      delete process.env.DEFAULT_TENANT;
    });
  });

  describe('Error Handling', function() {
    it('should handle null/undefined gracefully', function() {
      expect(tenantManager.resolveTenant(null)).to.equal('default');
      expect(tenantManager.resolveTenant(undefined)).to.equal('default');
      expect(tenantManager.resolveTenant({})).to.equal('default');
    });

    it('should throw meaningful errors for invalid operations', function() {
      expect(() => tenantManager.setTenant('')).to.throw('Invalid tenant');
      expect(() => tenantManager.pushTenant(null)).to.throw('Invalid tenant');
    });

  });
});

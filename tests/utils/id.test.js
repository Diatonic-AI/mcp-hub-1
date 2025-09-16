import { expect } from 'chai';
import sinon from 'sinon';
import {
  generateULID,
  generateUUID,
  generateGID,
  parseGID,
  validateUUID,
  validateGID,
  createUniversalEnvelope
} from '../../src/utils/id.js';

describe('ID Generation Utilities', function() {
  let clock;

  beforeEach(function() {
    // Fix time for consistent testing
    clock = sinon.useFakeTimers(new Date('2025-01-09T12:00:00Z'));
  });

  afterEach(function() {
    clock.restore();
  });

  describe('generateULID', function() {
    it('should generate valid ULID strings', function() {
      const ulid1 = generateULID();
      const ulid2 = generateULID();
      
      expect(ulid1).to.be.a('string');
      expect(ulid1).to.have.length(26);
      expect(ulid1).to.match(/^[0-9A-Z]{26}$/);
      expect(ulid1).to.not.equal(ulid2); // Should be unique
    });

    it('should generate chronologically sortable ULIDs', function() {
      const ulid1 = generateULID();
      clock.tick(1000); // Advance 1 second
      const ulid2 = generateULID();
      
      expect(ulid1 < ulid2).to.be.true; // Lexicographically sortable
    });
  });

  describe('generateUUID', function() {
    it('should generate valid UUID v4 strings', function() {
      const uuid = generateUUID();
      
      expect(uuid).to.be.a('string');
      expect(uuid).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should generate unique UUIDs', function() {
      const uuids = new Set();
      for (let i = 0; i < 100; i++) {
        uuids.add(generateUUID());
      }
      expect(uuids.size).to.equal(100);
    });
  });

  describe('generateGID', function() {
    it('should generate valid GID with required parameters', function() {
      const gid = generateGID('USER', 'test_tenant', 'abc123');
      
      expect(gid).to.equal('USER:2025-01-09:test_tenant:abc123');
    });

    it('should handle missing tenant gracefully', function() {
      const gid = generateGID('TOOL', null, 'xyz789');
      
      expect(gid).to.equal('TOOL:2025-01-09:unknown:xyz789');
    });

    it('should generate automatic suffix when not provided', function() {
      const gid1 = generateGID('SESSION', 'tenant1');
      const gid2 = generateGID('SESSION', 'tenant1');
      
      expect(gid1).to.match(/^SESSION:2025-01-09:tenant1:[0-9A-Z]{26}$/);
      expect(gid2).to.match(/^SESSION:2025-01-09:tenant1:[0-9A-Z]{26}$/);
      expect(gid1).to.not.equal(gid2);
    });

    it('should validate prefix format', function() {
      expect(() => generateGID('', 'tenant', 'suffix')).to.throw('Prefix is required');
      expect(() => generateGID('invalid-prefix', 'tenant', 'suffix')).to.throw('Invalid prefix format');
      expect(() => generateGID('VALID_PREFIX', 'tenant', 'suffix')).to.not.throw();
    });

    it('should validate tenant format', function() {
      expect(() => generateGID('PREFIX', 'invalid tenant', 'suffix')).to.throw('Invalid tenant format');
      expect(() => generateGID('PREFIX', 'valid-tenant_123', 'suffix')).to.not.throw();
    });
  });

  describe('parseGID', function() {
    it('should parse valid GID correctly', function() {
      const gid = 'USER:2025-01-09:test_tenant:abc123';
      const parsed = parseGID(gid);
      
      expect(parsed).to.deep.equal({
        prefix: 'USER',
        date: '2025-01-09',
        tenant: 'test_tenant',
        suffix: 'abc123',
        original: gid
      });
    });

    it('should return null for invalid GID format', function() {
      expect(parseGID('invalid')).to.be.null;
      expect(parseGID('MISSING:PARTS')).to.be.null;
      expect(parseGID('TOO:MANY:PARTS:HERE:EXTRA')).to.be.null;
      expect(parseGID('')).to.be.null;
      expect(parseGID(null)).to.be.null;
    });

    it('should handle GIDs with complex suffixes', function() {
      const gid = 'CHAIN:2025-01-09:tenant_1:step1-step2-step3';
      const parsed = parseGID(gid);
      
      expect(parsed).to.deep.equal({
        prefix: 'CHAIN',
        date: '2025-01-09',
        tenant: 'tenant_1',
        suffix: 'step1-step2-step3',
        original: gid
      });
    });
  });

  describe('validateUUID', function() {
    it('should validate correct UUID formats', function() {
      expect(validateUUID('550e8400-e29b-41d4-a716-446655440000')).to.be.true;
      expect(validateUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).to.be.true;
      expect(validateUUID('6BA7B810-9DAD-11D1-80B4-00C04FD430C8')).to.be.true; // Case insensitive
    });

    it('should reject invalid UUID formats', function() {
      expect(validateUUID('not-a-uuid')).to.be.false;
      expect(validateUUID('550e8400-e29b-41d4-a716-44665544000')).to.be.false; // Too short
      expect(validateUUID('550e8400-e29b-41d4-a716-4466554400000')).to.be.false; // Too long
      expect(validateUUID('550e8400-e29b-91d4-a716-446655440000')).to.be.false; // Invalid version
      expect(validateUUID('')).to.be.false;
      expect(validateUUID(null)).to.be.false;
      expect(validateUUID(undefined)).to.be.false;
    });
  });

  describe('validateGID', function() {
    it('should validate correct GID formats', function() {
      expect(validateGID('USER:2025-01-09:tenant:abc123')).to.be.true;
      expect(validateGID('TOOL_CHAIN:2025-12-31:tenant-1:xyz_789')).to.be.true;
      expect(validateGID('ML_MODEL:2025-01-01:t1:v1.0.0')).to.be.true;
    });

    it('should reject invalid GID formats', function() {
      expect(validateGID('INVALID')).to.be.false;
      expect(validateGID('PREFIX:BADDATE:tenant:suffix')).to.be.false;
      expect(validateGID('PREFIX:2025-13-01:tenant:suffix')).to.be.false; // Invalid month
      expect(validateGID('PREFIX:2025-01-32:tenant:suffix')).to.be.false; // Invalid day
      expect(validateGID('pre fix:2025-01-09:tenant:suffix')).to.be.false; // Space in prefix
      expect(validateGID('PREFIX:2025-01-09:ten ant:suffix')).to.be.false; // Space in tenant
      expect(validateGID('')).to.be.false;
      expect(validateGID(null)).to.be.false;
    });

    it('should validate date format strictly', function() {
      expect(validateGID('PREFIX:25-01-09:tenant:suffix')).to.be.false; // Short year
      expect(validateGID('PREFIX:2025-1-9:tenant:suffix')).to.be.false; // No leading zeros
      expect(validateGID('PREFIX:2025/01/09:tenant:suffix')).to.be.false; // Wrong separator
    });
  });

  describe('createUniversalEnvelope', function() {
    it('should create complete envelope with all fields', function() {
      const data = {
        type: 'tool_execution',
        tenant: 'test_tenant',
        content: { message: 'test' },
        metadata: { source: 'test' }
      };
      
      const envelope = createUniversalEnvelope(data);
      
      expect(envelope).to.have.property('id').that.matches(/^[0-9A-Z]{26}$/);
      expect(envelope).to.have.property('gid').that.matches(/^TOOL_EXECUTION:2025-01-09:test_tenant:[0-9A-Z]{26}$/);
      expect(envelope.type).to.equal('tool_execution');
      expect(envelope.tenant).to.equal('test_tenant');
      expect(envelope.created_at).to.equal('2025-01-09T12:00:00.000Z');
      expect(envelope.version).to.equal('1.0.0');
      expect(envelope.content).to.deep.equal({ message: 'test' });
      expect(envelope.metadata).to.deep.equal({ source: 'test' });
    });

    it('should use default values for missing fields', function() {
      const envelope = createUniversalEnvelope({});
      
      expect(envelope.type).to.equal('unknown');
      expect(envelope.tenant).to.equal('default');
      expect(envelope.version).to.equal('1.0.0');
      expect(envelope.content).to.be.null;
      expect(envelope.metadata).to.deep.equal({});
    });

    it('should include parent references when provided', function() {
      const envelope = createUniversalEnvelope({
        type: 'chain_step',
        tenant: 'tenant1',
        parents: ['parent1', 'parent2'],
        correlation_id: 'corr123'
      });
      
      expect(envelope.lineage).to.deep.equal({
        parents: ['parent1', 'parent2'],
        correlation_id: 'corr123'
      });
    });

    it('should convert type to uppercase for GID prefix', function() {
      const envelope = createUniversalEnvelope({
        type: 'ml_training_run',
        tenant: 'ml_tenant'
      });
      
      expect(envelope.gid).to.match(/^ML_TRAINING_RUN:2025-01-09:ml_tenant:/);
    });

    it('should handle special characters in type conversion', function() {
      const envelope = createUniversalEnvelope({
        type: 'tool.execution-result',
        tenant: 'tenant1'
      });
      
      expect(envelope.gid).to.match(/^TOOL_EXECUTION_RESULT:2025-01-09:tenant1:/);
    });

    it('should preserve original type in envelope', function() {
      const envelope = createUniversalEnvelope({
        type: 'CamelCaseType',
        tenant: 'tenant1'
      });
      
      expect(envelope.type).to.equal('CamelCaseType');
      expect(envelope.gid).to.match(/^CAMELCASETYPE:2025-01-09:tenant1:/);
    });
  });

  describe('Edge Cases and Error Handling', function() {
    it('should handle very long prefixes and tenants', function() {
      const longPrefix = 'A'.repeat(50);
      const longTenant = 'b'.repeat(50);
      
      // Should truncate or handle gracefully
      const gid = generateGID(longPrefix, longTenant, 'suffix');
      expect(gid).to.include(longPrefix);
      expect(gid).to.include(longTenant);
    });

    it('should handle special valid characters in tenant', function() {
      const specialTenants = ['tenant-123', 'tenant_456', 'tenant-with_mix'];
      
      specialTenants.forEach(tenant => {
        const gid = generateGID('PREFIX', tenant, 'suffix');
        expect(gid).to.include(tenant);
        expect(validateGID(gid)).to.be.true;
      });
    });

    it('should handle concurrent ID generation', function() {
      const ids = [];
      const promises = [];
      
      // Generate multiple IDs concurrently
      for (let i = 0; i < 100; i++) {
        promises.push(
          Promise.resolve(generateULID())
        );
      }
      
      return Promise.all(promises).then(results => {
        ids.push(...results);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).to.equal(100); // All should be unique
      });
    });
  });

  describe('Integration Scenarios', function() {
    it('should round-trip GID generation and parsing', function() {
      const original = {
        prefix: 'WORKFLOW',
        tenant: 'test_tenant_123',
        suffix: 'step-1-2-3'
      };
      
      const gid = generateGID(original.prefix, original.tenant, original.suffix);
      const parsed = parseGID(gid);
      
      expect(parsed.prefix).to.equal(original.prefix);
      expect(parsed.tenant).to.equal(original.tenant);
      expect(parsed.suffix).to.equal(original.suffix);
      expect(parsed.date).to.equal('2025-01-09');
    });

    it('should create consistent envelopes for same input', function() {
      const data = {
        type: 'test_type',
        tenant: 'test_tenant',
        content: { key: 'value' }
      };
      
      const envelope1 = createUniversalEnvelope(data);
      const envelope2 = createUniversalEnvelope(data);
      
      // IDs should be different
      expect(envelope1.id).to.not.equal(envelope2.id);
      expect(envelope1.gid).to.not.equal(envelope2.gid);
      
      // But other fields should match
      expect(envelope1.type).to.equal(envelope2.type);
      expect(envelope1.tenant).to.equal(envelope2.tenant);
      expect(envelope1.content).to.deep.equal(envelope2.content);
    });
  });
});

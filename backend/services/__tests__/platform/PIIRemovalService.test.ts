import { describe, it, expect, beforeEach } from 'vitest';
import { PIIRemovalService } from '../../pipeline/PIIRemovalService.js';
import { createMockD1 } from '../helpers.js';

describe('PIIRemovalService', () => {
  let service: PIIRemovalService;
  let db: ReturnType<typeof createMockD1>['db'];

  beforeEach(() => {
    ({ db } = createMockD1());
    service = new PIIRemovalService(db as unknown as D1Database);
  });

  describe('scanForPII', () => {
    it('should detect email addresses', () => {
      const result = service.scanForPII({
        name: 'John',
        contact: 'john@example.com',
      });

      expect(result.hasPII).toBe(true);
      const emailFields = result.fields.filter(f => f.piiType === 'email');
      expect(emailFields.length).toBeGreaterThan(0);
    });

    it('should detect Zimbabwe phone numbers', () => {
      const result = service.scanForPII({
        note: 'Call me on +263771234567',
      });

      expect(result.hasPII).toBe(true);
      const phoneFields = result.fields.filter(f => f.piiType === 'phone');
      expect(phoneFields.length).toBeGreaterThan(0);
    });

    it('should detect South African phone numbers', () => {
      const result = service.scanForPII({
        mobile: '+27721234567',
      });

      expect(result.hasPII).toBe(true);
    });

    it('should detect IP addresses', () => {
      const result = service.scanForPII({
        client_ip: '192.168.1.100',
      });

      expect(result.hasPII).toBe(true);
      const ipFields = result.fields.filter(f => f.piiType === 'ip_address');
      expect(ipFields.length).toBeGreaterThan(0);
    });

    it('should detect JWT tokens', () => {
      const result = service.scanForPII({
        token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      });

      expect(result.hasPII).toBe(true);
      const tokenFields = result.fields.filter(f => f.piiType === 'auth_token');
      expect(tokenFields.length).toBeGreaterThan(0);
    });

    it('should detect Zimbabwe national IDs', () => {
      const result = service.scanForPII({
        document: 'My ID is 63-123456-A-78',
      });

      expect(result.hasPII).toBe(true);
      const idFields = result.fields.filter(f => f.piiType === 'national_id');
      expect(idFields.length).toBeGreaterThan(0);
    });

    it('should detect PII by field name', () => {
      const result = service.scanForPII({
        email: 'test@test.com',
        phone_number: '1234567890',
        user_agent: 'Mozilla/5.0',
        password: 'secret123',
      });

      expect(result.hasPII).toBe(true);
      expect(result.fields.length).toBeGreaterThanOrEqual(3);
    });

    it('should return none for clean data', () => {
      const result = service.scanForPII({
        title: 'Zimbabwe economy grows',
        category: 'economy',
        country_code: 'ZW',
        views: 1500,
      });

      expect(result.hasPII).toBe(false);
      expect(result.riskLevel).toBe('none');
    });

    it('should classify risk levels correctly', () => {
      // High risk (national ID)
      const high = service.scanForPII({
        id_number: '63-123456-A-78',
      });
      expect(high.riskLevel).toBe('high');

      // Medium risk (email)
      const medium = service.scanForPII({
        contact: 'user@email.com',
      });
      expect(medium.riskLevel).toBe('medium');

      // Low risk (user agent, IP)
      const low = service.scanForPII({
        ip: '10.0.0.1',
      });
      expect(['low', 'medium']).toContain(low.riskLevel);
    });
  });

  describe('removePII', () => {
    it('should redact email addresses', () => {
      const result = service.removePII({
        name: 'Test Article',
        author_email: 'author@news.co.zw',
      });

      expect(result.clean.author_email).toBe('[EMAIL_REDACTED]');
      expect(result.removed.length).toBeGreaterThan(0);
    });

    it('should redact phone numbers', () => {
      const result = service.removePII({
        contact: '+263771234567',
      });

      expect(result.clean.contact).toBe('[PHONE_REDACTED]');
    });

    it('should partially redact IP addresses (keep first two octets)', () => {
      const result = service.removePII({
        client_ip: '192.168.1.100',
      });

      expect(result.clean.client_ip).toContain('192.168');
      expect(result.clean.client_ip).toContain('xxx');
    });

    it('should completely remove password fields', () => {
      const result = service.removePII({
        user: 'admin',
        password: 'super-secret-123',
        access_token: 'token-abc-xyz',
      });

      expect(result.clean.password).toBeUndefined();
      expect(result.clean.access_token).toBeUndefined();
    });

    it('should not modify clean data', () => {
      const result = service.removePII({
        title: 'Article Title',
        category: 'politics',
        views: 100,
      });

      expect(result.clean.title).toBe('Article Title');
      expect(result.clean.category).toBe('politics');
      expect(result.clean.views).toBe(100);
      expect(result.removed.length).toBe(0);
    });

    it('should generate audit log', () => {
      const result = service.removePII({
        email: 'test@test.com',
        views: 100,
      });

      expect(result.auditLog.id).toBeTruthy();
      expect(result.auditLog.timestamp).toBeTruthy();
      expect(result.auditLog.fieldsScanned).toBe(2);
      expect(result.auditLog.piiFieldsFound).toBeGreaterThan(0);
    });
  });

  describe('removePIIBatch', () => {
    it('should process multiple records', () => {
      const records = [
        { title: 'Article 1', email: 'a@b.com', views: 10 },
        { title: 'Article 2', phone: '+263771234567', views: 20 },
        { title: 'Article 3', views: 30 }, // Clean
      ];

      const result = service.removePIIBatch(records);

      expect(result.clean).toHaveLength(3);
      expect(result.auditSummary.recordsProcessed).toBe(3);
      expect(result.auditSummary.recordsWithPII).toBe(2);
      expect(result.auditSummary.totalFieldsRemoved).toBeGreaterThan(0);
      expect(result.clean[2].views).toBe(30); // Clean record unchanged
    });
  });

  describe('anonymizeUserId', () => {
    it('should produce consistent anonymous IDs', async () => {
      const id1 = await service.anonymizeUserId('user-123', 'salt-abc');
      const id2 = await service.anonymizeUserId('user-123', 'salt-abc');

      expect(id1).toBe(id2);
      expect(id1.startsWith('anon_')).toBe(true);
    });

    it('should produce different IDs for different users', async () => {
      const id1 = await service.anonymizeUserId('user-123', 'salt-abc');
      const id2 = await service.anonymizeUserId('user-456', 'salt-abc');

      expect(id1).not.toBe(id2);
    });

    it('should produce different IDs with different salts', async () => {
      const id1 = await service.anonymizeUserId('user-123', 'salt-abc');
      const id2 = await service.anonymizeUserId('user-123', 'salt-xyz');

      expect(id1).not.toBe(id2);
    });
  });
});

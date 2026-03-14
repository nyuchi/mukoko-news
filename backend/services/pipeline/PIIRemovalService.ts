/**
 * PII Removal Service
 *
 * Detects and removes Personally Identifiable Information (PII) from data
 * before it enters the open data pipeline. Handles African-specific PII
 * patterns (Zimbabwe national IDs, regional phone formats, etc.).
 *
 * Part of the post-publish analytics pipeline (Kafka → Flink → Doris).
 * This service does NOT process article content — only analytics/metadata.
 */

// --- Types ---

export type PIIType =
  | 'email'
  | 'phone'
  | 'ip_address'
  | 'auth_token'
  | 'national_id'
  | 'password'
  | 'user_agent'
  | 'gps_coordinates'
  | 'field_name_match';

export type RiskLevel = 'none' | 'low' | 'medium' | 'high';

export interface PIIField {
  fieldName: string;
  piiType: PIIType;
  riskLevel: RiskLevel;
  value?: string;
}

export interface PIIDetectionResult {
  hasPII: boolean;
  fields: PIIField[];
  riskLevel: RiskLevel;
}

export interface PIIRemovalResult {
  clean: Record<string, unknown>;
  removed: PIIField[];
  auditLog: PIIAuditEntry;
}

export interface PIIBatchResult {
  clean: Record<string, unknown>[];
  auditSummary: {
    recordsProcessed: number;
    recordsWithPII: number;
    totalFieldsRemoved: number;
  };
}

export interface PIIAuditEntry {
  id: string;
  timestamp: string;
  fieldsScanned: number;
  piiFieldsFound: number;
  action: 'redacted' | 'removed' | 'anonymized';
}

// --- PII Detection Patterns ---

const PII_PATTERNS: Array<{ type: PIIType; pattern: RegExp; riskLevel: RiskLevel }> = [
  // Email addresses
  { type: 'email', pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, riskLevel: 'medium' },

  // Zimbabwe phone numbers (+263)
  { type: 'phone', pattern: /\+263\d{9}/g, riskLevel: 'medium' },
  // South Africa (+27)
  { type: 'phone', pattern: /\+27\d{9}/g, riskLevel: 'medium' },
  // Kenya (+254)
  { type: 'phone', pattern: /\+254\d{9}/g, riskLevel: 'medium' },
  // Nigeria (+234)
  { type: 'phone', pattern: /\+234\d{10}/g, riskLevel: 'medium' },
  // Generic international
  { type: 'phone', pattern: /\+\d{10,15}/g, riskLevel: 'medium' },

  // IPv4 addresses
  { type: 'ip_address', pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, riskLevel: 'low' },

  // JWT tokens
  { type: 'auth_token', pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, riskLevel: 'high' },

  // Zimbabwe national IDs (format: XX-XXXXXX-X-XX)
  { type: 'national_id', pattern: /\d{2}-\d{6}-[A-Z]-\d{2}/g, riskLevel: 'high' },

  // GPS coordinates
  { type: 'gps_coordinates', pattern: /-?\d{1,3}\.\d{4,},\s*-?\d{1,3}\.\d{4,}/g, riskLevel: 'medium' },
];

// Field names that indicate PII regardless of value
const PII_FIELD_NAMES: Array<{ pattern: RegExp; type: PIIType; riskLevel: RiskLevel }> = [
  { pattern: /^email$/i, type: 'email', riskLevel: 'medium' },
  { pattern: /^(phone|mobile|tel|phone_number)$/i, type: 'phone', riskLevel: 'medium' },
  { pattern: /^(password|passwd|secret|api_key|api_secret)$/i, type: 'password', riskLevel: 'high' },
  { pattern: /^(access_token|refresh_token|auth_token|bearer_token|token)$/i, type: 'auth_token', riskLevel: 'high' },
  { pattern: /^(user_agent|useragent)$/i, type: 'user_agent', riskLevel: 'low' },
  { pattern: /^(ip|ip_address|client_ip|remote_ip)$/i, type: 'ip_address', riskLevel: 'low' },
  { pattern: /^(ssn|national_id|id_number|passport)$/i, type: 'national_id', riskLevel: 'high' },
  { pattern: /^(lat|lng|latitude|longitude|coords|coordinates|location)$/i, type: 'gps_coordinates', riskLevel: 'medium' },
];

// Fields that should be completely removed (not just redacted)
const REMOVE_FIELDS = /^(password|passwd|secret|api_key|api_secret|access_token|refresh_token|auth_token|bearer_token)$/i;

// --- Service ---

export class PIIRemovalService {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Scan an object for PII without modifying it
   */
  scanForPII(data: Record<string, unknown>): PIIDetectionResult {
    const fields: PIIField[] = [];

    for (const [key, value] of Object.entries(data)) {
      // Check field name
      for (const fieldPattern of PII_FIELD_NAMES) {
        if (fieldPattern.pattern.test(key)) {
          fields.push({
            fieldName: key,
            piiType: fieldPattern.type,
            riskLevel: fieldPattern.riskLevel,
          });
          break;
        }
      }

      // Check value content (only strings)
      if (typeof value === 'string') {
        for (const piiPattern of PII_PATTERNS) {
          // Reset regex lastIndex
          piiPattern.pattern.lastIndex = 0;
          if (piiPattern.pattern.test(value)) {
            // Avoid duplicate if already matched by field name
            const alreadyFound = fields.some(f => f.fieldName === key && f.piiType === piiPattern.type);
            if (!alreadyFound) {
              fields.push({
                fieldName: key,
                piiType: piiPattern.type,
                riskLevel: piiPattern.riskLevel,
              });
            }
          }
        }
      }
    }

    const hasPII = fields.length > 0;
    const riskLevel = this.calculateRiskLevel(fields);

    return { hasPII, fields, riskLevel };
  }

  /**
   * Remove/redact PII from a single record
   */
  removePII(data: Record<string, unknown>): PIIRemovalResult {
    const scan = this.scanForPII(data);
    const clean: Record<string, unknown> = { ...data };
    const removed: PIIField[] = [];

    for (const field of scan.fields) {
      const key = field.fieldName;

      // Completely remove sensitive auth fields
      if (REMOVE_FIELDS.test(key)) {
        delete clean[key];
        removed.push(field);
        continue;
      }

      // Redact based on PII type
      switch (field.piiType) {
        case 'email':
          clean[key] = '[EMAIL_REDACTED]';
          removed.push(field);
          break;
        case 'phone':
          clean[key] = '[PHONE_REDACTED]';
          removed.push(field);
          break;
        case 'ip_address': {
          const ip = String(data[key]);
          const parts = ip.split('.');
          if (parts.length === 4) {
            clean[key] = `${parts[0]}.${parts[1]}.xxx.xxx`;
          } else {
            clean[key] = '[IP_REDACTED]';
          }
          removed.push(field);
          break;
        }
        case 'auth_token':
          clean[key] = '[TOKEN_REDACTED]';
          removed.push(field);
          break;
        case 'national_id':
          clean[key] = '[ID_REDACTED]';
          removed.push(field);
          break;
        case 'user_agent':
          clean[key] = '[USER_AGENT_REDACTED]';
          removed.push(field);
          break;
        case 'gps_coordinates':
          clean[key] = '[LOCATION_REDACTED]';
          removed.push(field);
          break;
        default:
          clean[key] = '[REDACTED]';
          removed.push(field);
      }
    }

    const auditLog: PIIAuditEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      fieldsScanned: Object.keys(data).length,
      piiFieldsFound: removed.length,
      action: 'redacted',
    };

    return { clean, removed, auditLog };
  }

  /**
   * Process multiple records in batch
   */
  removePIIBatch(records: Record<string, unknown>[]): PIIBatchResult {
    let recordsWithPII = 0;
    let totalFieldsRemoved = 0;
    const cleanRecords: Record<string, unknown>[] = [];

    for (const record of records) {
      const result = this.removePII(record);
      cleanRecords.push(result.clean);
      if (result.removed.length > 0) {
        recordsWithPII++;
        totalFieldsRemoved += result.removed.length;
      }
    }

    return {
      clean: cleanRecords,
      auditSummary: {
        recordsProcessed: records.length,
        recordsWithPII,
        totalFieldsRemoved,
      },
    };
  }

  /**
   * Create a consistent anonymous ID from a user ID using SHA-256
   */
  async anonymizeUserId(userId: string, salt: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(`${salt}:${userId}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `anon_${hex.substring(0, 16)}`;
  }

  // --- Private ---

  private calculateRiskLevel(fields: PIIField[]): RiskLevel {
    if (fields.length === 0) return 'none';
    if (fields.some(f => f.riskLevel === 'high')) return 'high';
    if (fields.some(f => f.riskLevel === 'medium')) return 'medium';
    return 'low';
  }
}

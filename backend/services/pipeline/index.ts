/**
 * Pipeline Services Index
 *
 * Data pipeline services for PII removal and analytics processing.
 * Kafka + Flink handles post-publish analytics, NOT article content.
 */

export { PIIRemovalService } from './PIIRemovalService.js';
export type { PIIDetectionResult, PIIField, PIIType, PIIAuditEntry } from './PIIRemovalService.js';

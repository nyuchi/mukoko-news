/**
 * Runtime validation utilities for D1 query results
 *
 * These utilities provide type-safe validation for database query results,
 * avoiding unsafe type assertions like `as unknown as T` or `as any`.
 */

/**
 * Type guard to check if a value is a non-null object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Type guard to check if a value is a string
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Type guard to check if a value is a number
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

/**
 * Type guard to check if a value is a boolean
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/**
 * Safely get a string property from an object
 */
export function getString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return isString(value) ? value : undefined;
}

/**
 * Safely get a number property from an object
 */
export function getNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  return isNumber(value) ? value : undefined;
}

/**
 * Safely get a boolean property from an object (handles SQLite 0/1)
 */
export function getBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
  const value = obj[key];
  if (isBoolean(value)) return value;
  if (isNumber(value)) return value !== 0;
  return undefined;
}

/**
 * News source validation schema
 */
export interface NewsSourceRow {
  id: string;
  name: string;
  url: string;
  rss_feed_url?: string;
  base_domain?: string;
  article_section_id: string;
  area_served?: string;
  in_language?: string;
  enabled: boolean;
  priority: number;
  quality_score?: number;
  reliability_score?: number;
  freshness_score?: number;
  last_validated_at?: string;
  validation_status?: string;
  error_count?: number;
  success_count?: number;
  last_error?: string;
  last_successful_fetch?: string;
  created_at?: string;
  updated_at?: string;
  metadata?: string;
}

/**
 * Validate and parse a D1 row as a NewsSource
 * Returns null if validation fails
 */
export function validateNewsSourceRow(row: unknown): NewsSourceRow | null {
  if (!isObject(row)) return null;

  // Required fields
  const id = getString(row, 'id');
  const name = getString(row, 'name');
  const url = getString(row, 'url');
  const article_section_id = getString(row, 'article_section_id');

  if (!id || !name || !url || !article_section_id) {
    return null;
  }

  // Optional fields with defaults
  const enabled = getBoolean(row, 'enabled') ?? true;
  const priority = getNumber(row, 'priority') ?? 3;

  return {
    id,
    name,
    url,
    rss_feed_url: getString(row, 'rss_feed_url'),
    base_domain: getString(row, 'base_domain'),
    article_section_id,
    area_served: getString(row, 'area_served') ?? getString(row, 'country_id'),
    in_language: getString(row, 'in_language'),
    enabled,
    priority,
    quality_score: getNumber(row, 'quality_score'),
    reliability_score: getNumber(row, 'reliability_score'),
    freshness_score: getNumber(row, 'freshness_score'),
    last_validated_at: getString(row, 'last_validated_at'),
    validation_status: getString(row, 'validation_status'),
    error_count: getNumber(row, 'error_count'),
    success_count: getNumber(row, 'success_count'),
    last_error: getString(row, 'last_error'),
    last_successful_fetch: getString(row, 'last_successful_fetch'),
    created_at: getString(row, 'created_at'),
    updated_at: getString(row, 'updated_at'),
    metadata: getString(row, 'metadata'),
  };
}

/**
 * Validate and parse an array of D1 rows as NewsSource[]
 * Filters out invalid rows
 */
export function validateNewsSourceRows(rows: unknown[]): NewsSourceRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(row => validateNewsSourceRow(row))
    .filter((row): row is NewsSourceRow => row !== null);
}

/**
 * Source performance metrics validation
 */
export interface SourceMetrics {
  reliability_score: number;
  freshness_score: number;
  success_count: number;
  error_count: number;
  last_successful_fetch: string | null;
}

/**
 * Validate source performance metrics from D1 row
 */
export function validateSourceMetrics(row: unknown): SourceMetrics | null {
  if (!isObject(row)) return null;

  const reliability_score = getNumber(row, 'reliability_score');
  const freshness_score = getNumber(row, 'freshness_score');
  const success_count = getNumber(row, 'success_count');
  const error_count = getNumber(row, 'error_count');

  // All numeric fields are required for metrics
  if (
    reliability_score === undefined ||
    freshness_score === undefined ||
    success_count === undefined ||
    error_count === undefined
  ) {
    return null;
  }

  return {
    reliability_score,
    freshness_score,
    success_count,
    error_count,
    last_successful_fetch: getString(row, 'last_successful_fetch') ?? null,
  };
}

/**
 * Parse count result from D1 (e.g., SELECT COUNT(*) as count)
 * Returns 0 as default if parsing fails (does not throw)
 */
export function parseCountResult(row: unknown): number {
  if (!isObject(row)) return 0;
  return getNumber(row, 'count') ?? 0;
}

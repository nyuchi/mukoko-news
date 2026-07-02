/**
 * Runtime input validation for Server Action entry points.
 *
 * Server Actions are a public RPC surface — a malicious or buggy client can
 * invoke them with arbitrary arguments (huge limits, absurd strings, wrong
 * types). Every exported action validates/clamps its inputs with these
 * schemas BEFORE delegating to the MongoDB layer.
 *
 * Design rule: reads degrade gracefully to safe defaults (via
 * `parseOrDefault`) instead of throwing to the client — a bad filter just
 * means an unfiltered (but bounded) query, not a 500.
 */

import { z } from 'zod';

/** Max entries accepted for list filters (countries/categories). */
export const MAX_LIST_ENTRIES = 20;
/** Max page size that may reach the MongoDB driver. */
export const MAX_LIMIT = 100;
/** Max page number (skip ceiling: MAX_PAGE * MAX_LIMIT documents). */
export const MAX_PAGE = 10000;
/** Max length for entity ids (article ids, source ids, session ids). */
export const MAX_ID_LENGTH = 128;
/** Max length for a search query. */
export const MAX_QUERY_LENGTH = 200;

/** Strip ASCII control characters (NUL, escapes, DEL) from a string. */
export function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) out += ch;
  }
  return out;
}

/**
 * Clamp an arbitrary value to an integer within [min, max].
 * Non-numeric / non-finite input returns `fallback` unchanged.
 */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * Parse `value` with `schema`; on any failure return `fallback` instead of
 * throwing. Server Action reads must never surface a ZodError to the client.
 */
export function parseOrDefault<S extends z.ZodTypeAny, F>(
  schema: S,
  value: unknown,
  fallback: F
): z.output<S> | F {
  const result = schema.safeParse(value);
  return result.success ? result.data : fallback;
}

/** ISO-3166-ish 2-letter country code, normalised to uppercase ("zw" → "ZW"). */
export const countryCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/)
  .transform((s) => s.toUpperCase());

/** Category slug: lowercase letters, digits, hyphens; 1–50 chars. */
export const categorySlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{1,50}$/);

/**
 * Bounded free-text field (search filters, moderation reasons): trimmed,
 * control characters stripped, non-empty, length-capped.
 */
export const boundedTextSchema = (maxLength: number) =>
  z
    .string()
    .transform((s) => stripControlChars(s).trim())
    .pipe(z.string().min(1).max(maxLength));

/** Search query: trimmed, control chars stripped, 1–200 chars. */
export const searchQuerySchema = boundedTextSchema(MAX_QUERY_LENGTH);

/** Entity id (article/source/session): trimmed, control chars stripped, 1–128 chars. */
export const idSchema = boundedTextSchema(MAX_ID_LENGTH);

/**
 * Build a list schema that keeps only entries valid per `entrySchema`
 * (dropping the rest, not failing the whole array) and caps the length.
 */
function boundedList<S extends z.ZodTypeAny>(entrySchema: S) {
  return z.array(z.unknown()).transform((arr) =>
    arr
      .flatMap((v) => {
        const r = entrySchema.safeParse(v);
        return r.success ? [r.data as z.output<S>] : [];
      })
      .slice(0, MAX_LIST_ENTRIES)
  );
}

/** Country filter: up to 20 valid 2-letter codes; invalid entries dropped. */
export const countriesSchema = boundedList(countryCodeSchema);

/** Category filter: up to 20 valid slugs; invalid entries dropped. */
export const categoriesSchema = boundedList(categorySlugSchema);

/** `limit` clamped to 1..100; non-numeric input falls back to `fallback`. */
export const limitSchema = (fallback: number) =>
  z.unknown().transform((v) => clampInt(v, 1, MAX_LIMIT, fallback));

/** `page` clamped to 1..10000 (1-based); non-numeric input falls back to 1. */
export const pageSchema = z.unknown().transform((v) => clampInt(v, 1, MAX_PAGE, 1));

/** `offset`/skip clamped to 0..10000; non-numeric input falls back to 0. */
export const offsetSchema = z.unknown().transform((v) => clampInt(v, 0, MAX_PAGE, 0));

/** Feed sort order accepted from clients. */
export const sortSchema = z.enum(['latest', 'popular', 'trending']);

/**
 * Shared feed/article-list params, validated as a unit. Unknown keys are
 * stripped; each field degrades independently (a bad `category` never
 * poisons a good `limit`).
 */
export const feedParamsSchema = z
  .object({
    countries: z.unknown().optional(),
    categories: z.unknown().optional(),
    category: z.unknown().optional(),
    limit: z.unknown().optional(),
    page: z.unknown().optional(),
    sort: z.unknown().optional(),
  })
  .transform((p) => {
    const countries = parseOrDefault(countriesSchema, p.countries, undefined);
    const categories = parseOrDefault(categoriesSchema, p.categories, undefined);
    return {
      countries: countries?.length ? countries : undefined,
      categories: categories?.length ? categories : undefined,
      category: parseOrDefault(categorySlugSchema, p.category, undefined),
      limit: p.limit === undefined ? undefined : clampInt(p.limit, 1, MAX_LIMIT, 20),
      page: p.page === undefined ? undefined : clampInt(p.page, 1, MAX_PAGE, 1),
      sort: parseOrDefault(sortSchema, p.sort, undefined),
    };
  });

export type SafeFeedParams = z.output<typeof feedParamsSchema>;

/** Validate feed params, degrading to an empty (unfiltered, bounded) param set. */
export function safeFeedParams(params: unknown): SafeFeedParams {
  return parseOrDefault(feedParamsSchema, params, {
    countries: undefined,
    categories: undefined,
    category: undefined,
    limit: undefined,
    page: undefined,
    sort: undefined,
  } satisfies SafeFeedParams);
}

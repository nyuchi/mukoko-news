/**
 * Read-only PROVENANCE for a single article — what the Mukoko pipeline did to
 * it, as opposed to what the article says.
 *
 * Import only in Server Components, Route Handlers, or Server Actions.
 *
 * ## Nothing here writes. Ever.
 *
 * Every value below already exists on the article document or is derived from
 * the corpus at read time. Nothing is copied, backfilled, or stamped back onto
 * `news.articles` — the same rule `organizations.ts` follows for publisher
 * verification. A denormalised copy of a trust or quality signal is a signal
 * that keeps asserting itself after the thing it described has changed. There
 * are no write calls in this file, by design, and a test asserts that.
 *
 * ## Absent is absent (measured, not assumed)
 *
 * Coverage on the live cluster, 2026-09-10, over 63,834 articles:
 *
 * | field                     | present | note                                  |
 * | ------------------------- | ------- | ------------------------------------- |
 * | `aiProcessed: true`       |  63,781 | 99.92%                                |
 * | `qualityScore`            |  63,834 | 100% — but see the SENTINEL below     |
 * | `aiQualitySignals`        |  63,785 | always the same 4 sub-scores          |
 * | `aiSentiment`             |  63,785 | positive/negative/neutral/mixed       |
 * | `aiNamedEntities`         |  63,669 |                                       |
 * | `ingestionMethod`         |  63,834 | 100%                                  |
 * | `fulltextMethod`          |  27,643 | 43.3% — only excerpt-only articles    |
 * | `newsdataEnhancedAt`      |     210 | 0.33%                                 |
 * | `engagement.topics`       |       3 | 0.005% — the 12-bucket registry is new |
 * | `linkAuditedAt`           |       2 | 0.003% — audit merged 2026-09-10      |
 * | `spamLinkDomains`         |       0 | 0%                                    |
 *
 * ### The `qualityScore: 0` SENTINEL
 *
 * `qualityScore` is present on 100% of the corpus, which looks like a metric
 * with perfect coverage and is not one. Ingestion writes `0` before enrichment
 * runs. Measured over a 16,000-article partition, **every** article carrying
 * `qualityScore: 0` also carries `aiProcessed: false`, and no enriched article
 * scores 0 — the enriched floor is 0.1. So a rendered "0" would not be a low
 * score, it would be *no score at all*, stated to a reader as a verdict on the
 * journalism. `resolveQualityScore` returns `null` for it, twice over: once on
 * `aiProcessed`, once on the value itself.
 *
 * ### `linkAuditedAt` is load-bearing
 *
 * An absent `spamLinkDomains` means **unmatched, never clean** — 63,832 of
 * 63,834 articles have simply never been through `services/link_reputation.py`.
 * `linkAudit` is therefore `null` unless `linkAuditedAt` exists, and a `null`
 * audit must render as "not audited", never as "no spam links found".
 */

import { getDb, QUERY_MAX_TIME_MS } from './client'

/** The article fields this module reads. Nothing else is projected. */
interface MongoArticleProvenance {
  _id: string
  aiProcessed?: boolean
  aiProcessedAt?: Date
  qualityScore?: number
  aiQualitySignals?: Record<string, unknown>
  aiSentiment?: string
  aiKeywords?: unknown[]
  aiNamedEntities?: unknown[]
  aiSummary?: string
  engagement?: { topics?: unknown[] }
  ingestionMethod?: string
  fulltextMethod?: string
  fulltextFetchedAt?: Date
  newsdataEnhancedAt?: Date
  outboundLinkCount?: number
  spamLinkDomains?: unknown[]
  spamLinkReasons?: unknown[]
  linkAuditedAt?: Date
}

export interface QualitySignal {
  key: string
  label: string
  /** 0–1, as the enrichment worker writes it. */
  value: number
}

/**
 * The outbound-link audit, present ONLY when the article has actually been
 * audited. `null` on the whole object means the audit has not run — which is
 * not the same statement as "this article is clean", and the UI must not
 * collapse the two.
 */
export interface ArticleLinkAudit {
  auditedAt: string
  /** `null` when the audit ran but recorded no count. */
  outboundLinks: number | null
  spamDomains: string[]
  spamReasons: string[]
}

/**
 * How much of the corpus the enrichment-derived numbers actually cover, so the
 * panel can caption them the way `/insights` captions its own subsets rather
 * than presenting a partial metric as a whole one.
 */
export interface EnrichmentCoverage {
  enriched: number
  total: number
  /** One decimal place, matching the `/insights` coverage figures. */
  percent: number
}

export interface ArticleProvenance {
  /** `false` means the enrichment-derived fields below are all `null`/empty. */
  enriched: boolean
  enrichedAt: string | null
  /** `null` for an un-enriched article. NEVER `0` — see the sentinel note. */
  qualityScore: number | null
  qualitySignals: QualitySignal[]
  sentiment: string | null
  keywordCount: number | null
  namedEntityCount: number | null
  hasSummary: boolean
  topics: string[]
  ingestionMethod: string | null
  fulltextMethod: string | null
  fulltextFetchedAt: string | null
  newsdataEnhancedAt: string | null
  /** `null` = NOT AUDITED. Never render this as "clean". */
  linkAudit: ArticleLinkAudit | null
  /** `null` when the corpus counts could not be read; caption it as unknown. */
  coverage: EnrichmentCoverage | null
}

/**
 * The four sub-scores `fundi-news-enrichment` writes, in the order it writes
 * them. A CLOSED map: an unknown key is still shown (the pipeline may add one)
 * but is humanised rather than invented a meaning for.
 */
const SIGNAL_LABELS: Readonly<Record<string, string>> = {
  headline_quality: 'Headline quality',
  content_depth: 'Content depth',
  factual_markers: 'Factual markers',
  local_relevance: 'Local relevance',
}

function humanizeKey(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key
}

function isoOrNull(value: unknown): string | null {
  if (!(value instanceof Date)) return null
  const time = value.getTime()
  return Number.isNaN(time) ? null : value.toISOString()
}

function trimmedOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)
}

/**
 * The score, or nothing.
 *
 * Two independent gates, because either alone would let the ingestion default
 * through on some article. `aiProcessed` is the pipeline's own statement that
 * enrichment ran; `> 0` rejects the sentinel value it writes before that.
 */
function resolveQualityScore(doc: MongoArticleProvenance): number | null {
  if (doc.aiProcessed !== true) return null
  const score = doc.qualityScore
  if (typeof score !== 'number' || !Number.isFinite(score)) return null
  return score > 0 ? score : null
}

function resolveQualitySignals(doc: MongoArticleProvenance): QualitySignal[] {
  if (doc.aiProcessed !== true) return []
  const signals = doc.aiQualitySignals
  if (!signals || typeof signals !== 'object' || Array.isArray(signals)) return []
  return Object.entries(signals)
    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
    .map(([key, value]) => ({
      key,
      label: SIGNAL_LABELS[key] ?? humanizeKey(key),
      value: value as number,
    }))
}

/**
 * The audit, or `null` for "never audited".
 *
 * Note what this does NOT do: it does not synthesise an empty audit from an
 * absent `spamLinkDomains`. `linkAuditedAt` is the only evidence the audit ran,
 * and without it the correct reading of an empty spam list is "unmatched".
 */
function resolveLinkAudit(doc: MongoArticleProvenance): ArticleLinkAudit | null {
  const auditedAt = isoOrNull(doc.linkAuditedAt)
  if (!auditedAt) return null
  const count = doc.outboundLinkCount
  return {
    auditedAt,
    outboundLinks: typeof count === 'number' && Number.isFinite(count) ? count : null,
    spamDomains: stringList(doc.spamLinkDomains),
    spamReasons: stringList(doc.spamLinkReasons),
  }
}

/**
 * How long a corpus-coverage reading is reused within one server instance.
 *
 * The enriched count is an index scan over ~64k keys, not free, and the figure
 * moves by a few hundredths of a percent per hour. Ten minutes matches the
 * `/insights` revalidate window, which is where the same kind of coverage
 * caption is already computed.
 */
const COVERAGE_CACHE_TTL_MS = 600_000

let cachedCoverage: { value: EnrichmentCoverage; at: number } | null = null
let coverageInFlight: Promise<EnrichmentCoverage | null> | null = null

async function readEnrichmentCoverage(): Promise<EnrichmentCoverage | null> {
  const db = await getDb()
  const articles = db.collection('articles')
  const [total, enriched] = await Promise.all([
    articles.estimatedDocumentCount({ maxTimeMS: QUERY_MAX_TIME_MS }),
    articles.countDocuments({ aiProcessed: true }, { maxTimeMS: QUERY_MAX_TIME_MS }),
  ])
  if (!Number.isFinite(total) || total <= 0) return null
  return {
    enriched,
    total,
    percent: Math.round((enriched / total) * 1000) / 10,
  }
}

/**
 * Corpus enrichment coverage, or `null`.
 *
 * `null` is a real answer here and the caller must render it as "coverage
 * unknown" — a caption claiming 100% because a count failed would be exactly
 * the kind of confident wrong number this module exists to avoid.
 *
 * `estimatedDocumentCount` reads collection metadata (O(1)); the enriched count
 * rides the existing `aiProcessed_createdAt` index. Neither reads a document.
 */
export async function getEnrichmentCoverage(): Promise<EnrichmentCoverage | null> {
  const now = Date.now()
  if (cachedCoverage && now - cachedCoverage.at < COVERAGE_CACHE_TTL_MS) {
    return cachedCoverage.value
  }
  // Collapse a thundering herd: concurrent staff views share one corpus read.
  if (coverageInFlight) return coverageInFlight

  coverageInFlight = readEnrichmentCoverage()
    .then((value) => {
      if (value) cachedCoverage = { value, at: Date.now() }
      return value ?? cachedCoverage?.value ?? null
    })
    .catch((err) => {
      console.error('[article-metrics] enrichment coverage read failed:', err)
      return cachedCoverage?.value ?? null
    })
    .finally(() => {
      coverageInFlight = null
    })

  return coverageInFlight
}

/** Test-only: drop the in-process coverage cache. */
export function __resetEnrichmentCoverageCache() {
  cachedCoverage = null
  coverageInFlight = null
}

/**
 * Resolve one article's pipeline provenance.
 *
 * Returns `null` when the article does not exist. Fail-soft is the caller's
 * job here rather than this function's: an article page must not 500 because a
 * staff panel could not load, and the Server Action above it swallows errors.
 */
export async function getArticleProvenance(articleId: string): Promise<ArticleProvenance | null> {
  const db = await getDb()
  const doc = await db.collection<MongoArticleProvenance>('articles').findOne(
    { _id: articleId },
    {
      // Explicit inclusion, not the exclusion-based list projection used for
      // reads that need the article itself: this path wants ~20 small scalars
      // and must never pull `embedding` or the three body renditions.
      projection: {
        aiProcessed: 1,
        aiProcessedAt: 1,
        qualityScore: 1,
        aiQualitySignals: 1,
        aiSentiment: 1,
        aiKeywords: 1,
        aiNamedEntities: 1,
        aiSummary: 1,
        'engagement.topics': 1,
        ingestionMethod: 1,
        fulltextMethod: 1,
        fulltextFetchedAt: 1,
        newsdataEnhancedAt: 1,
        outboundLinkCount: 1,
        spamLinkDomains: 1,
        spamLinkReasons: 1,
        linkAuditedAt: 1,
      },
      maxTimeMS: QUERY_MAX_TIME_MS,
    }
  )
  if (!doc) return null

  const enriched = doc.aiProcessed === true

  return {
    enriched,
    enrichedAt: isoOrNull(doc.aiProcessedAt),
    qualityScore: resolveQualityScore(doc),
    qualitySignals: resolveQualitySignals(doc),
    sentiment: enriched ? trimmedOrNull(doc.aiSentiment) : null,
    // A count of zero is only meaningful once enrichment has run; before that
    // it is the absence of a measurement, so it stays null rather than "0".
    keywordCount: enriched && Array.isArray(doc.aiKeywords) ? doc.aiKeywords.length : null,
    namedEntityCount:
      enriched && Array.isArray(doc.aiNamedEntities) ? doc.aiNamedEntities.length : null,
    hasSummary: enriched && !!trimmedOrNull(doc.aiSummary),
    topics: stringList(doc.engagement?.topics),
    ingestionMethod: trimmedOrNull(doc.ingestionMethod),
    fulltextMethod: trimmedOrNull(doc.fulltextMethod),
    fulltextFetchedAt: isoOrNull(doc.fulltextFetchedAt),
    newsdataEnhancedAt: isoOrNull(doc.newsdataEnhancedAt),
    linkAudit: resolveLinkAudit(doc),
    coverage: await getEnrichmentCoverage(),
  }
}

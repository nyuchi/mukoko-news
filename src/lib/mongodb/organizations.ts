/**
 * Server-side MongoDB reads for `news.newsMediaOrganizations` — the collection
 * that owns PUBLISHERS.
 *
 * Import only in Server Components, Route Handlers, or Server Actions.
 *
 * ## Why this exists (publisher ≠ feed source)
 *
 * `Article.source` is the FEED SOURCE name, resolved from `feedSources` via
 * `feedSourceId`. A feed source is a *delivery endpoint*, not a masthead, and
 * one publisher routinely holds several of them: the newsdata.io collector
 * registers an outlet under the id it was discovered with, so an outlet already
 * ingested over RSS gets a second record. Measured on the live cluster
 * (2026-09-10): **587 feed sources across 536 organisations, 41 organisations
 * holding more than one source, and 35 of those holding sources whose NAMES
 * disagree** — "Monitor" / "Daily Monitor" / "Daily Monitor v2" are three
 * records for one newsroom, as are "Nation Africa Kenya" / "Daily Nation" /
 * "nation". **15,624 of 63,832 articles (24%) belong to a publisher whose feed
 * sources disagree on the name.**
 *
 * So attributing schema.org `publisher` from the feed-source name would emit
 * two or three different publishers for one masthead. The organisation record
 * is what makes the attribution stable, and it carries the canonical name
 * ("Daily Monitor Uganda") rather than whichever label a feed happened to ship.
 *
 * ## Nothing here is ever written back onto an article
 *
 * The publisher's identity, URL and — critically — its `isVerified` flag exist
 * in exactly ONE place: the organisation record. This module RESOLVES that
 * reference at read time; it never denormalises a copy onto `news.articles`.
 * Copying a trust signal onto 63,832 documents would mean a revoked
 * verification stayed true on every article already stamped with it. The
 * article carries `mediaOrganizationId`; that reference is the whole link.
 *
 * There are no writes in this file, by design.
 */

import { getDb, QUERY_MAX_TIME_MS } from './client'
import { isValidImageUrl } from '@/lib/utils'

interface MongoMediaOrganization {
  _id: string
  name?: string
  url?: string
  /**
   * Absent on every record on the live cluster today (532 missing, 5 explicitly
   * null, 0 populated — measured 2026-09-10), but the schema allows it and it
   * has been stored both as a bare string and as a Schema.org ImageObject
   * elsewhere in this pipeline, so accept both shapes rather than guess one.
   */
  logo?: string | { url?: string } | null
  isVerified?: boolean
}

/**
 * The publishing organisation behind an article, resolved from its own record.
 *
 * This is a DERIVED, per-request shape assembled on read — it is not stored on
 * the article and must never be. `isVerified` in particular is a live read of
 * the single instance on the organisation record: flip it there and the next
 * read reflects it everywhere at once.
 */
export interface PublisherOrganization {
  id: string
  name: string
  /** The newsroom's own home page, when the record has one. */
  url?: string
  /** The newsroom's own logo. Never Mukoko's — see `json-ld.tsx`. */
  logo?: string
  /** Tier-2 publisher verification, read live from the organisation record. */
  isVerified: boolean
}

/**
 * Hard ceiling on the map read.
 *
 * The collection is 537 rows today and is a catalogue, not a growth series, so
 * a bounded `find` over the whole thing is a few hundred KB. The cap exists so
 * that if it ever does grow unexpectedly this read degrades into "some
 * publishers unresolved" (which falls back to the feed-source name) rather than
 * into an unbounded scan on the article page. Every other read in this repo is
 * bounded; this one is too.
 */
const ORGANIZATION_SCAN_CAP = 2000

/**
 * How long a loaded map is reused within one server instance.
 *
 * Publisher records change on the timescale of an editorial review, not a page
 * view, so re-reading the catalogue per request would be pure waste. 60s is
 * short enough that a verification flip propagates within a minute and long
 * enough that a burst of article views costs one read.
 *
 * This is a cache of the SINGLE instance, not a copy of it: nothing is
 * persisted, and the value is recomputed from the owning collection.
 */
const ORGANIZATION_CACHE_TTL_MS = 60_000

type OrganizationMap = ReadonlyMap<string, PublisherOrganization>

const EMPTY_MAP: OrganizationMap = new Map()

let cached: { map: OrganizationMap; at: number } | null = null
let inFlight: Promise<OrganizationMap> | null = null

/**
 * An absolute http(s) URL, or nothing.
 *
 * These values are PUBLISHER-CONTROLLED and land in a `<script>` tag as
 * structured data, so a `javascript:`/`data:` href must never reach it.
 * `isValidImageUrl` is the repo's guard for image sources but also admits
 * root-relative paths, which would resolve against Mukoko's own origin — the
 * precise confusion this whole change exists to remove — so a publisher's home
 * page is checked here instead.
 */
function absoluteHttpUrl(value?: string | null): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? trimmed : undefined
  } catch {
    return undefined
  }
}

/** Accept a bare string or a Schema.org ImageObject; reject anything unsafe. */
function resolveLogo(logo: MongoMediaOrganization['logo']): string | undefined {
  const raw = typeof logo === 'string' ? logo : logo?.url
  const trimmed = raw?.trim()
  return trimmed && isValidImageUrl(trimmed) && absoluteHttpUrl(trimmed) ? trimmed : undefined
}

function toPublisher(doc: MongoMediaOrganization): PublisherOrganization | null {
  const name = doc.name?.trim()
  // A record with no name cannot attribute anything. Returning null sends the
  // caller to the feed-source fallback rather than emitting an empty publisher.
  if (!name) return null
  return {
    id: doc._id,
    name,
    url: absoluteHttpUrl(doc.url),
    logo: resolveLogo(doc.logo),
    isVerified: doc.isVerified === true,
  }
}

async function loadOrganizationMap(): Promise<OrganizationMap> {
  const db = await getDb()
  const docs = await db
    .collection<MongoMediaOrganization>('newsMediaOrganizations')
    .find({}, { projection: { name: 1, url: 1, logo: 1, isVerified: 1 } })
    .limit(ORGANIZATION_SCAN_CAP)
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .toArray()

  const map = new Map<string, PublisherOrganization>()
  for (const doc of docs) {
    const publisher = toPublisher(doc)
    if (publisher) map.set(doc._id, publisher)
  }
  return map
}

/**
 * The publisher catalogue, keyed by `newsMediaOrganizations._id` (which is what
 * `articles.mediaOrganizationId` references).
 *
 * Fail-soft, like every other read on the article path: a failure returns the
 * last good map if there is one and an empty map otherwise. An empty map means
 * "unresolved", never "no publisher" — callers fall back to the feed-source
 * name and, failing that, omit the publisher entirely. Degrading a page to a
 * less precise attribution is acceptable; 500ing the article is not.
 */
export async function getPublisherOrganizationMap(): Promise<OrganizationMap> {
  const now = Date.now()
  if (cached && now - cached.at < ORGANIZATION_CACHE_TTL_MS) return cached.map
  // Collapse a thundering herd: concurrent article views share one read.
  if (inFlight) return inFlight

  inFlight = loadOrganizationMap()
    .then((map) => {
      cached = { map, at: Date.now() }
      return map
    })
    .catch((err) => {
      console.error('[organizations] failed to load publisher catalogue:', err)
      return cached?.map ?? EMPTY_MAP
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

/**
 * Resolve one article's publishing organisation from its `mediaOrganizationId`.
 *
 * Returns `undefined` when the id is absent or unknown — the caller must then
 * fall back rather than invent a publisher. This repo's precedent is explicit:
 * the pipeline's country backfill never invents a country, because a null is a
 * known gap and a wrong value is a silent error shown to readers as fact. The
 * same rule applies to attributing someone's journalism.
 */
export async function getPublisherOrganization(
  mediaOrganizationId?: string | null
): Promise<PublisherOrganization | undefined> {
  const id = mediaOrganizationId?.trim()
  if (!id) return undefined
  const map = await getPublisherOrganizationMap()
  return map.get(id)
}

/** Test-only: drop the in-process cache so a suite can control what is loaded. */
export function __resetPublisherOrganizationCache() {
  cached = null
  inFlight = null
}

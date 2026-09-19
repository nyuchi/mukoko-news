/**
 * The byline directory as a SNAPSHOT, read by slug instead of rebuilt per read.
 *
 * ## What this replaces, and why
 *
 * `getBylineDirectory()` (`./authors`) is one `$group` over every attributed
 * article in the corpus. Measured warm on the live cluster 2026-09-17 it is
 * **11,057 ms** — a covered `IXSCAN`, `totalDocsExamined: 0`, ~58,700 keys — so
 * the index is doing its job and the time is the M20's two burstable vCPU
 * grinding through the keys. It cannot be made fast from this repo.
 *
 * It was on the READ path: `unstable_cache` held it for an hour, and whichever
 * reader arrived on a cold cache paid the full scan. An hour's cache does not
 * fix that, it just picks one unlucky reader per hour per region — and that
 * reader is usually a crawler on a byline page nobody has opened recently,
 * which is exactly the request you least want to spend 11 s on.
 *
 * So the build moved to a cron (`/api/cron/byline-directory`) and the result
 * lives here, one document per slug:
 *
 * ```
 *   news.bylineDirectory
 *   { _id: "abubakar-ibrahim", name, variants[], articles, newsroomIds[], desk, generation }
 * ```
 *
 * `_id` IS the slug, so resolving a URL is a point lookup on `_id_` — the one
 * index every collection has, and the read is covered by it. No scan, no
 * `$group`, nothing proportional to the corpus.
 *
 * ## The failure modes this file exists to keep separate
 *
 * This is the third time the same trap has been laid on this route, so it is
 * spelled out rather than implied. An empty answer has THREE causes and only
 * one of them is a statement about a journalist:
 *
 * | situation                          | what it means            | answer        |
 * | ---------------------------------- | ------------------------ | ------------- |
 * | row found                          | the byline               | `ok`          |
 * | no row, snapshot has other rows    | we looked; nobody there  | `not-found`   |
 * | no row, snapshot is EMPTY          | never built, or wiped    | `unavailable` |
 * | the read itself threw              | cluster unreachable      | `unavailable` |
 *
 * The third row is the one a naive port gets wrong. A freshly deployed
 * environment, a dropped collection or a cron that has never fired all look
 * exactly like "this platform has no bylines" — and rendering that as a 404
 * over a named journalist is the original bug wearing new clothes. So a miss
 * costs one extra `estimatedDocumentCount` to find out which kind of miss it
 * is, and that only happens on the miss path: a byline that resolves is one
 * round trip.
 *
 * ## Publishing is upsert-then-sweep, never wipe-then-fill
 *
 * A rebuild must never leave the directory empty or partial for a reader mid
 * flight. `publishBylineDirectory` stamps every row with the build's
 * `generation`, upserts them all, and only then deletes what the sweep did not
 * touch. Until the sweep runs, readers see the previous snapshot; after it,
 * the new one. There is no window in which the collection is empty.
 *
 * And it **refuses to publish an empty build over a populated snapshot**. A
 * build that legitimately finds no bylines and a build whose upstream read
 * silently returned nothing are indistinguishable here, and only one of them is
 * worth destroying a working directory for. The caller passes `ok` from the
 * source read; this function still double-checks, because the cost of being
 * wrong is every author page on the platform 404ing until the next cron.
 */

import { getDb, QUERY_MAX_TIME_MS } from './client'
import { authorSlug } from '@/lib/author-identity'
import type { BylineIdentity } from './authors'

/** One document per byline slug. Named here so the cron and the reader agree. */
export const BYLINE_DIRECTORY_COLLECTION = 'bylineDirectory'

/** How many upserts go in one `bulkWrite`. The driver batches too; this bounds memory. */
const WRITE_CHUNK = 1000

/**
 * A stored row: the identity, plus which build wrote it.
 *
 * `_id` is the slug and is therefore declared as a string — the driver's
 * default `_id` type is `ObjectId`, and without this the collection's own
 * typing would reject the point lookup this whole design is built on.
 */
export interface DirectoryRow extends BylineIdentity {
  _id: string
  /** The build that wrote this row — an ISO timestamp. The sweep deletes every other value. */
  generation: string
}

/**
 * What a slug lookup can say.
 *
 * Three-valued for the same reason `AuthorPageResult` is: `not-found` is a
 * CLAIM about the platform's contents and may only be made when we actually
 * read a directory that had contents to check against.
 */
export type IdentityLookup =
  | { status: 'ok'; identity: BylineIdentity }
  | { status: 'not-found' }
  | { status: 'unavailable' }

function toIdentity(row: DirectoryRow): BylineIdentity {
  return {
    slug: row.slug,
    name: row.name,
    variants: row.variants,
    articles: row.articles,
    newsroomIds: row.newsroomIds,
    desk: row.desk,
  }
}

/**
 * Resolve a URL slug to the byline it names.
 *
 * The argument is re-folded through `authorSlug` rather than trusted: the value
 * arrives from the URL, and `_id` is a user-controlled lookup key. Folding it
 * means `/author/Abubakar-Ibrahim` and `/author/abubakar%20ibrahim` land on the
 * same stored row instead of missing, and a slug that folds to nothing is
 * rejected before it reaches the database.
 */
export async function lookupBylineIdentity(slug: string): Promise<IdentityLookup> {
  const wanted = authorSlug(slug)
  // Punctuation-only input addresses no byline. This is a finding about the
  // URL, not about the cluster, so it is `not-found` without a read.
  if (!wanted) return { status: 'not-found' }

  try {
    const db = await getDb()
    const collection = db.collection<DirectoryRow>(BYLINE_DIRECTORY_COLLECTION)

    const row = await collection.findOne({ _id: wanted }, { maxTimeMS: QUERY_MAX_TIME_MS })
    if (row) return { status: 'ok', identity: toIdentity(row) }

    // A miss is only a finding if there is a directory to have missed IN.
    // `estimatedDocumentCount` reads collection metadata rather than scanning,
    // and returns 0 for a collection that does not exist at all — which is
    // precisely the "never built" case this distinguishes.
    const populated = await collection.estimatedDocumentCount()
    return populated > 0 ? { status: 'not-found' } : { status: 'unavailable' }
  } catch (error) {
    console.error('[byline-directory.lookupBylineIdentity]', error)
    return { status: 'unavailable' }
  }
}

export interface PublishOutcome {
  /** False when nothing was written — see `reason`. */
  published: boolean
  /** Rows upserted by this build. */
  written: number
  /** Rows deleted because an earlier build wrote them and this one did not. */
  removed: number
  /** The generation stamp every row of this build carries. */
  generation: string
  /** Why a build was refused, when it was. */
  reason?: 'source-unavailable' | 'empty-build'
}

/**
 * Replace the snapshot with a fresh build.
 *
 * `sourceOk` is the `ok` flag from whatever produced `bylines` — passed in
 * rather than inferred, because a failed read and an empty corpus both arrive
 * here as an empty array and this function must not have to guess which.
 */
export async function publishBylineDirectory(
  bylines: BylineIdentity[],
  sourceOk: boolean
): Promise<PublishOutcome> {
  const generation = new Date().toISOString()
  const refuse = (reason: PublishOutcome['reason']): PublishOutcome => ({
    published: false,
    written: 0,
    removed: 0,
    generation,
    reason,
  })

  // The source said it could not read. Whatever is in the snapshot is older but
  // true; an empty array here is an outage, not a corpus.
  if (!sourceOk) return refuse('source-unavailable')

  const db = await getDb()
  const collection = db.collection<DirectoryRow>(BYLINE_DIRECTORY_COLLECTION)

  if (bylines.length === 0) {
    // A genuinely empty corpus may publish an empty directory; an empty build
    // over a populated one is refused. The existing snapshot is kept and the
    // caller reports the refusal, so a build that has started returning nothing
    // is visible rather than silently destroying every author page.
    const populated = await collection.estimatedDocumentCount()
    if (populated > 0) return refuse('empty-build')
  }

  let written = 0
  for (let i = 0; i < bylines.length; i += WRITE_CHUNK) {
    const chunk = bylines.slice(i, i + WRITE_CHUNK)
    const result = await collection.bulkWrite(
      chunk.map((byline) => ({
        replaceOne: {
          filter: { _id: byline.slug },
          replacement: { ...byline, _id: byline.slug, generation },
          upsert: true,
        },
      })),
      { ordered: false }
    )
    // `matchedCount` already covers the rows `modifiedCount` reports, so adding
    // both would double-count every byline whose entry changed.
    written += (result.upsertedCount ?? 0) + (result.matchedCount ?? 0)
  }

  // The sweep, and it runs LAST on purpose: until this line every reader is
  // served either a new row or the previous build's row, both of which are real
  // bylines. Deleting first would open a window where the directory is empty
  // and every author page answers `unavailable`.
  const swept = await collection.deleteMany({ generation: { $ne: generation } })

  return { published: true, written, removed: swept.deletedCount ?? 0, generation }
}

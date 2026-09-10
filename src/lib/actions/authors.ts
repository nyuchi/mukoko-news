'use server'

import { unstable_cache } from 'next/cache'

import {
  getAuthorProfile,
  getBylineDirectory,
  type AuthorFacet,
  type AuthorProfile,
  type BylineIdentity,
} from '@/lib/mongodb/authors'
import { getPublisherOrganizationMap } from '@/lib/mongodb/organizations'
import { getSources } from '@/lib/mongodb/sources'
import { authorSlug } from '@/lib/author-identity'

/**
 * How long the byline directory and the two name catalogues are reused.
 *
 * An hour, matching the coverage read. The directory is one scan of the
 * article corpus — the same cost class as `getLiveCountries` — and it exists so
 * that EVERY author page shares that one scan instead of paying for a
 * per-request lookup. Running it per request is the failure mode this cache
 * exists to prevent, not a tuning question.
 */
const DIRECTORY_TTL_SECONDS = 3600

/** How many chips each classification panel shows once variants are merged. */
const TAG_CHIP_LIMIT = 12
const CATEGORY_CHIP_LIMIT = 8

const loadDirectory = unstable_cache(getBylineDirectory, ['byline-directory'], {
  revalidate: DIRECTORY_TTL_SECONDS,
  tags: ['authors'],
})

/** `feedSources._id` → the feed's own name, for labelling the sources panel. */
const loadSourceNames = unstable_cache(
  async (): Promise<Record<string, string>> => {
    const sources = await getSources()
    return Object.fromEntries(sources.map((s) => [s.id, s.name]))
  },
  ['author-source-names'],
  { revalidate: DIRECTORY_TTL_SECONDS, tags: ['authors'] }
)

/** A facet row with the label resolved, or the bare id when the catalogue has none. */
export interface LabelledFacet extends AuthorFacet {
  label: string
}

/** A classification row that also addresses the developing-story timeline it belongs to. */
export interface TopicFacet extends LabelledFacet {
  href: string
}

/**
 * The `/topic/[slug]` address for a tag, and the exact inverse of what that
 * page does with it.
 *
 * `getTopicTimeline` matches a tag by turning the slug back into a name —
 * `slug.replace(/-/g, ' ')`, case-insensitively — so the only fold that
 * round-trips is lowercase plus spaces-to-hyphens. `authorSlug` is deliberately
 * NOT used here: it also folds diacritics and strips punctuation, so
 * "Côte d'Ivoire" would address `/topic/cote-d-ivoire`, whose name form
 * ("cote d ivoire") matches nothing and renders as a story with no coverage.
 *
 * A tag that already contains a hyphen ("Anglo-Saxon") survives too: the
 * timeline also tests the slug against the stored tag directly.
 */
function topicHref(value: string): string {
  return `/topic/${encodeURIComponent(value.trim().toLowerCase().replace(/\s+/g, '-'))}`
}

/**
 * Merge rows that are the same thing spelled differently, keeping the
 * most-published spelling as the label.
 *
 * Tags are OPEN by design — no vocabulary, no approval — and the corpus holds
 * them as raw phrases rather than slugs (measured 2026-09-10: "World Cup",
 * "Strait of Hormuz"), with casing variants alongside. Grouping in MongoDB is
 * on the stored value, so "Ghana" and "ghana" arrive as two rows and would
 * render as two identical chips with the count split between them. Folding here
 * rather than in the aggregation keeps the raw spelling available to show.
 */
function foldTopics(rows: AuthorFacet[], limit: number): TopicFacet[] {
  const merged = new Map<string, TopicFacet>()
  for (const row of rows) {
    const key = row.key.trim().toLowerCase()
    if (!key) continue
    const existing = merged.get(key)
    // Rows arrive count-descending, so the first spelling seen is the most used.
    if (existing) existing.count += row.count
    else merged.set(key, { key, count: row.count, label: row.key.trim(), href: topicHref(row.key) })
  }
  return [...merged.values()].sort((a, b) => b.count - a.count).slice(0, limit)
}

export interface AuthorPage {
  /** How the byline is spelled, from the corpus — never reconstructed from the slug. */
  name: string
  slug: string
  /**
   * True when this page is a newsroom's DESK rather than a person.
   *
   * The page must say so. "Staff Reporter" files under ten mastheads in four
   * countries, and a reader shown 198 articles under one heading will read it
   * as one journalist unless told otherwise.
   */
  desk: boolean
  /** The masthead a desk page is scoped to. Always set when `desk` is true. */
  newsroom?: { id: string; name: string }
  profile: AuthorProfile
  sources: LabelledFacet[]
  newsrooms: LabelledFacet[]
  /** Open-vocabulary tags, folded onto one spelling each, each addressing its timeline. */
  tags: TopicFacet[]
  /** The closed, platform-wide 40 interest categories. Already slugs in the corpus. */
  categories: TopicFacet[]
}

function label(rows: AuthorFacet[], names: Record<string, string>): LabelledFacet[] {
  return rows.map((row) => ({ ...row, label: names[row.key] ?? row.key }))
}

/**
 * Find the byline a URL slug refers to.
 *
 * Exported so the page and its metadata can resolve once each without
 * duplicating the fold rules.
 */
async function findIdentity(slug: string): Promise<BylineIdentity | undefined> {
  const wanted = authorSlug(slug)
  if (!wanted) return undefined
  return (await loadDirectory()).find((entry) => entry.slug === wanted)
}

/**
 * The author page, or `null` when the URL does not name a byline this corpus
 * carries.
 *
 * `null` is a 404, and the distinction matters: a failed directory read returns
 * an empty directory, which lands here as `null` too. That is the right
 * failure — a page that renders a journalist's name above zero articles asserts
 * they have published nothing, which is a claim about a real person that the
 * platform would be making from an outage.
 *
 * ## Desk bylines are scoped, not merged
 *
 * `newsroomSlug` is required for a desk byline and rejected for a person. A
 * desk URL without a newsroom cannot be answered truthfully, so it 404s rather
 * than falling back to the merged view.
 */
export async function getAuthorPageAction(
  slug: string,
  newsroomSlug?: string
): Promise<AuthorPage | null> {
  const identity = await findIdentity(slug)
  if (!identity) return null

  const organizations = await getPublisherOrganizationMap()

  let newsroom: { id: string; name: string } | undefined
  if (identity.desk) {
    if (!newsroomSlug) return null
    const wanted = authorSlug(newsroomSlug)
    for (const id of identity.newsroomIds) {
      const org = organizations.get(id)
      if (org && authorSlug(org.name) === wanted) {
        newsroom = { id, name: org.name }
        break
      }
    }
    // A desk byline whose newsroom segment matches none of the mastheads it has
    // actually filed to. Answering it with the unscoped profile is exactly the
    // false attribution the scoping exists to prevent.
    if (!newsroom) return null
  } else if (newsroomSlug) {
    // A person's page has one address. Serving the same profile at a second,
    // newsroom-prefixed URL would split its ranking across two of them.
    return null
  }

  const profile = await getAuthorProfile({
    variants: identity.variants,
    newsroomIds: newsroom ? [newsroom.id] : undefined,
  })

  const sourceNames = await loadSourceNames()
  const newsroomNames = Object.fromEntries(
    [...organizations.entries()].map(([id, org]) => [id, org.name])
  )

  return {
    name: identity.name,
    slug: identity.slug,
    desk: identity.desk,
    newsroom,
    profile,
    sources: label(profile.sources, sourceNames),
    newsrooms: label(profile.newsrooms, newsroomNames),
    tags: foldTopics(profile.tags, TAG_CHIP_LIMIT),
    categories: foldTopics(profile.categories, CATEGORY_CHIP_LIMIT),
  }
}

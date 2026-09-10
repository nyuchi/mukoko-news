/**
 * Who a byline actually is, and therefore what a page about it may claim.
 *
 * ## The problem this exists to solve
 *
 * `author.name` is a free-text string the publisher wrote. Grouping articles by
 * it and calling the result "a journalist" is wrong for a large, specific and
 * measurable slice of this corpus. Measured on the live cluster (2026-09-10),
 * over 29,615 attributed articles / 3,792 distinct raw bylines:
 *
 * | byline           | articles | sources | newsrooms | countries |
 * | ---------------- | -------- | ------- | --------- | --------- |
 * | Online Reporter  |    1,111 |       2 |         2 |         1 |
 * | Abubakar Ibrahim |      323 |       2 |         2 |         2 |
 * | Malawi Voice     |      258 |       1 |         1 |         1 |
 * | **Staff Reporter** | **198** |  **10** |    **10** |     **4** |
 * | Correspondent    |       94 |       1 |         1 |         1 |
 *
 * "Staff Reporter" is not a person. It is the *desk* byline of ten different
 * newsrooms in four countries, and a page headed "Staff Reporter — 198
 * articles" would assert that one writer filed all of them. The platform's
 * standing rule is that a gap is reported as a gap and a wrong value is never
 * presented as fact, so the page cannot be built on the bare name.
 *
 * It also cannot simply drop those bylines: the pipeline's
 * `services/byline.normalize_byline` deliberately KEEPS "Herald Reporter",
 * "Staff Writer" and "Correspondent", because they are real, intentional
 * bylines in the African press. Discarding them would throw away the
 * attribution the publisher actually made.
 *
 * ## The resolution
 *
 * A byline is either a PERSON or a DESK.
 *
 * - A person gets one page across the whole corpus — that is the point of it,
 *   and it is what answers "which sources does she publish for".
 * - A desk gets one page **per newsroom**: `/author/<newsroom>/<desk>`. The
 *   Herald's staff desk and the Daily Nation's staff desk are two mastheads'
 *   desks that happen to share a label, and scoping is the only reading of
 *   that label the data supports.
 *
 * A desk with no resolvable newsroom gets no page at all, because there is
 * nothing to scope it to — see `authorHref`.
 *
 * Everything here is pure: no clock, no network, no database. It is the single
 * place the person/desk distinction is expressed, so the route, the byline link
 * and the directory read can never disagree about it.
 */

/**
 * Words that make a byline a DESK rather than a person.
 *
 * A **closed** set, matched on whole words only. Closed rather than heuristic
 * for the same reason the pipeline's link-reputation lexicon is closed: a rule
 * that guesses will misfile a real journalist under a masthead's desk, and the
 * reader has no way to tell that happened.
 *
 * Deliberately NOT in the set — each of these looks like a desk marker and is
 * not one:
 *
 * - `news`, `online`, `digital`, `web` — every real desk byline carrying them
 *   ("Online Reporter", "Digital Desk") is already caught by `reporter` or
 *   `desk`, so adding them buys nothing and widens the blast radius onto
 *   outlet-shaped bylines.
 * - `post`, `press`, `times`, `herald`, `voice` — masthead words. "Malawi
 *   Voice" is an outlet filing under its own name, which is a different
 *   problem from a desk byline and is not fixed by scoping it to itself.
 *
 * The set is intentionally small. A byline this does not catch is treated as a
 * person, which is the conservative answer: it produces a page about exactly
 * the articles carrying that byline and claims nothing beyond them.
 */
const DESK_WORDS = [
  'bureau',
  'contributor',
  'contributors',
  'correspondent',
  'correspondents',
  'desk',
  'editor',
  'editorial',
  'editors',
  'newsdesk',
  'newsroom',
  'reporter',
  'reporters',
  'staff',
  'team',
  'writer',
  'writers',
] as const

const DESK_PATTERN = new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${DESK_WORDS.join('|')})(?:[^\\p{L}\\p{N}]|$)`, 'iu')

/**
 * Is this byline a newsroom's desk rather than a named journalist?
 *
 * Word-boundary matched against the closed set above, so "Newsome" is a person
 * and "Herald Reporter" is a desk. `\b` is not used: it is defined on `\w`,
 * which excludes accented letters, so `\bstaff\b` would match inside "Zébéstaff"
 * — this corpus carries French, Portuguese and Arabic feeds and cannot assume
 * ASCII.
 */
export function isDeskByline(name: string): boolean {
  return DESK_PATTERN.test(name ?? '')
}

/**
 * The URL-safe form of a name.
 *
 * Diacritics are folded (NFD, then combining marks dropped) so "José Silva" and
 * "Jose Silva" reach the same page — they are the same journalist and the
 * corpus spells bylines inconsistently. Letters outside the Latin script
 * survive the fold and are percent-encoded by the router; a byline that folds
 * to nothing at all (punctuation only) returns `''`, and callers must treat
 * that as "not linkable" rather than linking to `/author/`.
 */
export function authorSlug(name: string): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The identity key two spellings of one byline share.
 *
 * Same fold as `authorSlug`, and deliberately the same function rather than a
 * parallel one: if the key and the slug could disagree, two spellings could
 * merge in the directory and split in the URL. Measured live, 188 of 3,600
 * keys carry more than one raw spelling, so this collapse is doing real work
 * rather than guarding a theoretical case.
 */
export const authorKey = authorSlug

/**
 * Where a byline's page lives, or `null` when it may not have one.
 *
 * `newsroom` is the masthead the article was published by
 * (`article.publisher.name` — the organisation record, not the feed-source
 * label, which disagrees with itself on 24% of the corpus).
 *
 * Returns `null` when:
 * - the byline folds to an empty slug (nothing to address), or
 * - it is a desk byline and no newsroom resolved. A desk page that is not
 *   scoped is the exact false claim this module exists to prevent, and a
 *   byline rendered as plain text is a smaller loss than one rendered as a
 *   person who does not exist.
 */
export function authorHref(name: string | undefined, newsroom?: string): string | null {
  const slug = authorSlug(name ?? '')
  if (!slug) return null

  if (!isDeskByline(name ?? '')) return `/author/${slug}`

  const newsroomSlug = authorSlug(newsroom ?? '')
  return newsroomSlug ? `/author/${newsroomSlug}/${slug}` : null
}

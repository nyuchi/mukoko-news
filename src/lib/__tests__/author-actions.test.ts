import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDirectory, mockProfile, mockOrgMap, mockSources } = vi.hoisted(() => ({
  mockDirectory: vi.fn(),
  mockProfile: vi.fn(),
  mockOrgMap: vi.fn(),
  mockSources: vi.fn(),
}));

vi.mock('@/lib/mongodb/authors', () => ({
  getBylineDirectory: mockDirectory,
  getAuthorProfile: mockProfile,
}));
vi.mock('@/lib/mongodb/organizations', () => ({ getPublisherOrganizationMap: mockOrgMap }));
vi.mock('@/lib/mongodb/sources', () => ({ getSources: mockSources }));
// The cache wrapper is Next's; these tests are about the routing rules around it.
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));

import { getAuthorPageAction, type AuthorPageResult } from '@/lib/actions/authors';

/** Narrow to the served page, failing loudly rather than reading through a union. */
function ok(result: AuthorPageResult): { page: NonNullable<Extract<AuthorPageResult, { status: 'ok' }>['page']> } {
  if (result.status !== 'ok') throw new Error(`expected a served page, got ${result.status}`);
  return { page: result.page };
}

const PERSON = {
  slug: 'abubakar-ibrahim',
  name: 'Abubakar Ibrahim',
  variants: ['Abubakar Ibrahim', 'abubakar ibrahim'],
  articles: 323,
  newsroomIds: ['org-joy', 'org-bd'],
  desk: false,
};

const DESK = {
  slug: 'staff-reporter',
  name: 'Staff Reporter',
  variants: ['Staff Reporter'],
  articles: 198,
  newsroomIds: ['org-herald', 'org-nation'],
  desk: true,
};

const EMPTY_PROFILE = {
  ok: true,
  total: 0,
  sources: [],
  newsrooms: [],
  countries: [],
  topics: [],
  categories: [],
  tags: [],
  articles: [],
  windowDays: 365,
};

/**
 * The rules that decide which URLs exist.
 *
 * Each one is a rule about what the page may CLAIM, not a routing preference:
 * a desk byline served unscoped asserts that one journalist filed 198 articles
 * across ten mastheads in four countries, and a person served at a second,
 * newsroom-prefixed URL shows a different article count on each of two pages
 * about the same journalist.
 */
describe('getAuthorPageAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDirectory.mockResolvedValue({ ok: true, bylines: [PERSON, DESK] });
    mockProfile.mockResolvedValue(EMPTY_PROFILE);
    mockSources.mockResolvedValue([{ id: 'src-joy-news', name: 'Joy News' }]);
    mockOrgMap.mockResolvedValue(
      new Map([
        ['org-joy', { id: 'org-joy', name: 'Joy News', isVerified: false }],
        ['org-herald', { id: 'org-herald', name: 'The Herald', isVerified: true }],
        ['org-nation', { id: 'org-nation', name: 'Daily Nation', isVerified: false }],
      ])
    );
  });

  it('serves a person across the whole corpus', async () => {
    const { page } = ok(await getAuthorPageAction('abubakar-ibrahim'));
    expect(page.name).toBe('Abubakar Ibrahim');
    expect(page.desk).toBe(false);
    expect(page.newsroom).toBeUndefined();
    // Every spelling of the byline, and NO newsroom scope.
    expect(mockProfile).toHaveBeenCalledWith({
      variants: PERSON.variants,
      newsroomIds: undefined,
    });
  });

  it('scopes a desk byline to the newsroom named in the URL', async () => {
    const { page } = ok(await getAuthorPageAction('staff-reporter', 'the-herald'));
    expect(page.newsroom).toEqual({ id: 'org-herald', name: 'The Herald' });
    expect(mockProfile).toHaveBeenCalledWith({
      variants: DESK.variants,
      newsroomIds: ['org-herald'],
    });
  });

  it('refuses to serve a desk byline unscoped', async () => {
    await expect(getAuthorPageAction('staff-reporter')).resolves.toEqual({ status: 'not-found' });
    expect(mockProfile).not.toHaveBeenCalled();
  });

  it('refuses a newsroom the desk has never filed to', async () => {
    // Answering with the unscoped profile here is exactly the false attribution
    // the scoping exists to prevent, so this 404s instead.
    await expect(getAuthorPageAction('staff-reporter', 'the-guardian')).resolves.toEqual({ status: 'not-found' });
    expect(mockProfile).not.toHaveBeenCalled();
  });

  it('refuses to give a person a second, newsroom-prefixed address', async () => {
    await expect(getAuthorPageAction('abubakar-ibrahim', 'joy-news')).resolves.toEqual({ status: 'not-found' });
  });

  it('resolves the newsroom segment through the same fold as the link', async () => {
    // The byline link builds the segment with `authorSlug`; if this matched on
    // anything else, a masthead with an accent or an apostrophe would produce a
    // link that 404s and nothing would report it.
    mockOrgMap.mockResolvedValue(
      new Map([['org-herald', { id: 'org-herald', name: "L'Événement", isVerified: false }]])
    );

    const { page } = ok(await getAuthorPageAction('staff-reporter', 'l-evenement'));
    expect(page.newsroom?.name).toBe("L'Événement");
  });

  it('404s a byline the corpus does not carry', async () => {
    await expect(getAuthorPageAction('nobody-at-all')).resolves.toEqual({ status: 'not-found' });
  });

  it('does NOT 404 when the directory read failed — it reports unavailable', async () => {
    // ⚠️ This test used to assert the opposite, and it passed throughout the
    // outage it was written to prevent. A 404 is the platform stating that a
    // named journalist does not exist; we are only entitled to say that when we
    // read the directory and they were not in it. A failed read is `ok: false`,
    // and the caller owes the reader a 5xx, not a verdict.
    mockDirectory.mockResolvedValue({ ok: false, bylines: [] });
    await expect(getAuthorPageAction('abubakar-ibrahim')).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('still 404s a byline missing from a directory that read fine', async () => {
    mockDirectory.mockResolvedValue({ ok: true, bylines: [] });
    await expect(getAuthorPageAction('abubakar-ibrahim')).resolves.toEqual({
      status: 'not-found',
    });
  });

  it('labels sources and newsrooms from their own records', async () => {
    mockProfile.mockResolvedValue({
      ...EMPTY_PROFILE,
      sources: [
        { key: 'src-joy-news', count: 313 },
        { key: 'src-unknown', count: 2 },
      ],
      newsrooms: [{ key: 'org-joy', count: 313 }],
    });

    const { page } = ok(await getAuthorPageAction('abubakar-ibrahim'));
    expect(page.sources[0].label).toBe('Joy News');
    // An id the catalogue cannot name falls back to the id rather than to a
    // blank row — a nameless source is unresolved, not nonexistent.
    expect(page.sources[1].label).toBe('src-unknown');
    expect(page.newsrooms[0].label).toBe('Joy News');
  });

  it('merges tag spellings and points each at its own timeline', async () => {
    mockProfile.mockResolvedValue({
      ...EMPTY_PROFILE,
      tags: [
        { key: 'Ghana', count: 35 },
        { key: 'ghana', count: 5 },
        { key: 'World Cup', count: 47 },
      ],
    });

    const { page } = ok(await getAuthorPageAction('abubakar-ibrahim'));
    // "Ghana" and "ghana" are one tag: 40 articles under the spelling readers
    // actually see, ranked on the merged count rather than on either half.
    expect(page.tags).toEqual([
      { key: 'world cup', label: 'World Cup', count: 47, href: '/topic/world-cup' },
      { key: 'ghana', label: 'Ghana', count: 40, href: '/topic/ghana' },
    ]);
  });

  it('addresses a tag the way the timeline reads it back', async () => {
    // `/topic/[slug]` turns the slug into a name with `slug.replace(/-/g, ' ')`.
    // Folding diacritics here — as the byline slug does — would address
    // `/topic/cote-d-ivoire`, which matches nothing and renders as a story with
    // no coverage rather than as a broken link.
    mockProfile.mockResolvedValue({
      ...EMPTY_PROFILE,
      tags: [{ key: "Côte d'Ivoire", count: 9 }],
    });

    const { page } = ok(await getAuthorPageAction('abubakar-ibrahim'));
    expect(decodeURIComponent(page.tags[0].href)).toBe("/topic/côte-d'ivoire");
  });
});

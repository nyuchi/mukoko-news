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

import { getAuthorPageAction } from '@/lib/actions/authors';

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
    mockDirectory.mockResolvedValue([PERSON, DESK]);
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
    const page = await getAuthorPageAction('abubakar-ibrahim');
    expect(page?.name).toBe('Abubakar Ibrahim');
    expect(page?.desk).toBe(false);
    expect(page?.newsroom).toBeUndefined();
    // Every spelling of the byline, and NO newsroom scope.
    expect(mockProfile).toHaveBeenCalledWith({
      variants: PERSON.variants,
      newsroomIds: undefined,
    });
  });

  it('scopes a desk byline to the newsroom named in the URL', async () => {
    const page = await getAuthorPageAction('staff-reporter', 'the-herald');
    expect(page?.newsroom).toEqual({ id: 'org-herald', name: 'The Herald' });
    expect(mockProfile).toHaveBeenCalledWith({
      variants: DESK.variants,
      newsroomIds: ['org-herald'],
    });
  });

  it('refuses to serve a desk byline unscoped', async () => {
    await expect(getAuthorPageAction('staff-reporter')).resolves.toBeNull();
    expect(mockProfile).not.toHaveBeenCalled();
  });

  it('refuses a newsroom the desk has never filed to', async () => {
    // Answering with the unscoped profile here is exactly the false attribution
    // the scoping exists to prevent, so this 404s instead.
    await expect(getAuthorPageAction('staff-reporter', 'the-guardian')).resolves.toBeNull();
    expect(mockProfile).not.toHaveBeenCalled();
  });

  it('refuses to give a person a second, newsroom-prefixed address', async () => {
    await expect(getAuthorPageAction('abubakar-ibrahim', 'joy-news')).resolves.toBeNull();
  });

  it('resolves the newsroom segment through the same fold as the link', async () => {
    // The byline link builds the segment with `authorSlug`; if this matched on
    // anything else, a masthead with an accent or an apostrophe would produce a
    // link that 404s and nothing would report it.
    mockOrgMap.mockResolvedValue(
      new Map([['org-herald', { id: 'org-herald', name: "L'Événement", isVerified: false }]])
    );
    const page = await getAuthorPageAction('staff-reporter', 'l-evenement');
    expect(page?.newsroom?.name).toBe("L'Événement");
  });

  it('404s a byline the corpus does not carry', async () => {
    await expect(getAuthorPageAction('nobody-at-all')).resolves.toBeNull();
  });

  it('404s when the directory read failed', async () => {
    // A failed read returns an empty directory. Rendering a name above zero
    // articles would assert that a real person has published nothing, on the
    // strength of an outage.
    mockDirectory.mockResolvedValue([]);
    await expect(getAuthorPageAction('abubakar-ibrahim')).resolves.toBeNull();
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

    const page = await getAuthorPageAction('abubakar-ibrahim');
    expect(page?.sources[0].label).toBe('Joy News');
    // An id the catalogue cannot name falls back to the id rather than to a
    // blank row — a nameless source is unresolved, not nonexistent.
    expect(page?.sources[1].label).toBe('src-unknown');
    expect(page?.newsrooms[0].label).toBe('Joy News');
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

    const page = await getAuthorPageAction('abubakar-ibrahim');
    // "Ghana" and "ghana" are one tag: 40 articles under the spelling readers
    // actually see, ranked on the merged count rather than on either half.
    expect(page?.tags).toEqual([
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

    const page = await getAuthorPageAction('abubakar-ibrahim');
    expect(decodeURIComponent(page!.tags[0].href)).toBe("/topic/côte-d'ivoire");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const find = vi.fn();

vi.mock('@/lib/mongodb/client', () => ({
  QUERY_MAX_TIME_MS: 15000,
  getDb: vi.fn(async () => ({
    collection: () => ({ find }),
  })),
}));

import {
  getPublisherOrganization,
  getPublisherOrganizationMap,
  __resetPublisherOrganizationCache,
} from '@/lib/mongodb/organizations';

/** Shape the driver's fluent `find(...).limit(...).maxTimeMS(...).toArray()`. */
function returns(docs: unknown[] | Error) {
  find.mockReturnValue({
    limit: () => ({
      maxTimeMS: () => ({
        toArray: async () => {
          if (docs instanceof Error) throw docs;
          return docs;
        },
      }),
    }),
  });
}

const HERALD = {
  _id: 'org-herald-zw',
  name: 'The Herald',
  url: 'https://www.herald.co.zw',
  isVerified: false,
};

describe('publisher organisation resolution', () => {
  beforeEach(() => {
    __resetPublisherOrganizationCache();
    find.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves an article organisation id to the newsroom record', async () => {
    returns([HERALD]);
    const org = await getPublisherOrganization('org-herald-zw');
    expect(org).toEqual({
      id: 'org-herald-zw',
      name: 'The Herald',
      url: 'https://www.herald.co.zw',
      logo: undefined,
      isVerified: false,
    });
  });

  it('carries verification live off the organisation record', async () => {
    returns([{ ...HERALD, isVerified: true }]);
    expect((await getPublisherOrganization('org-herald-zw'))?.isVerified).toBe(true);
  });

  it('treats a missing isVerified as not verified, never as verified', async () => {
    returns([{ _id: 'org-x', name: 'X Daily' }]);
    expect((await getPublisherOrganization('org-x'))?.isVerified).toBe(false);
  });

  it('returns undefined for an unknown organisation rather than inventing one', async () => {
    returns([HERALD]);
    expect(await getPublisherOrganization('org-does-not-exist')).toBeUndefined();
  });

  it('returns undefined when the article carries no organisation id', async () => {
    returns([HERALD]);
    expect(await getPublisherOrganization(undefined)).toBeUndefined();
    expect(await getPublisherOrganization(null)).toBeUndefined();
    expect(await getPublisherOrganization('   ')).toBeUndefined();
  });

  it('drops a record with no name — an unnamed publisher attributes nothing', async () => {
    returns([{ _id: 'org-blank', name: '   ', url: 'https://example.com' }]);
    expect(await getPublisherOrganization('org-blank')).toBeUndefined();
  });

  it('accepts a logo as a bare string or as a Schema.org ImageObject', async () => {
    returns([
      { _id: 'a', name: 'A', logo: 'https://cdn.example.com/a.png' },
      { _id: 'b', name: 'B', logo: { url: 'https://cdn.example.com/b.png' } },
    ]);
    const map = await getPublisherOrganizationMap();
    expect(map.get('a')?.logo).toBe('https://cdn.example.com/a.png');
    expect(map.get('b')?.logo).toBe('https://cdn.example.com/b.png');
  });

  it('rejects an unsafe or relative publisher url and logo', async () => {
    returns([
      { _id: 'js', name: 'JS', url: 'javascript:alert(1)', logo: 'javascript:alert(1)' },
      // Root-relative would resolve against Mukoko's own origin — precisely the
      // confusion this change removes — so it is not a publisher URL.
      { _id: 'rel', name: 'Rel', url: '/newsroom', logo: '/logo.png' },
    ]);
    const map = await getPublisherOrganizationMap();
    expect(map.get('js')?.url).toBeUndefined();
    expect(map.get('js')?.logo).toBeUndefined();
    expect(map.get('rel')?.url).toBeUndefined();
    expect(map.get('rel')?.logo).toBeUndefined();
  });

  it('fails soft to an empty map instead of throwing at the article page', async () => {
    returns(new Error('atlas unreachable'));
    await expect(getPublisherOrganizationMap()).resolves.toEqual(new Map());
    expect(await getPublisherOrganization('org-herald-zw')).toBeUndefined();
  });

  it('reads the catalogue once for a burst of article views, not once per view', async () => {
    returns([HERALD]);
    await Promise.all([
      getPublisherOrganization('org-herald-zw'),
      getPublisherOrganization('org-herald-zw'),
    ]);
    await getPublisherOrganization('org-herald-zw');
    expect(find).toHaveBeenCalledTimes(1);
  });
});

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

// The value of resolving through the organisation is that verification and
// identity have exactly ONE instance. A denormalised copy on 63k articles would
// keep a revoked verification true wherever it had already been stamped, so the
// absence of any write is the property under test, not an implementation detail.
describe('publisher attribution is resolved, never stored', () => {
  it('the organisations module issues no writes', () => {
    const src = read('src/lib/mongodb/organizations.ts');
    expect(src).not.toMatch(/\.(updateOne|updateMany|insertOne|insertMany|bulkWrite|replaceOne|findOneAndUpdate|deleteOne|deleteMany)\(/);
  });

  it('the article mapper issues no writes either', () => {
    const src = read('src/lib/mongodb/articles.ts');
    expect(src).not.toMatch(/\.(updateOne|updateMany|insertOne|insertMany|bulkWrite|replaceOne|findOneAndUpdate)\(/);
  });

  it('the publisher reaches Article as a resolved option, not a stored column', () => {
    const src = read('src/lib/mongodb/articles.ts');
    // toArticle takes it from the caller; it is never read off the document.
    expect(src).toMatch(/publisher:\s*opts\.organization,/);
    expect(src).not.toMatch(/doc\.publisher/);
  });

  it('only the single-article path resolves an organisation', () => {
    const src = read('src/lib/mongodb/articles.ts');
    const calls = src.match(/getPublisherOrganization\(/g) ?? [];
    // One import-site call, inside resolveArticleDetail, shared by
    // getArticleById and getArticleBySlug. List reads deliberately do not.
    expect(calls).toHaveLength(1);
    expect(src).toMatch(/async function resolveArticleDetail\(/);
  });
});

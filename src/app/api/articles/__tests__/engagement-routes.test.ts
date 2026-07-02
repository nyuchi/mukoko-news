import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as likePost } from '@/app/api/articles/[id]/like/route';
import { POST as viewPost } from '@/app/api/articles/[id]/view/route';
import { POST as savePost } from '@/app/api/articles/[id]/save/route';
import { getDb } from '@/lib/mongodb/client';

// The routes hit MongoDB through getDb() — mock the client module so no
// connection is attempted. Rate limiting is exercised for real (the in-memory
// limiter from src/lib/rate-limit.ts), isolated per test via unique IPs.
vi.mock('@/lib/mongodb/client', () => ({
  getDb: vi.fn(),
}));

type MockCollection = {
  findOne: ReturnType<typeof vi.fn>;
  insertOne: ReturnType<typeof vi.fn>;
  deleteOne: ReturnType<typeof vi.fn>;
  updateOne: ReturnType<typeof vi.fn>;
  countDocuments: ReturnType<typeof vi.fn>;
};

function makeCollection(overrides: Partial<MockCollection> = {}): MockCollection {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    countDocuments: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function makeDb(collections: Record<string, MockCollection>) {
  return {
    collection: vi.fn((name: string) => {
      if (!collections[name]) collections[name] = makeCollection();
      return collections[name];
    }),
  };
}

function useDb(collections: Record<string, MockCollection>) {
  vi.mocked(getDb).mockResolvedValue(makeDb(collections) as unknown as never);
  return collections;
}

// The rate limiter's window map is module-global and shared across tests in
// this file — every test uses a fresh IP so windows never interfere.
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.${Math.floor(ipCounter / 65536) % 256}.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
}

function makeRequest(path: string, ip: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'x-forwarded-for': ip,
      ...(cookie ? { cookie } : {}),
    },
  });
}

function withParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.mocked(getDb).mockReset();
});

describe('POST /api/articles/[id]/like', () => {
  it('likes an article and sets the session cookie', async () => {
    const cols = useDb({
      articles: makeCollection({ findOne: vi.fn().mockResolvedValue({ _id: 'a-1' }) }),
      articleLikes: makeCollection({ countDocuments: vi.fn().mockResolvedValue(5) }),
    });

    const res = await likePost(makeRequest('/api/articles/a-1/like', nextIp()), withParams('a-1'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, liked: true, count: 5 });
    expect(cols.articleLikes.insertOne).toHaveBeenCalledOnce();
    expect(res.cookies.get('mukoko_session')?.value).toBeTruthy();
  });

  it('toggles the like off when the unique index reports a duplicate', async () => {
    const cols = useDb({
      articles: makeCollection({ findOne: vi.fn().mockResolvedValue({ _id: 'a-1' }) }),
      articleLikes: makeCollection({
        insertOne: vi.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 })),
        countDocuments: vi.fn().mockResolvedValue(4),
      }),
    });

    const res = await likePost(
      makeRequest('/api/articles/a-1/like', nextIp(), 'mukoko_session=sess-1'),
      withParams('a-1')
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, liked: false, count: 4 });
    expect(cols.articleLikes.deleteOne).toHaveBeenCalledWith({
      articleId: 'a-1',
      sessionId: 'sess-1',
    });
  });

  it('returns 404 when the article does not exist', async () => {
    useDb({ articles: makeCollection() }); // findOne resolves null

    const res = await likePost(
      makeRequest('/api/articles/missing/like', nextIp()),
      withParams('missing')
    );

    expect(res.status).toBe(404);
  });

  it('rejects an empty article id with 400 before touching Mongo', async () => {
    const res = await likePost(makeRequest('/api/articles//like', nextIp()), withParams(''));

    expect(res.status).toBe(400);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('rejects an article id longer than 128 chars with 400 before touching Mongo', async () => {
    const res = await likePost(
      makeRequest('/api/articles/x/like', nextIp()),
      withParams('x'.repeat(129))
    );

    expect(res.status).toBe(400);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('rate limits after 10 requests/minute per IP with a Retry-After header', async () => {
    useDb({
      articles: makeCollection({ findOne: vi.fn().mockResolvedValue({ _id: 'a-1' }) }),
    });
    const ip = nextIp();

    for (let i = 0; i < 10; i++) {
      const res = await likePost(makeRequest('/api/articles/a-1/like', ip), withParams('a-1'));
      expect(res.status).toBe(200);
    }

    const blocked = await likePost(makeRequest('/api/articles/a-1/like', ip), withParams('a-1'));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
    expect(await blocked.json()).toEqual({ error: 'Too many requests' });
    expect(getDb).toHaveBeenCalledTimes(10); // the blocked request never reached Mongo
  });

  it('tracks the rate limit per IP', async () => {
    useDb({
      articles: makeCollection({ findOne: vi.fn().mockResolvedValue({ _id: 'a-1' }) }),
    });
    const ipA = nextIp();
    const ipB = nextIp();

    for (let i = 0; i < 10; i++) {
      await likePost(makeRequest('/api/articles/a-1/like', ipA), withParams('a-1'));
    }
    const blockedA = await likePost(makeRequest('/api/articles/a-1/like', ipA), withParams('a-1'));
    expect(blockedA.status).toBe(429);

    const allowedB = await likePost(makeRequest('/api/articles/a-1/like', ipB), withParams('a-1'));
    expect(allowedB.status).toBe(200);
  });
});

describe('POST /api/articles/[id]/view', () => {
  it('records a view and returns the updated count', async () => {
    const articles = makeCollection({
      findOne: vi
        .fn()
        .mockResolvedValueOnce({ _id: 'a-2', viewsCount: 7 }) // existence check
        .mockResolvedValueOnce({ viewsCount: 8 }), // post-increment read
    });
    const cols = useDb({ articles, articleViews: makeCollection() });

    const res = await viewPost(makeRequest('/api/articles/a-2/view', nextIp()), withParams('a-2'));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, views: 8 });
    expect(cols.articleViews.insertOne).toHaveBeenCalledOnce();
    expect(articles.updateOne).toHaveBeenCalledOnce();
  });

  it('does not increment on a duplicate same-day view', async () => {
    const articles = makeCollection({
      findOne: vi
        .fn()
        .mockResolvedValueOnce({ _id: 'a-2', viewsCount: 7 })
        .mockResolvedValueOnce({ viewsCount: 7 }),
    });
    useDb({
      articles,
      articleViews: makeCollection({
        insertOne: vi.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 })),
      }),
    });

    const res = await viewPost(
      makeRequest('/api/articles/a-2/view', nextIp(), 'mukoko_session=sess-2'),
      withParams('a-2')
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, views: 7 });
    expect(articles.updateOne).not.toHaveBeenCalled();
  });

  it('returns 404 when the article does not exist', async () => {
    useDb({ articles: makeCollection() });

    const res = await viewPost(
      makeRequest('/api/articles/missing/view', nextIp()),
      withParams('missing')
    );

    expect(res.status).toBe(404);
  });

  it('rejects an invalid article id with 400 before touching Mongo', async () => {
    const empty = await viewPost(makeRequest('/api/articles//view', nextIp()), withParams(''));
    expect(empty.status).toBe(400);

    const tooLong = await viewPost(
      makeRequest('/api/articles/x/view', nextIp()),
      withParams('x'.repeat(129))
    );
    expect(tooLong.status).toBe(400);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('rate limits after 60 requests/minute per IP with a Retry-After header', async () => {
    useDb({
      articles: makeCollection({
        findOne: vi.fn().mockResolvedValue({ _id: 'a-2', viewsCount: 1 }),
      }),
      articleViews: makeCollection(),
    });
    const ip = nextIp();

    for (let i = 0; i < 60; i++) {
      const res = await viewPost(makeRequest('/api/articles/a-2/view', ip), withParams('a-2'));
      expect(res.status).toBe(200);
    }

    const blocked = await viewPost(makeRequest('/api/articles/a-2/view', ip), withParams('a-2'));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
    expect(await blocked.json()).toEqual({ error: 'Too many requests' });
  });
});

describe('POST /api/articles/[id]/save', () => {
  it('saves an article when no prior save exists', async () => {
    const cols = useDb({ articleSaves: makeCollection() }); // findOne resolves null

    const res = await savePost(makeRequest('/api/articles/a-3/save', nextIp()), withParams('a-3'));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, saved: true });
    expect(cols.articleSaves.insertOne).toHaveBeenCalledOnce();
  });

  it('unsaves when a prior save exists', async () => {
    const cols = useDb({
      articleSaves: makeCollection({
        findOne: vi.fn().mockResolvedValue({ articleId: 'a-3', sessionId: 'sess-3' }),
      }),
    });

    const res = await savePost(
      makeRequest('/api/articles/a-3/save', nextIp(), 'mukoko_session=sess-3'),
      withParams('a-3')
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, saved: false });
    expect(cols.articleSaves.deleteOne).toHaveBeenCalledWith({
      articleId: 'a-3',
      sessionId: 'sess-3',
    });
  });

  it('rejects an invalid article id with 400 before touching Mongo', async () => {
    const empty = await savePost(makeRequest('/api/articles//save', nextIp()), withParams(''));
    expect(empty.status).toBe(400);

    const tooLong = await savePost(
      makeRequest('/api/articles/x/save', nextIp()),
      withParams('x'.repeat(129))
    );
    expect(tooLong.status).toBe(400);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('rate limits after 10 requests/minute per IP with a Retry-After header', async () => {
    useDb({ articleSaves: makeCollection() });
    const ip = nextIp();

    for (let i = 0; i < 10; i++) {
      const res = await savePost(makeRequest('/api/articles/a-3/save', ip), withParams('a-3'));
      expect(res.status).toBe(200);
    }

    const blocked = await savePost(makeRequest('/api/articles/a-3/save', ip), withParams('a-3'));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
    expect(await blocked.json()).toEqual({ error: 'Too many requests' });
  });

  it('keeps rate-limit buckets separate per endpoint for the same IP', async () => {
    useDb({
      articles: makeCollection({ findOne: vi.fn().mockResolvedValue({ _id: 'a-4' }) }),
      articleSaves: makeCollection(),
      articleLikes: makeCollection({ countDocuments: vi.fn().mockResolvedValue(1) }),
    });
    const ip = nextIp();

    // Exhaust the save bucket for this IP…
    for (let i = 0; i < 10; i++) {
      await savePost(makeRequest('/api/articles/a-4/save', ip), withParams('a-4'));
    }
    expect(
      (await savePost(makeRequest('/api/articles/a-4/save', ip), withParams('a-4'))).status
    ).toBe(429);

    // …like from the same IP is still allowed (its own bucket).
    expect(
      (await likePost(makeRequest('/api/articles/a-4/like', ip), withParams('a-4'))).status
    ).toBe(200);
  });
});

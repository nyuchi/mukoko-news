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

// ⚠️ Likes and saves are ACCOUNT-ONLY as of the reader tier model, so this
// suite has to say who is asking — and it must say so explicitly rather than
// leaning on a default.
//
// Before the gate there was no authkit mock here at all: `withAuth()` threw,
// `resolveEngagementSubject` caught it and returned an anonymous subject, and
// every test ran as a stranger without ever saying so. That is precisely the
// shape of an accidentally-passing suite — the identity under test was a side
// effect of an unmocked module rather than a decision — so it is pinned now,
// and `signedOut()` is what the denial tests use.
const mockWithAuth = vi.fn();
vi.mock('@workos-inc/authkit-nextjs', () => ({
  withAuth: () => mockWithAuth(),
}));

function signedIn(id = 'user_1') {
  mockWithAuth.mockResolvedValue({ user: { id } });
}

function signedOut() {
  mockWithAuth.mockResolvedValue({ user: null });
}

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
  mockWithAuth.mockReset();
  // Signed in unless a test says otherwise: these routes now require it, so
  // the interesting default is the one where the work actually happens.
  signedIn();
});

describe('POST /api/articles/[id]/like', () => {
  it('likes an article under the signed-in user key', async () => {
    const cols = useDb({
      articles: makeCollection({ findOne: vi.fn().mockResolvedValue({ _id: 'a-1' }) }),
      articleLikes: makeCollection({ countDocuments: vi.fn().mockResolvedValue(5) }),
    });

    const res = await likePost(makeRequest('/api/articles/a-1/like', nextIp()), withParams('a-1'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, liked: true, count: 5 });
    expect(cols.articleLikes.insertOne).toHaveBeenCalledOnce();
    // The like is stored against `user:<id>`, which is what makes it follow the
    // account across devices.
    expect(cols.articleLikes.insertOne.mock.calls[0][0]).toMatchObject({
      sessionId: 'user:user_1',
    });
    // No anonymous cookie is minted any more: a caller without a session never
    // reaches this code, so minting one would be dead state on a real user.
    expect(res.cookies.get('mukoko_session')).toBeUndefined();
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
    // The cookie is still SENT, but the user key wins — that is what stops a
    // signed-in reader's like being filed under whatever browser they used.
    expect(cols.articleLikes.deleteOne).toHaveBeenCalledWith({
      articleId: 'a-1',
      sessionId: 'user:user_1',
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
        findOne: vi.fn().mockResolvedValue({ articleId: 'a-3', sessionId: 'user:user_1' }),
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
      sessionId: 'user:user_1',
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

describe('interactions are account-only', () => {
  it('denies an anonymous like with 401 and writes nothing', async () => {
    signedOut();
    const cols = useDb({
      articles: makeCollection({ findOne: vi.fn().mockResolvedValue({ _id: 'a-9' }) }),
      articleLikes: makeCollection(),
    });

    const res = await likePost(makeRequest('/api/articles/a-9/like', nextIp()), withParams('a-9'));

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ success: false, requiresAuth: true });
    // The gate is in FRONT of the database, not behind it. A 401 that still
    // read the article would hand an anonymous caller a free existence oracle
    // and spend a round trip on a request we were always going to refuse.
    expect(getDb).not.toHaveBeenCalled();
    expect(cols.articleLikes.insertOne).not.toHaveBeenCalled();
  });

  it('denies an anonymous save with 401 and writes nothing', async () => {
    signedOut();
    const cols = useDb({ articleSaves: makeCollection() });

    const res = await savePost(makeRequest('/api/articles/a-9/save', nextIp()), withParams('a-9'));

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ success: false, requiresAuth: true });
    expect(cols.articleSaves.insertOne).not.toHaveBeenCalled();
  });

  it('answers requiresAuth so the client can send the reader to sign in', async () => {
    signedOut();
    useDb({});
    const res = await likePost(makeRequest('/api/articles/a-9/like', nextIp()), withParams('a-9'));

    // Not a bare 403. The difference is what the UI does with it: `requiresAuth`
    // means "offer the account", while an unexplained refusal means "something
    // went wrong" — and nothing went wrong.
    const body = await res.json();
    expect(body.requiresAuth).toBe(true);
    expect(typeof body.message).toBe('string');
  });

  it('gates BEFORE validating the article id — which is what proves it is the gate', async () => {
    // ⚠️ This test exists because the four around it could not tell the guard
    // apart from the orphan-subject check further down the route. Both answer
    // 401 for an anonymous caller, so disabling the guard entirely left the
    // whole suite green — a set of tests that certified a gate they were not
    // touching.
    //
    // Ordering is the discriminator. The guard runs above the id validation, so
    // an anonymous caller with a plainly invalid id gets 401 and not 400: only
    // the guard can produce that answer, because the orphan check sits below
    // the validation that would have returned 400 first.
    signedOut();

    const res = await likePost(makeRequest('/api/articles//like', nextIp()), withParams(''));

    expect(res.status).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('FAILS CLOSED when the session cannot be read at all', async () => {
    // An auth outage denying a like is small, visible and self-correcting. An
    // auth outage silently opening an account-only capability is none of those,
    // and nothing in the logs would ever show it.
    mockWithAuth.mockRejectedValue(new Error('workos unreachable'));
    useDb({});

    // An invalid id for the same reason as the test above: 401 here can only
    // have come from the guard, since the id check would otherwise answer 400.
    const res = await likePost(makeRequest('/api/articles//like', nextIp()), withParams(''));

    expect(res.status).toBe(401);
  });

  it('does NOT gate views — a read is not an interaction', async () => {
    // The distinction the whole tier model rests on. Views fire on every article
    // load including a crawler's, and gating them would both break the counter
    // and wall the traffic this product runs on.
    signedOut();
    useDb({
      articles: makeCollection({
        findOne: vi.fn().mockResolvedValue({ _id: 'a-10', viewsCount: 3 }),
      }),
      articleViews: makeCollection(),
    });

    const res = await viewPost(makeRequest('/api/articles/a-10/view', nextIp()), withParams('a-10'));

    expect(res.status).toBe(200);
  });
});

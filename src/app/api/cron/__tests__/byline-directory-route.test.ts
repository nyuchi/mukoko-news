import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGetBylineDirectory, mockPublish } = vi.hoisted(() => ({
  mockGetBylineDirectory: vi.fn(),
  mockPublish: vi.fn(),
}));

vi.mock('@/lib/mongodb/authors', () => ({ getBylineDirectory: mockGetBylineDirectory }));
vi.mock('@/lib/mongodb/byline-directory', () => ({ publishBylineDirectory: mockPublish }));

import { NextRequest } from 'next/server';

import { GET, maxDuration } from '../byline-directory/route';

const SECRET = 'a-very-secret-value';

function request(authorization?: string) {
  return new NextRequest('https://news.mukoko.com/api/cron/byline-directory', {
    headers: authorization ? { authorization } : {},
  });
}

/**
 * The rebuild endpoint. It runs the platform's slowest query and WRITES, so the
 * two things under test are that it cannot be fired by a stranger and that it
 * never destroys a working directory.
 */
describe('/api/cron/byline-directory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    mockGetBylineDirectory.mockResolvedValue({ ok: true, bylines: [{ slug: 'a' }] });
    mockPublish.mockResolvedValue({
      published: true,
      written: 1,
      removed: 0,
      generation: '2026-09-19T00:00:00.000Z',
    });
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('rebuilds and publishes for an authorised caller', async () => {
    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ published: true, bylines: 1 });
    expect(mockPublish).toHaveBeenCalledWith([{ slug: 'a' }], true);
  });

  it('rejects a caller with no credential, without running the query', async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    // The point is not the status code — it is that an 11-second corpus scan
    // is not reachable by an unauthenticated request. That is a denial-of-
    // service knob pointed at the whole cluster, not just at /author.
    expect(mockGetBylineDirectory).not.toHaveBeenCalled();
  });

  it('rejects a wrong credential', async () => {
    const response = await GET(request('Bearer not-the-secret'));

    expect(response.status).toBe(401);
    expect(mockGetBylineDirectory).not.toHaveBeenCalled();
  });

  it('is DISABLED rather than open when the secret is unset', async () => {
    // The dangerous failure mode would be treating "no secret configured" as
    // "no authentication required". A misconfigured deployment answers 503.
    delete process.env.CRON_SECRET;

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(503);
    expect(mockGetBylineDirectory).not.toHaveBeenCalled();
  });

  it('reports a refused build as an error, not a cheerful no-op', async () => {
    // A cron that has quietly stopped producing a directory must be visible in
    // the platform log. A 200 over `published: false` would not be.
    mockPublish.mockResolvedValue({
      published: false,
      written: 0,
      removed: 0,
      generation: 'g',
      reason: 'empty-build',
    });

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(409);
  });

  it('reports a failed corpus read as 503', async () => {
    mockGetBylineDirectory.mockResolvedValue({ ok: false, bylines: [] });
    mockPublish.mockResolvedValue({
      published: false,
      written: 0,
      removed: 0,
      generation: 'g',
      reason: 'source-unavailable',
    });

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(503);
    // The `ok` flag must reach the publisher: it is the only thing that tells a
    // failed read apart from a corpus with no bylines in it.
    expect(mockPublish).toHaveBeenCalledWith([], false);
  });

  it('budgets the function for the build it exists to run', async () => {
    // The build measured 11s warm and is bounded at QUERY_MAX_TIME_MS (15s),
    // with the write after it. A platform timeout below that would kill the
    // rebuild halfway and leave the cron permanently failing.
    expect(maxDuration).toBeGreaterThanOrEqual(30);
  });
});

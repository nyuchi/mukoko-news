import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setSourceActive, moderateArticle } from '../admin/gateway';

// Admin gateway Server Actions are also a public RPC surface (the gateway
// re-verifies RBAC, but inputs should be bounded before leaving the app).

vi.mock('@workos-inc/authkit-nextjs', () => ({
  withAuth: vi.fn(async () => ({ accessToken: 'test-token' })),
}));

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('setSourceActive input validation', () => {
  it('calls the gateway with a valid id', async () => {
    const result = await setSourceActive('source_123', true);
    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/sources/source_123'),
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('rejects an over-length id without calling the gateway', async () => {
    const result = await setSourceActive('x'.repeat(500), true);
    expect(result).toEqual({ ok: false, status: 400, error: 'Invalid source id' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects an empty id', async () => {
    const result = await setSourceActive('', true);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('coerces a non-boolean isActive to false', async () => {
    await setSourceActive('source_123', 'yes' as unknown as boolean);
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ isActive: false });
  });
});

describe('moderateArticle input validation', () => {
  it('calls the gateway with valid inputs', async () => {
    const result = await moderateArticle('article_1', 'flagged', 'spam');
    expect(result.ok).toBe(true);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/moderator/articles/article_1');
    expect(JSON.parse(init.body as string)).toEqual({
      moderationStatus: 'flagged',
      reason: 'spam',
    });
  });

  it('rejects an over-length id without calling the gateway', async () => {
    const result = await moderateArticle('a'.repeat(1000), 'removed');
    expect(result).toEqual({ ok: false, status: 400, error: 'Invalid article id' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects an unknown moderation status', async () => {
    const result = await moderateArticle(
      'article_1',
      'nuked' as unknown as 'removed'
    );
    expect(result).toEqual({ ok: false, status: 400, error: 'Invalid moderation status' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('drops an over-length reason but still moderates', async () => {
    const result = await moderateArticle('article_1', 'removed', 'r'.repeat(5000));
    expect(result.ok).toBe(true);
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ moderationStatus: 'removed' });
  });
});

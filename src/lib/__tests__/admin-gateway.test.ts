import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withAuth } from '@workos-inc/authkit-nextjs';
import {
  setSourceActive,
  moderateArticle,
  approvePublisherClaim,
  rejectPublisherClaim,
  drainEnrichmentBacklog,
} from '../admin/gateway';

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

describe('publisher claim adjudication', () => {
  it('approves a claim through the gateway, which is the only writer of the trust boosts', async () => {
    // Tier-2 verification verifies the org, stacks two trust boosts onto its
    // feedSources.trustScore, and audits each change in sourceScoreHistory. The
    // frontend reads MongoDB directly everywhere else; writing this one itself
    // would bypass both the audit trail and the Worker's own RBAC re-check.
    const result = await approvePublisherClaim('claim_1', 'Domain verified by email');
    expect(result.ok).toBe(true);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/admin/publisher-claims/claim_1/approve');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ reviewNotes: 'Domain verified by email' });
  });

  it('rejects an invalid claim id before it reaches the gateway', async () => {
    const result = await approvePublisherClaim('c'.repeat(500));
    expect(result).toEqual({ ok: false, status: 400, error: 'Invalid claim id' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('requires a reason to reject a claim', async () => {
    // A rejection with no reason leaves the publisher with no way to fix their
    // claim and leaves staff with no record of why it was refused. Whitespace
    // is not a reason.
    const result = await rejectPublisherClaim('claim_1', '   ');
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'A rejection reason is required.',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends a rejection with its reason', async () => {
    const result = await rejectPublisherClaim('claim_1', 'Domain not controlled by claimant');
    expect(result.ok).toBe(true);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/admin/publisher-claims/claim_1/reject');
    expect(JSON.parse(init.body as string)).toEqual({
      rejectionReason: 'Domain not controlled by claimant',
    });
  });

  it('validates the id on the reject path too', async () => {
    const result = await rejectPublisherClaim('', 'a reason');
    expect(result.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('drainEnrichmentBacklog', () => {
  it('takes no arguments and posts to the admin route', async () => {
    // The point of this route is that it is a ROLE, not a shared service
    // secret: it inherits the console's WorkOS platform-org check and keeps
    // ENRICHMENT_API_TOKEN server-side. There is no parameter for a caller to
    // get wrong, and none to validate — adding one would be the regression.
    mockFetch.mockResolvedValue(new Response('{"queued":true}', { status: 202 }));
    const result = await drainEnrichmentBacklog();
    expect(result).toMatchObject({ ok: true, status: 202, data: { queued: true } });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/admin/enrich/backlog');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('surfaces a 503 as a distinct failure, not as "drain started"', async () => {
    // 503 means the gateway is not wired up (ENRICHMENT_WORKER_URL unset, or
    // the host pin rejected the URL). An admin pressing a button needs to tell
    // that apart from a drain that actually began.
    mockFetch.mockResolvedValue(new Response('{"error":"not configured"}', { status: 503 }));
    const result = await drainEnrichmentBacklog();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(result.data).toEqual({ error: 'not configured' });
  });
});

describe('transport failures', () => {
  it('reports "not authenticated" without calling the gateway when there is no token', async () => {
    // The Worker re-verifies RBAC, but a call with no bearer arrives anonymous
    // and is refused with a 401 the UI would show as a gateway fault rather
    // than as "your session expired".
    vi.mocked(withAuth).mockResolvedValueOnce({ accessToken: undefined } as never);
    const result = await setSourceActive('source_1', true);
    expect(result).toEqual({ ok: false, status: 401, error: 'Not authenticated' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('turns an unreachable gateway into a typed result, not an unhandled rejection', async () => {
    // These are Server Actions: a throw crosses the RSC boundary as an opaque
    // "an error occurred in the Server Components render", leaving the admin UI
    // no way to say what failed.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockRejectedValue(new TypeError('fetch failed'));
    const result = await setSourceActive('source_1', true);
    expect(result).toEqual({ ok: false, status: 0, error: 'Could not reach the gateway.' });
    spy.mockRestore();
  });

  it('handles an empty response body without trying to parse it', async () => {
    // A 204 carries no body, and JSON.parse('') throws — which would turn a
    // successful mutation into "Could not reach the gateway."
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const result = await setSourceActive('source_1', false);
    expect(result).toEqual({ ok: true, status: 204, data: undefined });
  });
});

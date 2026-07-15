import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkRateLimit, getRequestIp } from '../rate-limit';

// Without Upstash env vars the limiter is the original per-instance in-memory
// sliding window; with them it becomes a global fixed window over the Upstash
// REST API, failing OPEN (falling back to memory) on any Redis problem.

describe('checkRateLimit (in-memory fallback)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests within the limit', async () => {
    // Use unique key per test to avoid shared-state interference
    const key = 'rl-allow-3';
    await expect(checkRateLimit(key, 3, 60_000)).resolves.toBe(true);
    await expect(checkRateLimit(key, 3, 60_000)).resolves.toBe(true);
    await expect(checkRateLimit(key, 3, 60_000)).resolves.toBe(true);
  });

  it('blocks the request once the limit is reached', async () => {
    const key = 'rl-block-after-2';
    await checkRateLimit(key, 2, 60_000);
    await checkRateLimit(key, 2, 60_000);
    await expect(checkRateLimit(key, 2, 60_000)).resolves.toBe(false);
  });

  it('allows again after the sliding window expires', async () => {
    const key = 'rl-window-expire';
    await checkRateLimit(key, 1, 1_000);
    await expect(checkRateLimit(key, 1, 1_000)).resolves.toBe(false); // blocked

    vi.advanceTimersByTime(1_001); // advance past the 1 s window
    await expect(checkRateLimit(key, 1, 1_000)).resolves.toBe(true); // allowed again
  });

  it('tracks different keys independently', async () => {
    const keyA = 'rl-key-a-independent';
    const keyB = 'rl-key-b-independent';
    await checkRateLimit(keyA, 1, 60_000); // exhaust keyA
    await expect(checkRateLimit(keyA, 1, 60_000)).resolves.toBe(false);
    await expect(checkRateLimit(keyB, 1, 60_000)).resolves.toBe(true); // keyB unaffected
  });

  it('counts only calls inside the active window', async () => {
    const key = 'rl-partial-window';
    await checkRateLimit(key, 2, 1_000); // call at t=0
    vi.advanceTimersByTime(500);
    await checkRateLimit(key, 2, 1_000); // call at t=500ms — both in window

    vi.advanceTimersByTime(600); // now at t=1100ms: t=0 call expired
    await expect(checkRateLimit(key, 2, 1_000)).resolves.toBe(true); // only 1 active call
  });
});

describe('checkRateLimit (Upstash REST backend)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.unstubAllGlobals();
  });

  function upstashResponse(count: number) {
    return {
      ok: true,
      json: async () => [{ result: count }, { result: 1 }],
    } as Response;
  }

  it('allows when the Redis count is within the limit', async () => {
    fetchMock.mockResolvedValue(upstashResponse(3));
    await expect(checkRateLimit('rl-redis-ok', 5, 60_000)).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://fake.upstash.io/pipeline');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer test-token',
    });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body[0][0]).toBe('INCR');
    expect(body[1][0]).toBe('PEXPIRE');
  });

  it('blocks when the Redis count exceeds the limit', async () => {
    fetchMock.mockResolvedValue(upstashResponse(6));
    await expect(checkRateLimit('rl-redis-block', 5, 60_000)).resolves.toBe(false);
  });

  it('fails open to the in-memory limiter when the request errors', async () => {
    fetchMock.mockRejectedValue(new Error('redis down'));
    await expect(checkRateLimit('rl-redis-down', 5, 60_000)).resolves.toBe(true);
  });

  it('fails open when Upstash returns a non-OK status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(checkRateLimit('rl-redis-500', 5, 60_000)).resolves.toBe(true);
  });

  it('fails open on an unexpected payload shape', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ nope: true }) } as Response);
    await expect(checkRateLimit('rl-redis-shape', 5, 60_000)).resolves.toBe(true);
  });
});

describe('getRequestIp', () => {
  it('extracts the first IP from x-forwarded-for', () => {
    const req = new Request('http://localhost/', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    });
    expect(getRequestIp(req)).toBe('1.2.3.4');
  });

  it('trims whitespace around the extracted IP', () => {
    const req = new Request('http://localhost/', {
      headers: { 'x-forwarded-for': '  9.10.11.12  , 13.14.15.16' },
    });
    expect(getRequestIp(req)).toBe('9.10.11.12');
  });

  it('returns a single IP when there is no comma', () => {
    const req = new Request('http://localhost/', {
      headers: { 'x-forwarded-for': '203.0.113.42' },
    });
    expect(getRequestIp(req)).toBe('203.0.113.42');
  });

  it('returns "unknown" when the header is absent', () => {
    const req = new Request('http://localhost/');
    expect(getRequestIp(req)).toBe('unknown');
  });

  it('returns "unknown" when the header is an empty string', () => {
    const req = new Request('http://localhost/', {
      headers: { 'x-forwarded-for': '' },
    });
    expect(getRequestIp(req)).toBe('unknown');
  });
});

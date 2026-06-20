import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { triggerFeedCollection } from '../actions/refresh';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  vi.stubEnv('FLY_WORKER_URL', '');
  vi.stubEnv('FLY_TRIGGER_TOKEN', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('triggerFeedCollection', () => {
  it('does nothing when FLY_WORKER_URL is not set', async () => {
    vi.stubEnv('FLY_TRIGGER_TOKEN', 'tok');
    await triggerFeedCollection();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does nothing when FLY_TRIGGER_TOKEN is not set', async () => {
    vi.stubEnv('FLY_WORKER_URL', 'http://fly-worker.example');
    await triggerFeedCollection();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does nothing when both env vars are missing', async () => {
    await triggerFeedCollection();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('POSTs to the correct trigger URL with Bearer token', async () => {
    vi.stubEnv('FLY_WORKER_URL', 'https://news-ingestion.fly-worker.nyuchi.dev');
    vi.stubEnv('FLY_TRIGGER_TOKEN', 'bf61a6184dbe6da192ffa0706e7666ec');
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 202 }));

    await triggerFeedCollection();

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://news-ingestion.fly-worker.nyuchi.dev/trigger/collect',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer bf61a6184dbe6da192ffa0706e7666ec' },
      }
    );
  });

  it('swallows network errors silently (fire-and-forget)', async () => {
    vi.stubEnv('FLY_WORKER_URL', 'https://news-ingestion.fly-worker.nyuchi.dev');
    vi.stubEnv('FLY_TRIGGER_TOKEN', 'tok');
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(triggerFeedCollection()).resolves.toBeUndefined();
  });

  it('swallows non-2xx responses silently', async () => {
    vi.stubEnv('FLY_WORKER_URL', 'https://news-ingestion.fly-worker.nyuchi.dev');
    vi.stubEnv('FLY_TRIGGER_TOKEN', 'tok');
    mockFetch.mockResolvedValueOnce(new Response('Rate limit exceeded', { status: 429 }));

    await expect(triggerFeedCollection()).resolves.toBeUndefined();
  });
});

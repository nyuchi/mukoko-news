import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkRateLimit, getRequestIp } from '../rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests within the limit', () => {
    // Use unique key per test to avoid shared-state interference
    const key = 'rl-allow-3';
    expect(checkRateLimit(key, 3, 60_000)).toBe(true);
    expect(checkRateLimit(key, 3, 60_000)).toBe(true);
    expect(checkRateLimit(key, 3, 60_000)).toBe(true);
  });

  it('blocks the request once the limit is reached', () => {
    const key = 'rl-block-after-2';
    checkRateLimit(key, 2, 60_000);
    checkRateLimit(key, 2, 60_000);
    expect(checkRateLimit(key, 2, 60_000)).toBe(false);
  });

  it('allows again after the sliding window expires', () => {
    const key = 'rl-window-expire';
    checkRateLimit(key, 1, 1_000);
    expect(checkRateLimit(key, 1, 1_000)).toBe(false); // blocked

    vi.advanceTimersByTime(1_001); // advance past the 1 s window
    expect(checkRateLimit(key, 1, 1_000)).toBe(true);  // allowed again
  });

  it('tracks different keys independently', () => {
    const keyA = 'rl-key-a-independent';
    const keyB = 'rl-key-b-independent';
    checkRateLimit(keyA, 1, 60_000); // exhaust keyA
    expect(checkRateLimit(keyA, 1, 60_000)).toBe(false);
    expect(checkRateLimit(keyB, 1, 60_000)).toBe(true); // keyB is unaffected
  });

  it('counts only calls inside the active window', () => {
    const key = 'rl-partial-window';
    checkRateLimit(key, 2, 1_000);      // call at t=0
    vi.advanceTimersByTime(500);
    checkRateLimit(key, 2, 1_000);      // call at t=500ms — both in window

    vi.advanceTimersByTime(600);        // now at t=1100ms: t=0 call expired
    expect(checkRateLimit(key, 2, 1_000)).toBe(true); // only 1 active call remains
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

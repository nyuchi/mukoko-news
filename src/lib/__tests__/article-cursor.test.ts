import { describe, it, expect } from 'vitest';
import { encodeArticleCursor, decodeArticleCursor } from '../mongodb/articles';
import type { Article } from '../api';

/**
 * The keyset cursor replaced offset pagination on the feed. Offset paging cost
 * more the deeper a reader scrolled and duplicated or dropped articles whenever
 * new ones landed mid-scroll; a cursor is flat-cost and stable under insertion.
 *
 * It is also a value that arrives from the network, so it is parsed defensively:
 * these tests pin both halves of that contract.
 */

const article = (id: string, publishedAt: string) =>
  ({ id, published_at: publishedAt }) as Article;

describe('article keyset cursor', () => {
  it('round-trips a position', () => {
    const encoded = encodeArticleCursor(article('abc123', '2026-09-10T00:00:00.000Z'));
    expect(decodeArticleCursor(encoded)).toEqual({
      publishedAt: '2026-09-10T00:00:00.000Z',
      id: 'abc123',
    });
  });

  it('round-trips an id containing the field separator', () => {
    // The separator is a pipe, so an id containing one must not truncate the id.
    const encoded = encodeArticleCursor(article('a|b|c', '2026-09-10T00:00:00.000Z'));
    expect(decodeArticleCursor(encoded)?.id).toBe('a|b|c');
  });

  it('is url-safe', () => {
    // base64url, so the cursor survives a query string without escaping.
    const encoded = encodeArticleCursor(article('id-with-accents-ee', '2026-09-10T00:00:00.000Z'));
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeArticleCursor(encoded)?.id).toBe('id-with-accents-ee');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', ''],
    ['base64 without a separator', Buffer.from('nopipe', 'utf8').toString('base64url')],
    [
      'base64 with an empty id',
      Buffer.from('2026-09-10T00:00:00.000Z|', 'utf8').toString('base64url'),
    ],
    ['base64 with an unparseable date', Buffer.from('not-a-date|abc', 'utf8').toString('base64url')],
  ])('rejects %s', (_label, input) => {
    expect(decodeArticleCursor(input as string | null | undefined)).toBeNull();
  });

  it('rejects an over-long cursor without decoding it', () => {
    // A cursor is a position, not a payload. Bounding the length stops a caller
    // spending server memory on a megabyte of base64 before it is rejected.
    expect(decodeArticleCursor('a'.repeat(513))).toBeNull();
  });

  it('never throws on hostile input', () => {
    for (const bad of ['%%%', ' ', 'AAAA'.repeat(50), '../../etc/passwd']) {
      expect(() => decodeArticleCursor(bad)).not.toThrow();
    }
  });
});

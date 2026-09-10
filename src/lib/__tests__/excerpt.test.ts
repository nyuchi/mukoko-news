import { describe, it, expect } from 'vitest';
import { toExcerpt, articleExcerpt, ARTICLE_EXCERPT_MAX_CHARS } from '../excerpt';

/** A body long enough that any excerpt of it must have been truncated. */
const LONG_BODY = Array.from(
  { length: 200 },
  (_, i) => `sentence ${i} of the publisher's reporting`
).join('. ');

describe('toExcerpt', () => {
  it('bounds output at ARTICLE_EXCERPT_MAX_CHARS', () => {
    const out = toExcerpt(LONG_BODY);
    expect(out).toBeDefined();
    expect(out!.length).toBeLessThanOrEqual(ARTICLE_EXCERPT_MAX_CHARS + 1); // +1 for the ellipsis
  });

  it('is a strict prefix of the source text — it never paraphrases or reorders', () => {
    const out = toExcerpt(LONG_BODY)!;
    expect(LONG_BODY.startsWith(out.replace(/…$/, ''))).toBe(true);
  });

  it('ends on a word boundary and marks the truncation', () => {
    const out = toExcerpt(LONG_BODY)!;
    expect(out.endsWith('…')).toBe(true);
    // No half-word before the ellipsis: the character preceding it must be the
    // end of a word that also appears whole in the source.
    const lastWord = out.replace(/…$/, '').split(' ').pop()!;
    expect(LONG_BODY.split(/\s+/)).toContain(lastWord);
  });

  it('leaves short text alone, with no ellipsis', () => {
    expect(toExcerpt('A short lede.')).toBe('A short lede.');
  });

  it('collapses whitespace so a multi-paragraph body flattens to one line', () => {
    expect(toExcerpt('First para.\n\n  Second   para.')).toBe('First para. Second para.');
  });

  it('returns undefined for empty or missing text so the caller can omit the field', () => {
    expect(toExcerpt(undefined)).toBeUndefined();
    expect(toExcerpt(null)).toBeUndefined();
    expect(toExcerpt('   \n ')).toBeUndefined();
  });

  it('still returns text when the input has no spaces to break on', () => {
    // A single very long token (a URL, or a script with no word spacing) must
    // not collapse the excerpt to just an ellipsis.
    const out = toExcerpt('x'.repeat(1000))!;
    expect(out.length).toBeGreaterThan(ARTICLE_EXCERPT_MAX_CHARS * 0.9);
  });

  it('does not leave dangling punctuation before the ellipsis', () => {
    const out = toExcerpt(`${'word '.repeat(100)}, tail`)!;
    expect(out).not.toMatch(/[ ,;:]…$/);
  });
});

describe('articleExcerpt', () => {
  it('prefers the plain body over the Markdown rendition', () => {
    expect(
      articleExcerpt({ content: 'Plain body.', content_markdown: '## Heading\n\nBody.' })
    ).toBe('Plain body.');
  });

  it('falls back to Markdown, then to the description', () => {
    expect(articleExcerpt({ content_markdown: 'Markdown body.' })).toBe('Markdown body.');
    expect(articleExcerpt({ description: 'Just a description.' })).toBe('Just a description.');
  });

  it('bounds the description fallback too', () => {
    // Measured on the live corpus, 2.7% of articles carry a description that is
    // ~the whole stored body (RSS stubs). Falling back must not become a way to
    // republish an entire item.
    const out = articleExcerpt({ description: LONG_BODY })!;
    expect(out.length).toBeLessThanOrEqual(ARTICLE_EXCERPT_MAX_CHARS + 1);
  });

  it('returns undefined when the article carries no text at all', () => {
    expect(articleExcerpt({})).toBeUndefined();
  });
});

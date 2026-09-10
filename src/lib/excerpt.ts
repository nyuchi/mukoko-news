/**
 * The one bound on how much of a publisher's text Mukoko re-emits on its own
 * origin, in machine-readable form.
 *
 * Mukoko aggregates other newsrooms' reporting. Two surfaces were shipping the
 * COMPLETE body of that reporting from `news.mukoko.com`, machine-readable and
 * free of the publisher's own page: `NewsArticle.articleBody` in the JSON-LD,
 * and the `Accept: text/markdown` agent representation. Between them an answer
 * engine could satisfy a reader end-to-end without the publisher's site ever
 * being fetched.
 *
 * Both now go through this module, and they share ONE constant deliberately:
 * the two surfaces each independently reached for "the whole body" because
 * nothing said what the limit was. A single exported bound is what stops them
 * drifting apart again.
 *
 * ## Why 320 characters
 *
 * 1. **It is the most a snippet can ever be.** ~320 characters is the ceiling
 *    of an extended search snippet (`max-snippet:320`). An excerpt longer than
 *    that cannot be surfaced verbatim by the consumer it is aimed at, so the
 *    extra bytes buy nothing. Google's `NewsArticle` guidance does not use
 *    `articleBody` for any rich result in the first place — `headline`,
 *    `description`, `datePublished` and the rendered page carry the appearance.
 * 2. **It cannot substitute for the article.** Measured on the live corpus
 *    (3,000-article random sample, 2026-09-10) the median rendered body is
 *    3,284 characters and the mean 3,915. 320 characters is ~10% of a typical
 *    piece — a standfirst, not a read.
 * 3. **It matches what the platform already publishes about itself.** The
 *    `description` on the same documents averages 290 characters (p75 412,
 *    hard ceiling ~500; the longest in the sample was 635). An excerpt at 320
 *    reads like the lede the publisher's own feed already syndicates.
 * 4. **Bytes are a real cost here.** The audience is on metered African mobile
 *    data, and this payload is duplicated into every article document.
 *
 * ## Why the excerpt is NOT just `description`
 *
 * `description` is bounded — nothing in the 3,000-document sample exceeded 1,000
 * characters — so it is never the full text of a normal article. But it is not
 * safe to treat as an excerpt by definition: on 82 of those 3,000 documents
 * (2.7%) the description was at least 80% of the whole stored body, because the
 * body itself is an RSS stub shorter than the description. Reusing `description`
 * verbatim would therefore still republish the entire item for that slice.
 * Truncating whatever source we use removes the case entirely: the output is
 * bounded regardless of which field it came from.
 */
export const ARTICLE_EXCERPT_MAX_CHARS = 320;

/** Trailing punctuation that reads as a broken sentence before an ellipsis. */
const TRAILING_PUNCTUATION = /[\s.,;:!?"'“”‘’(–—-]+$/u;

/**
 * Flatten `text` to a single line and cut it to at most `max` characters,
 * ending on a word boundary with an ellipsis when anything was removed.
 *
 * Returns `undefined` for empty input so callers can omit the property rather
 * than emit an empty string — an absent field is honest, `""` is noise.
 */
export function toExcerpt(
  text: string | null | undefined,
  max: number = ARTICLE_EXCERPT_MAX_CHARS
): string | undefined {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  if (flat.length <= max) return flat;

  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  // Only honour the word boundary when it isn't pathologically early — a single
  // 400-character "word" (a URL, or a CJK/Arabic run with no spaces) would
  // otherwise collapse the excerpt to nothing.
  const kept = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${kept.replace(TRAILING_PUNCTUATION, '')}…`;
}

/**
 * The excerpt of an article, for the machine-readable surfaces.
 *
 * Prefers the plain-text body (`content`) over the Markdown rendition, because
 * flattening Markdown to one line turns `## Heading` into prose noise; falls
 * back to `description` only when there is no body at all.
 */
export function articleExcerpt(article: {
  content?: string;
  content_markdown?: string;
  description?: string;
}): string | undefined {
  return toExcerpt(article.content || article.content_markdown || article.description);
}

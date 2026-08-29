import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a date string as relative time (e.g., "5m ago", "2h ago")
 */
export function formatTimeAgo(dateString: string): string {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "Recently";

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();

    // Handle future dates (clock skew or scheduled content)
    if (diffMs < 0) return "Recently";

    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins === 0) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "Recently";
  }
}

/**
 * Build a safe CSS url() value using encodeURI for standards-compliant escaping.
 * Prevents CSS injection by encoding all special characters.
 * Handles already-encoded URLs by decoding first to avoid double-encoding.
 *
 * @example
 * safeCssUrl("image.jpg")                    // url('image.jpg')
 * safeCssUrl("path/to/image%20name.jpg")     // url('path/to/image%20name.jpg') - not double-encoded
 * safeCssUrl("image with spaces.jpg")        // url('image%20with%20spaces.jpg')
 *
 * Edge case: decodeURI throws URIError for malformed percent sequences like "%GG" or
 * incomplete sequences like "%2". In these cases, we fall back to encoding as-is.
 */
export function safeCssUrl(src: string): string {
  // encodeURI, but leave EXISTING valid %XX escapes alone instead of escaping
  // their '%' to '%25'.
  //
  // The previous decodeURI -> encodeURI round-trip double-encoded every proxied
  // image URL and broke them all. decodeURI deliberately does NOT decode escapes
  // for *reserved* characters, so '%3A' survived step one unchanged and then
  // encodeURI escaped its '%'. Since imageProxyUrl() percent-encodes the whole
  // publisher URL into the path, `safeCssUrl(imageProxyUrl(x))` produced
  // `.../i/https%253A%252F%252F...`; the image-worker's single decodeURIComponent
  // then yielded the non-URL "https%3A%2F%2F..." and answered 400. The
  // round-trip only ever worked for unreserved characters like %20.
  //
  // Splitting on a capturing group puts the escapes at odd indices, so they pass
  // through verbatim while everything else is encoded normally. A lone '%' that
  // is not a valid escape (e.g. "100%off") has no match and is still encoded.
  const encoded = src
    .split(/(%[0-9A-Fa-f]{2})/)
    .map((part, i) => (i % 2 === 1 ? part : encodeURI(part)))
    .join('')
    // encodeURI does not escape an apostrophe, so a URL containing one used to
    // terminate this very string early:
    //   url('https://x/img'); background:url('https://evil/steal')
    // Backslash IS escaped by encodeURI (to %5C), so the quote is the only gap.
    .replace(/'/g, '%27');

  return `url('${encoded}')`;
}

/**
 * Validate that a URL is safe for use in image src attributes
 * Prevents XSS via javascript: URLs or other dangerous protocols
 * Supports relative URLs for local images (Next.js Image handles these)
 */
export function isValidImageUrl(url: string | undefined | null): boolean {
  if (!url) return false;

  // Relative URLs starting with / are safe for Next.js Image
  if (url.startsWith('/')) return true;

  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Convert HTML/markup to readable plain text.
 *
 * Article bodies sometimes arrive with residual markup — e.g. a
 * `<html><body>…</body></html>` wrapper from upstream processing — which must
 * never be rendered verbatim. Block-level tags become line breaks so paragraph
 * structure survives; everything else is stripped and common entities decoded.
 */
const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

/** Repeatedly apply `re` until the string stops changing (complete sanitization). */
function replaceUntilStable(input: string, re: RegExp, replacement: string): string {
  let prev: string;
  let out = input;
  do {
    prev = out;
    out = out.replace(re, replacement);
  } while (out !== prev);
  return out;
}

export function stripHtml(input: string | undefined | null): string {
  if (!input) return '';

  // Drop <script>/<style> blocks (content and all). Loop until stable so a
  // nested/overlapping sequence can't reconstruct a tag after a single pass.
  let text = replaceUntilStable(
    input,
    /<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
    ''
  );

  // Block-level boundaries → newlines so paragraph structure survives.
  text = text
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|h[1-6]|li|ul|ol|section|article|header|footer|blockquote)\s*>/gi, '\n');

  // Remove all remaining tags. Loop until stable so interleaved angle brackets
  // (e.g. "<scr<script>ipt>") can't leave a usable tag behind.
  text = replaceUntilStable(text, /<[^>]*>/g, '');

  // Decode common HTML entities in a SINGLE pass via a lookup, so chained
  // decoding can't double-unescape (e.g. "&amp;lt;" must yield "&lt;", not "<").
  text = text.replace(/&(?:nbsp|amp|lt|gt|quot|apos|#0*39);/gi, (match) => {
    const key = match.toLowerCase().replace(/&#0*39;/, '&#39;');
    return HTML_ENTITIES[key] ?? match;
  });

  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Normalise a tag/keyword (display name or stored slug) into a /topic/[slug]
 * path segment — lowercase words joined by single hyphens, matching the
 * validation in getTopicTimelineAction.
 */
export function topicSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

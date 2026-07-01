/**
 * Route article images through the Mukoko image-worker proxy
 * (`assets.mukoko.com/i/<encoded-original>?w=…&fmt=webp`).
 *
 * Why: article `image_url`s are third-party publisher URLs. Rendering them raw
 * relies on Vercel's optimizer fetching hundreds of unknown hosts (slow/limited)
 * and on each publisher not hotlink-blocking. The image-worker fetches the origin
 * server-side, resizes/optimizes (webp/avif), caches in R2, and serves a clean
 * same-origin image — so images load reliably.
 *
 * The original URL is **percent-encoded** into the path segment so its own query
 * string survives (the worker does one `decodeURIComponent` on the path and reads
 * `w/h/fmt/q/fit` from the request query separately).
 */
const IMAGE_PROXY_BASE = 'https://assets.mukoko.com/i/';

export interface ImageProxyOptions {
  width?: number;
  height?: number;
  quality?: number;
  fit?: 'cover' | 'contain' | 'scale-down' | 'crop' | 'pad';
  format?: 'webp' | 'avif' | 'jpeg' | 'png';
}

/**
 * Wrap an absolute http(s) image URL with the image-worker proxy. Relative paths
 * (`/foo.png`), data/blob URLs, and empty values are returned unchanged — only
 * remote publisher images need proxying.
 */
export function imageProxyUrl(src: string | undefined | null, opts: ImageProxyOptions = {}): string {
  if (!src) return '';
  // Only proxy absolute http(s) URLs; leave local/relative assets alone.
  if (!/^https?:\/\//i.test(src)) return src;

  const params = new URLSearchParams();
  if (opts.width) params.set('w', String(opts.width));
  if (opts.height) params.set('h', String(opts.height));
  params.set('fmt', opts.format ?? 'webp');
  params.set('q', String(opts.quality ?? 80));
  params.set('fit', opts.fit ?? 'cover');
  return `${IMAGE_PROXY_BASE}${encodeURIComponent(src)}?${params.toString()}`;
}

/**
 * A `next/image` loader that routes optimization to the image-worker instead of
 * Vercel's optimizer. next/image calls this per srcset width; the worker resizes.
 */
export function mukokoImageLoader({
  src,
  width,
  quality,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  const proxied = imageProxyUrl(src, { width, quality });
  // If src wasn't a remote URL, imageProxyUrl returns it unchanged — hand it back
  // so next/image can still render a local asset.
  return proxied || src;
}

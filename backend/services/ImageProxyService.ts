/**
 * Image proxy with Cloudflare Image Resizing.
 *
 * Route: GET /i/<original-url>?w=800&h=450&fmt=webp&q=85&fit=cover
 *
 * The original image is fetched and passed through Cloudflare Image Resizing
 * before being returned. The original is never stored — only the optimized
 * variant is cached at the edge. This serves the original image content
 * (copyright safe) with format/size optimization on top.
 */

import type { Context } from "hono";

// Allowed image MIME types — reject anything else
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/svg+xml",
]);

// Block SSRF targets — private/loopback ranges
const BLOCKED_HOSTNAMES = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function parseImageOptions(url: URL) {
  const w = parseInt(url.searchParams.get("w") ?? "0", 10) || undefined;
  const h = parseInt(url.searchParams.get("h") ?? "0", 10) || undefined;
  const quality = parseInt(url.searchParams.get("q") ?? "85", 10);
  const format = (url.searchParams.get("fmt") as "webp" | "avif" | "jpeg" | "png") ?? "webp";
  const fit = (url.searchParams.get("fit") as "cover" | "contain" | "scale-down" | "crop" | "pad") ?? "cover";
  return { width: w, height: h, quality, format, fit };
}

export async function handleImageProxy(c: Context): Promise<Response> {
  // Extract original URL from path: /i/<url>
  const rawPath = c.req.path.slice(3); // strip "/i/"
  if (!rawPath) {
    return c.text("Missing image URL", 400);
  }

  // The original URL may include query params — reconstruct from full URL
  const requestUrl = new URL(c.req.url);
  const originalUrl = rawPath + (requestUrl.search ? requestUrl.search.replace(/[?&](w|h|q|fmt|fit)=[^&]*/g, "").replace(/^[?&]/, "") : "");

  // Validate URL
  let parsed: URL;
  try {
    parsed = new URL(decodeURIComponent(originalUrl.startsWith("http") ? originalUrl : "https://" + originalUrl));
  } catch {
    return c.text("Invalid image URL", 400);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return c.text("Only http/https URLs allowed", 400);
  }

  if (BLOCKED_HOSTNAMES.test(parsed.hostname)) {
    return c.text("Blocked URL", 403);
  }

  const opts = parseImageOptions(requestUrl);

  // Fetch via Cloudflare Image Resizing
  // cf.image options are applied transparently — original is fetched, resized, returned
  const imageResponse = await fetch(parsed.toString(), {
    cf: {
      image: {
        ...(opts.width && { width: opts.width }),
        ...(opts.height && { height: opts.height }),
        quality: opts.quality,
        format: opts.format,
        fit: opts.fit,
      },
    } as RequestInitCfProperties,
  });

  if (!imageResponse.ok) {
    return c.text("Failed to fetch image", 502);
  }

  const contentType = imageResponse.headers.get("content-type") ?? "";
  if (!ALLOWED_TYPES.has(contentType.split(";")[0].trim())) {
    return c.text("Not an image", 400);
  }

  return new Response(imageResponse.body, {
    status: 200,
    headers: {
      "Content-Type": opts.format === "webp" ? "image/webp" : contentType,
      "Cache-Control": "public, max-age=2592000, immutable", // 30 days
      "Vary": "Accept",
      "X-Image-Source": parsed.hostname,
    },
  });
}

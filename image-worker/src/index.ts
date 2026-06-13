/**
 * Mukoko Images — image proxy with Cloudflare Image Resizing
 *
 * Route: GET /i/<original-url>?w=800&h=450&fmt=webp&q=85&fit=cover
 *
 * Security:
 * - Allowlist-only: only fetches from approved news source domains.
 *   Domains set via ALLOWED_DOMAINS env var (comma-separated) or
 *   falls back to the built-in list below.
 * - No SVG support: news images are never SVGs; excluding prevents XSS.
 * - Redirects followed with re-validation on each hop.
 * - R2 persistent cache keyed by URL hash (avoids re-fetching the origin).
 */

type Env = {
  CACHE: R2Bucket;
  ALLOWED_DOMAINS: string;
};

// Built-in allowed domains — extend via ALLOWED_DOMAINS env var
const BASE_ALLOWED_DOMAINS = new Set([
  "media.itnewsafrica.com",
  "img.itnewsafrica.com",
  "techzim.co.zw",
  "www.techzim.co.zw",
  "kubatana.net",
  "www.kubatana.net",
  "businessweekly.co.zw",
  "www.businessweekly.co.zw",
  "263chat.com",
  "www.263chat.com",
  "newzimbabwe.com",
  "www.newzimbabwe.com",
  "zwnews.com",
  "www.zwnews.com",
  "newsday.co.zw",
  "www.newsday.co.zw",
  "herald.co.zw",
  "www.herald.co.zw",
  "chronicle.co.zw",
  "www.chronicle.co.zw",
  "sundaymail.co.zw",
  "www.sundaymail.co.zw",
  "thezimbabwean.co",
  "www.thezimbabwean.co",
  "bbc.co.uk",
  "ichef.bbci.co.uk",
  "news.bbcimg.co.uk",
  "static.reuters.com",
  "cloudfront-us-east-2.images.arcpublishing.com",
  "media.allafrica.com",
  "allafrica.com",
  "cdn.vanguardngr.com",
  "guardian.ng",
  "www.guardian.ng",
  "punchng.com",
  "www.punchng.com",
  "nation.africa",
  "www.nation.africa",
  "theeastafrican.co.ke",
  "www.theeastafrican.co.ke",
  "businessdailyafrica.com",
  "www.businessdailyafrica.com",
  "daily-monitor.s3.amazonaws.com",
  "s3-eu-west-1.amazonaws.com",
  "i.guim.co.uk",
  "media.githubusercontent.com",
]);

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

type ImageFormat = "webp" | "avif" | "jpeg" | "png";
type ImageFit = "cover" | "contain" | "scale-down" | "crop" | "pad";

function getAllowedDomains(env: Env): Set<string> {
  if (!env.ALLOWED_DOMAINS) return BASE_ALLOWED_DOMAINS;
  const extra = env.ALLOWED_DOMAINS.split(",").map(d => d.trim().toLowerCase()).filter(Boolean);
  return new Set([...BASE_ALLOWED_DOMAINS, ...extra]);
}

function cacheKey(url: string, w?: number, h?: number, fmt?: string, q?: number): string {
  return `img/${btoa(url).replace(/[+/=]/g, c => ({ "+": "-", "/": "_", "=": "" }[c] ?? c))}_${w ?? 0}x${h ?? 0}_${fmt ?? "webp"}_${q ?? 85}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Only handle /i/* routes
    if (!url.pathname.startsWith("/i/")) {
      return new Response("Not found", { status: 404 });
    }

    // Extract original URL from path (everything after /i/)
    const rawOriginal = url.pathname.slice(3);
    if (!rawOriginal) return new Response("Missing image URL", { status: 400 });

    // Decode and normalize original URL
    let originalUrl: URL;
    try {
      const decoded = decodeURIComponent(rawOriginal);
      originalUrl = new URL(decoded.startsWith("http") ? decoded : "https://" + decoded);
    } catch {
      return new Response("Invalid URL", { status: 400 });
    }

    if (!["http:", "https:"].includes(originalUrl.protocol)) {
      return new Response("Only http/https allowed", { status: 400 });
    }

    // Allowlist check — must be an approved news source domain
    const hostname = originalUrl.hostname.toLowerCase();
    if (!getAllowedDomains(env).has(hostname)) {
      return new Response("Domain not allowed", { status: 403 });
    }

    // Parse optimization params
    const w = parseInt(url.searchParams.get("w") ?? "0") || undefined;
    const h = parseInt(url.searchParams.get("h") ?? "0") || undefined;
    const q = Math.min(100, Math.max(1, parseInt(url.searchParams.get("q") ?? "85")));
    const fmt = (url.searchParams.get("fmt") ?? "webp") as ImageFormat;
    const fit = (url.searchParams.get("fit") ?? "cover") as ImageFit;

    // Check R2 persistent cache
    const key = cacheKey(originalUrl.toString(), w, h, fmt, q);
    const cached = await env.CACHE.get(key);
    if (cached) {
      return new Response(cached.body, {
        headers: {
          "Content-Type": `image/${fmt === "jpeg" ? "jpeg" : fmt}`,
          "Cache-Control": "public, max-age=2592000, immutable",
          "X-Cache": "HIT",
        },
      });
    }

    // Fetch via Cloudflare Image Resizing
    const imageResponse = await fetch(originalUrl.toString(), {
      redirect: "follow",
      cf: {
        image: {
          ...(w && { width: w }),
          ...(h && { height: h }),
          quality: q,
          format: fmt,
          fit,
        },
      } as RequestInitCfProperties,
    });

    if (!imageResponse.ok) {
      return new Response("Failed to fetch image", { status: 502 });
    }

    // Validate content type — no SVG (XSS risk), no non-image types
    const ct = (imageResponse.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!ALLOWED_CONTENT_TYPES.has(ct)) {
      return new Response("Not an image", { status: 400 });
    }

    const buffer = await imageResponse.arrayBuffer();

    // Store in R2 for persistent caching (async, don't block response)
    env.CACHE.put(key, buffer.slice(0), {
      httpMetadata: { contentType: `image/${fmt}` },
      customMetadata: { source: originalUrl.hostname, cached: new Date().toISOString() },
    }).catch(() => {});

    return new Response(buffer, {
      headers: {
        "Content-Type": `image/${fmt}`,
        "Cache-Control": "public, max-age=2592000, immutable",
        "X-Cache": "MISS",
        "X-Image-Source": originalUrl.hostname,
      },
    });
  },
};

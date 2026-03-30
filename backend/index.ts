/**
 * Mukoko News — Cloudflare Worker (Edge Cache Layer)
 *
 * Low-latency edge caching via Cloudflare bindings:
 * - D1: Cached reads and fast lookups at the edge
 * - Workers AI: BGE-M3 embedding inference (co-located, low latency)
 * - KV: Session storage, response caching
 * - Analytics Engine: Real-time event ingestion
 * - R2: Media/asset storage
 *
 * Heavy processing (RSS ingestion, AI keyword extraction, quality
 * scoring, engagement, search) runs on Fly.io (fly-worker/) + Supabase.
 * This worker reduces latency for reads and embedding inference.
 *
 * Platform service designs in services/platform/ are the next
 * migration target to fly-worker.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

type Bindings = {
  DB: D1Database;
  AUTH_STORAGE: KVNamespace;
  CACHE_STORAGE: KVNamespace;
  NEWS_ANALYTICS: AnalyticsEngineDataset;
  AI: Ai;
  STORAGE?: R2Bucket;
  ADMIN_SESSION_SECRET: string;
  API_SECRET?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", cors({
  origin: [
    "https://news.mukoko.com",
    "https://mukoko-news.vercel.app",
    "http://localhost:3000",
  ],
  credentials: true,
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

// Health check
app.get("/health", (c) => c.json({ status: "ok", service: "mukoko-news-backend", runtime: "cloudflare-workers" }));
app.get("/api/health", (c) => c.json({ status: "ok", service: "mukoko-news-backend", runtime: "cloudflare-workers" }));

// D1 stats (lightweight — verifies D1 binding works)
app.get("/api/stats", async (c) => {
  try {
    const apiSecret = c.req.header("Authorization")?.replace("Bearer ", "");
    if (!c.env.API_SECRET || apiSecret !== c.env.API_SECRET) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const result = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM organizations WHERE enabled = 1"
    ).first<{ count: number }>();

    return c.json({
      status: "ok",
      sources: result?.count ?? 0,
      note: "Production API is at mukoko-news-api.fly.dev",
    });
  } catch (e) {
    return c.json({ error: "D1 query failed", detail: String(e) }, 500);
  }
});

// Catch-all — routes not handled by the edge layer redirect to Fly.io
app.all("/api/*", (c) => {
  const url = new URL(c.req.url);
  return c.redirect(`https://mukoko-news-api.fly.dev${url.pathname}${url.search}`, 307);
});

export default app;

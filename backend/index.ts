/**
 * Mukoko News — Cloudflare Worker (Minimal)
 *
 * This worker is a lightweight shim that preserves Cloudflare bindings
 * (D1, Workers AI, KV, Analytics Engine, R2) while the production API
 * runs on Fly.io (fly-worker/).
 *
 * Active responsibilities:
 * - Health check endpoint
 * - Workers AI proxy for fly-worker embeddings (future — currently fly-worker calls REST API directly)
 * - D1 database access for legacy reads
 *
 * The platform service designs live in services/platform/ and are the
 * next migration target to fly-worker.
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

// Catch-all — redirect to production API
app.all("/api/*", (c) => {
  return c.json({
    error: "This endpoint has moved",
    production_api: "https://mukoko-news-api.fly.dev",
    message: "The production News API now runs on Fly.io. Update your base URL.",
  }, 301);
});

export default app;

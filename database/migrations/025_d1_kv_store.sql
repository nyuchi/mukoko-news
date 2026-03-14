-- Migration 025: D1-backed key-value store replacing Cloudflare KV
--
-- Replaces AUTH_STORAGE and CACHE_STORAGE KV namespaces with D1 tables.
-- Why: KV is eventually consistent (up to 60s stale reads), has no atomic
-- operations, and doesn't scale well for sessions/rate-limiting/CSRF.
-- D1 gives strong consistency, SQL queries, and atomic writes at the edge.

CREATE TABLE IF NOT EXISTS kv_store (
  namespace TEXT NOT NULL,           -- 'auth' or 'cache'
  key TEXT NOT NULL,                 -- e.g. 'session:abc123', 'ratelimit:1.2.3.4'
  value TEXT NOT NULL,               -- JSON or plain text
  expires_at INTEGER,                -- Unix epoch seconds, NULL = never expires
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (namespace, key)
);

-- Index for efficient TTL cleanup (scheduled CRON job deletes expired rows)
CREATE INDEX IF NOT EXISTS idx_kv_store_expires
ON kv_store (namespace, expires_at)
WHERE expires_at IS NOT NULL;

-- Index for listing keys by prefix (e.g. all sessions, all rate limits)
CREATE INDEX IF NOT EXISTS idx_kv_store_namespace_key
ON kv_store (namespace, key);

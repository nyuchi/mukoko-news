-- Migration 024: Platform services tables
-- Adds tables for: API keys, publishers, webhooks, content moderation,
-- dynamic data, PII audit, SSE events, and open data tracking

-- ============================================================
-- API Keys - Self-service developer key management
-- ============================================================
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'developer', 'business', 'enterprise', 'open_data')),
  permissions TEXT NOT NULL DEFAULT '[]',
  rate_limit TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  last_used_at TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  daily_usage INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys(owner_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_tier ON api_keys(tier);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

-- ============================================================
-- Publishers - Publisher verification and management
-- ============================================================
CREATE TABLE IF NOT EXISTS publishers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  logo_url TEXT,
  country_code TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  verification_level TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_level IN ('unverified', 'basic', 'verified', 'premium')),
  verification_token TEXT,
  verified_at TEXT,
  api_key_id TEXT,
  categories TEXT NOT NULL DEFAULT '[]',
  languages TEXT NOT NULL DEFAULT '["en"]',
  article_count INTEGER NOT NULL DEFAULT 0,
  total_views INTEGER NOT NULL DEFAULT 0,
  avg_quality_score REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_suspended INTEGER NOT NULL DEFAULT 0,
  suspension_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_publishers_country ON publishers(country_code);
CREATE INDEX IF NOT EXISTS idx_publishers_verification ON publishers(verification_level);
CREATE INDEX IF NOT EXISTS idx_publishers_domain ON publishers(domain);

-- ============================================================
-- Webhook Subscriptions - Event-driven notifications
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id TEXT PRIMARY KEY,
  api_key_id TEXT NOT NULL,
  url TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '[]',
  secret TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL DEFAULT '',
  filters TEXT NOT NULL DEFAULT '{}',
  total_sent INTEGER NOT NULL DEFAULT 0,
  total_failed INTEGER NOT NULL DEFAULT 0,
  last_delivery_at TEXT,
  last_status_code INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webhooks_api_key ON webhook_subscriptions(api_key_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhook_subscriptions(is_active);

-- ============================================================
-- Webhook Deliveries - Delivery history and audit trail
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  event TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed', 'retrying')),
  attempt INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  response_status INTEGER,
  response_body TEXT,
  error TEXT,
  delivered_at TEXT,
  next_retry_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_sub ON webhook_deliveries(subscription_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created ON webhook_deliveries(created_at);

-- ============================================================
-- Content Moderation Log - AI and pattern moderation results
-- ============================================================
CREATE TABLE IF NOT EXISTS content_moderation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id TEXT NOT NULL,
  overall_score INTEGER NOT NULL DEFAULT 0,
  flags TEXT NOT NULL DEFAULT '[]',
  recommendation TEXT NOT NULL DEFAULT 'review' CHECK (recommendation IN ('approve', 'review', 'flag', 'reject')),
  cultural_alignment TEXT NOT NULL DEFAULT '{}',
  fact_check_signals TEXT NOT NULL DEFAULT '[]',
  processed_at TEXT NOT NULL DEFAULT (datetime('now')),
  model TEXT NOT NULL DEFAULT 'pattern-only'
);

CREATE INDEX IF NOT EXISTS idx_moderation_article ON content_moderation_log(article_id);
CREATE INDEX IF NOT EXISTS idx_moderation_recommendation ON content_moderation_log(recommendation);
CREATE INDEX IF NOT EXISTS idx_moderation_processed ON content_moderation_log(processed_at);

-- ============================================================
-- Dynamic Categories - Database-driven categories (not hardcoded)
-- ============================================================
-- Extend existing categories table with dynamic fields
-- These columns are added IF NOT EXISTS to avoid conflicts
ALTER TABLE categories ADD COLUMN emoji TEXT DEFAULT '📰';
ALTER TABLE categories ADD COLUMN color TEXT DEFAULT '#4B0082';
ALTER TABLE categories ADD COLUMN parent_id TEXT;
ALTER TABLE categories ADD COLUMN is_active INTEGER DEFAULT 1;
ALTER TABLE categories ADD COLUMN sort_order INTEGER DEFAULT 999;
ALTER TABLE categories ADD COLUMN created_at TEXT DEFAULT (datetime('now'));
ALTER TABLE categories ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));

-- ============================================================
-- Dynamic Keywords - Auto-discovered, living keywords/tags
-- ============================================================
CREATE TABLE IF NOT EXISTS keywords (
  id TEXT PRIMARY KEY,
  term TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  normalized TEXT NOT NULL,
  category_id TEXT,
  usage_count INTEGER NOT NULL DEFAULT 1,
  trending_score REAL NOT NULL DEFAULT 0,
  aliases TEXT NOT NULL DEFAULT '[]',
  language TEXT NOT NULL DEFAULT 'en',
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_active INTEGER NOT NULL DEFAULT 1,
  auto_discovered INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_keywords_slug ON keywords(slug);
CREATE INDEX IF NOT EXISTS idx_keywords_normalized ON keywords(normalized);
CREATE INDEX IF NOT EXISTS idx_keywords_trending ON keywords(trending_score DESC);
CREATE INDEX IF NOT EXISTS idx_keywords_usage ON keywords(usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_keywords_active ON keywords(is_active);

-- ============================================================
-- Dynamic Sources - Extended source management
-- ============================================================
CREATE TABLE IF NOT EXISTS dynamic_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  country_code TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  logo_url TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  categories TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1,
  is_verified INTEGER NOT NULL DEFAULT 0,
  health_status TEXT NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('healthy', 'degraded', 'failing', 'critical', 'unknown')),
  article_count INTEGER NOT NULL DEFAULT 0,
  last_fetched_at TEXT,
  added_by TEXT NOT NULL DEFAULT 'admin' CHECK (added_by IN ('system', 'admin', 'publisher', 'discovery')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dynamic_sources_country ON dynamic_sources(country_code);
CREATE INDEX IF NOT EXISTS idx_dynamic_sources_active ON dynamic_sources(is_active);
CREATE INDEX IF NOT EXISTS idx_dynamic_sources_health ON dynamic_sources(health_status);

-- ============================================================
-- Dynamic Countries - Database-driven country support
-- ============================================================
CREATE TABLE IF NOT EXISTS dynamic_countries (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  flag_emoji TEXT NOT NULL,
  region TEXT NOT NULL,
  languages TEXT NOT NULL DEFAULT '[]',
  currency_code TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  is_active INTEGER NOT NULL DEFAULT 1,
  source_count INTEGER NOT NULL DEFAULT 0,
  article_count INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 999,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dynamic_countries_code ON dynamic_countries(code);
CREATE INDEX IF NOT EXISTS idx_dynamic_countries_active ON dynamic_countries(is_active);

-- ============================================================
-- Tags - Entity, topic, location, event tags
-- ============================================================
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'topic' CHECK (type IN ('topic', 'entity', 'location', 'event', 'person', 'organization')),
  usage_count INTEGER NOT NULL DEFAULT 1,
  trending_score REAL NOT NULL DEFAULT 0,
  related_tags TEXT NOT NULL DEFAULT '[]',
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_tags_slug ON tags(slug);
CREATE INDEX IF NOT EXISTS idx_tags_type ON tags(type);
CREATE INDEX IF NOT EXISTS idx_tags_trending ON tags(trending_score DESC);

-- ============================================================
-- PII Audit Log - Track PII removal from open data
-- ============================================================
CREATE TABLE IF NOT EXISTS pii_audit_log (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  fields_scanned INTEGER NOT NULL DEFAULT 0,
  pii_fields_found INTEGER NOT NULL DEFAULT 0,
  pii_types TEXT NOT NULL DEFAULT '[]',
  risk_level TEXT NOT NULL DEFAULT 'none' CHECK (risk_level IN ('none', 'low', 'medium', 'high'))
);

CREATE INDEX IF NOT EXISTS idx_pii_audit_timestamp ON pii_audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_pii_audit_risk ON pii_audit_log(risk_level);

-- ============================================================
-- SSE Event Log - For replay on client reconnection
-- ============================================================
CREATE TABLE IF NOT EXISTS sse_event_log (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sse_events_created ON sse_event_log(created_at);

-- ============================================================
-- Seed initial countries from the 16 supported Pan-African markets
-- ============================================================
INSERT OR IGNORE INTO dynamic_countries (id, code, name, flag_emoji, region, languages, currency_code, timezone, is_active, sort_order) VALUES
  (lower(hex(randomblob(16))), 'ZW', 'Zimbabwe', '🇿🇼', 'Southern Africa', '["en","sn","nd"]', 'ZWL', 'Africa/Harare', 1, 1),
  (lower(hex(randomblob(16))), 'ZA', 'South Africa', '🇿🇦', 'Southern Africa', '["en","zu","af"]', 'ZAR', 'Africa/Johannesburg', 1, 2),
  (lower(hex(randomblob(16))), 'KE', 'Kenya', '🇰🇪', 'East Africa', '["en","sw"]', 'KES', 'Africa/Nairobi', 1, 3),
  (lower(hex(randomblob(16))), 'NG', 'Nigeria', '🇳🇬', 'West Africa', '["en","yo","ha"]', 'NGN', 'Africa/Lagos', 1, 4),
  (lower(hex(randomblob(16))), 'GH', 'Ghana', '🇬🇭', 'West Africa', '["en"]', 'GHS', 'Africa/Accra', 1, 5),
  (lower(hex(randomblob(16))), 'TZ', 'Tanzania', '🇹🇿', 'East Africa', '["en","sw"]', 'TZS', 'Africa/Dar_es_Salaam', 1, 6),
  (lower(hex(randomblob(16))), 'UG', 'Uganda', '🇺🇬', 'East Africa', '["en","sw"]', 'UGX', 'Africa/Kampala', 1, 7),
  (lower(hex(randomblob(16))), 'RW', 'Rwanda', '🇷🇼', 'East Africa', '["en","rw","fr"]', 'RWF', 'Africa/Kigali', 1, 8),
  (lower(hex(randomblob(16))), 'ET', 'Ethiopia', '🇪🇹', 'East Africa', '["am","en"]', 'ETB', 'Africa/Addis_Ababa', 1, 9),
  (lower(hex(randomblob(16))), 'BW', 'Botswana', '🇧🇼', 'Southern Africa', '["en","tn"]', 'BWP', 'Africa/Gaborone', 1, 10),
  (lower(hex(randomblob(16))), 'ZM', 'Zambia', '🇿🇲', 'Southern Africa', '["en"]', 'ZMW', 'Africa/Lusaka', 1, 11),
  (lower(hex(randomblob(16))), 'MW', 'Malawi', '🇲🇼', 'Southern Africa', '["en","ny"]', 'MWK', 'Africa/Lilongwe', 1, 12),
  (lower(hex(randomblob(16))), 'EG', 'Egypt', '🇪🇬', 'North Africa', '["ar","en"]', 'EGP', 'Africa/Cairo', 1, 13),
  (lower(hex(randomblob(16))), 'MA', 'Morocco', '🇲🇦', 'North Africa', '["ar","fr"]', 'MAD', 'Africa/Casablanca', 1, 14),
  (lower(hex(randomblob(16))), 'NA', 'Namibia', '🇳🇦', 'Southern Africa', '["en"]', 'NAD', 'Africa/Windhoek', 1, 15),
  (lower(hex(randomblob(16))), 'MZ', 'Mozambique', '🇲🇿', 'Southern Africa', '["pt"]', 'MZN', 'Africa/Maputo', 1, 16);

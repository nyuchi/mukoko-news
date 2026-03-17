-- Mukoko News — Supabase-aligned Postgres Schema
-- Combined from 12 Supabase migrations (supabase_mukoko_news)
-- Plus fly-worker operational extensions
--
-- Target: supabase_mukoko_news (gjdmtthumkopkwuttwnd)
-- Source mirror: mukoko_platform_cloud (tdcpuzqyoodrdsxldgsh)

-- ══════════════════════════════════════════════════
-- 001: Extensions & Schemas
-- ══════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS news;
CREATE SCHEMA IF NOT EXISTS engagement;
CREATE SCHEMA IF NOT EXISTS system;
CREATE SCHEMA IF NOT EXISTS sync;

-- ══════════════════════════════════════════════════
-- 002: Identity Schema
-- ══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS identity.person (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stytch_user_id          TEXT UNIQUE,
    name                    TEXT NOT NULL,
    givenname               TEXT,
    familyname              TEXT,
    email                   TEXT UNIQUE,
    telephone               TEXT UNIQUE,
    image                   TEXT,
    url                     TEXT,
    phone_verified          BOOLEAN DEFAULT FALSE,
    email_verified          BOOLEAN DEFAULT FALSE,
    synced_from_platform    BOOLEAN DEFAULT FALSE,
    platform_person_id      UUID,
    last_synced_at          TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_identity_person_platform_id
    ON identity.person (platform_person_id);

-- ══════════════════════════════════════════════════
-- 003: Engagement Interest Categories
-- ══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS engagement.interest_category (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                    TEXT UNIQUE NOT NULL,
    name                    TEXT NOT NULL,
    description             TEXT,
    parent_id               UUID REFERENCES engagement.interest_category (id),
    icon_url                TEXT,
    color_hex               TEXT,
    sort_order              INT DEFAULT 0,
    is_active               BOOLEAN DEFAULT TRUE,
    platform_category_id    UUID,
    last_synced_at          TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interest_category_slug
    ON engagement.interest_category (slug);
CREATE INDEX IF NOT EXISTS idx_interest_category_parent
    ON engagement.interest_category (parent_id);

-- ══════════════════════════════════════════════════
-- 004: News Organizations & Journalists
-- ══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS news.news_media_organization (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                            TEXT NOT NULL,
    alternatename                   TEXT,
    description                     TEXT,
    url                             TEXT,
    logo                            JSONB,
    ethicspolicy                    TEXT,
    masthead                        TEXT,
    missioncoverageprioritiespolicy TEXT,
    correctionspolicy               TEXT,
    diversitypolicy                 TEXT,
    unnamedsourcespolicy            TEXT,
    contactpoint                    JSONB,
    address                         JSONB,
    source_type                     TEXT CHECK (source_type IN (
                                        'newspaper', 'magazine', 'broadcaster',
                                        'digital_native', 'wire_service'
                                    )),
    is_verified                     BOOLEAN DEFAULT FALSE,
    follower_count                  INT DEFAULT 0,
    platform_org_id                 UUID,
    last_synced_at                  TIMESTAMPTZ,
    created_at                      TIMESTAMPTZ DEFAULT now(),
    updated_at                      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS news.journalist (
    person_id               UUID PRIMARY KEY REFERENCES identity.person (id),
    alumniof                JSONB,
    award                   TEXT[],
    worksfor                UUID REFERENCES news.news_media_organization (id),
    jobtitle                TEXT,
    knowsabout              TEXT[],
    article_count           INT DEFAULT 0,
    follower_count          INT DEFAULT 0,
    verified_journalist     BOOLEAN DEFAULT FALSE,
    platform_person_id      UUID,
    last_synced_at          TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now()
);

-- ══════════════════════════════════════════════════
-- 005: News Article
-- ══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS news.news_article (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    articletype                 TEXT NOT NULL DEFAULT 'NewsArticle' CHECK (articletype IN (
                                    'NewsArticle', 'AnalysisNewsArticle', 'BackgroundNewsArticle',
                                    'OpinionNewsArticle', 'ReportageNewsArticle', 'ReviewNewsArticle',
                                    'Article', 'BlogPosting', 'ScholarlyArticle'
                                )),

    headline                    TEXT NOT NULL,
    image                       JSONB,
    datepublished               TIMESTAMPTZ NOT NULL,
    datemodified                TIMESTAMPTZ,
    author                      JSONB NOT NULL,
    primary_author_person_id    UUID REFERENCES identity.person (id),
    publisher                   JSONB NOT NULL,
    publisher_organization_id   UUID REFERENCES news.news_media_organization (id),
    articlebody                 TEXT,
    mongodb_article_id          TEXT,
    couchdb_doc_id              TEXT,
    articlesection              TEXT,
    wordcount                   INT,
    description                 TEXT,
    abstract                    TEXT,
    mainentityofpage            TEXT,
    keywords                    TEXT[],
    about                       JSONB,
    mentions                    JSONB,
    inlanguage                  TEXT DEFAULT 'en',
    copyrightholder             JSONB,
    copyrightyear               INT,
    license                     TEXT,
    dateline                    TEXT,
    backstory                   TEXT,
    slug                        TEXT UNIQUE,

    view_count                  INT DEFAULT 0,
    like_count                  INT DEFAULT 0,
    comment_count               INT DEFAULT 0,
    share_count                 INT DEFAULT 0,

    status                      TEXT DEFAULT 'draft' CHECK (status IN (
                                    'draft', 'processing', 'enriching', 'review',
                                    'published', 'archived', 'retracted'
                                )),
    is_featured                 BOOLEAN DEFAULT FALSE,
    is_breaking                 BOOLEAN DEFAULT FALSE,

    source_url                  TEXT,
    source_feed_id              TEXT,
    source_fingerprint          TEXT UNIQUE,
    ingestion_method            TEXT CHECK (ingestion_method IN (
                                    'manual', 'rss_feed', 'api_push', 'scraper', 'partner_feed'
                                )),
    ingested_at                 TIMESTAMPTZ DEFAULT now(),

    sentiment_score             FLOAT,
    sentiment_label             TEXT CHECK (sentiment_label IN (
                                    'very_negative', 'negative', 'neutral', 'positive', 'very_positive'
                                )),
    named_entities              JSONB,
    topic_tags                  TEXT[],
    reading_time_minutes        INT,
    summary_auto                TEXT,
    summary_approved            BOOLEAN DEFAULT FALSE,

    primary_location_country    TEXT,
    primary_location_region     TEXT,
    geo_tags                    JSONB,

    primary_interest_category_id    UUID REFERENCES engagement.interest_category (id),
    interest_category_scores        JSONB,

    factcheck_status            TEXT DEFAULT 'pending' CHECK (factcheck_status IN (
                                    'pending', 'verified', 'disputed', 'false', 'satire', 'skipped'
                                )),
    factcheck_source            TEXT,
    factcheck_notes             TEXT,
    moderation_status           TEXT DEFAULT 'pending' CHECK (moderation_status IN (
                                    'pending', 'approved', 'flagged', 'rejected'
                                )),
    moderation_notes            TEXT,
    moderated_by                UUID REFERENCES identity.person (id),
    moderated_at                TIMESTAMPTZ,

    sync_status                 TEXT DEFAULT 'not_synced' CHECK (sync_status IN (
                                    'not_synced', 'pending_sync', 'synced', 'sync_error'
                                )),
    platform_article_id         UUID,
    last_synced_at              TIMESTAMPTZ,
    sync_error_message          TEXT,

    created_at                  TIMESTAMPTZ DEFAULT now(),
    updated_at                  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_news_article_status          ON news.news_article (status);
CREATE INDEX IF NOT EXISTS idx_news_article_sync_status     ON news.news_article (sync_status);
CREATE INDEX IF NOT EXISTS idx_news_article_datepublished   ON news.news_article (datepublished DESC);
CREATE INDEX IF NOT EXISTS idx_news_article_publisher       ON news.news_article (publisher_organization_id);
CREATE INDEX IF NOT EXISTS idx_news_article_author          ON news.news_article (primary_author_person_id);
CREATE INDEX IF NOT EXISTS idx_news_article_category        ON news.news_article (primary_interest_category_id);
CREATE INDEX IF NOT EXISTS idx_news_article_source_fp       ON news.news_article (source_fingerprint);
CREATE INDEX IF NOT EXISTS idx_news_article_ingested        ON news.news_article (ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_article_moderation      ON news.news_article (moderation_status);
CREATE INDEX IF NOT EXISTS idx_news_article_factcheck       ON news.news_article (factcheck_status);

-- ══════════════════════════════════════════════════
-- 006: News Engagement Tables
-- ══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS news.article_authorship (
    article_id  UUID NOT NULL REFERENCES news.news_article (id) ON DELETE CASCADE,
    person_id   UUID NOT NULL REFERENCES identity.person (id),
    authortype  TEXT DEFAULT 'author' CHECK (authortype IN (
                    'author', 'contributor', 'editor', 'photographer'
                )),
    position    INT,
    PRIMARY KEY (article_id, person_id)
);

CREATE TABLE IF NOT EXISTS news.article_interest_category (
    article_id              UUID NOT NULL REFERENCES news.news_article (id) ON DELETE CASCADE,
    interest_category_id    UUID NOT NULL REFERENCES engagement.interest_category (id),
    relevance_score         FLOAT DEFAULT 1.0,
    is_primary              BOOLEAN DEFAULT FALSE,
    assigned_by             TEXT DEFAULT 'auto' CHECK (assigned_by IN ('auto', 'manual', 'hybrid')),
    created_at              TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (article_id, interest_category_id)
);

CREATE INDEX IF NOT EXISTS idx_article_category_category
    ON news.article_interest_category (interest_category_id);

CREATE TABLE IF NOT EXISTS news.like_action (
    article_id  UUID NOT NULL REFERENCES news.news_article (id) ON DELETE CASCADE,
    person_id   UUID NOT NULL REFERENCES identity.person (id),
    starttime   TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (article_id, person_id)
);

CREATE TABLE IF NOT EXISTS news.comment (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id          UUID NOT NULL REFERENCES news.news_article (id) ON DELETE CASCADE,
    author              UUID NOT NULL REFERENCES identity.person (id),
    text                TEXT NOT NULL,
    datecreated         TIMESTAMPTZ DEFAULT now(),
    parentitem          UUID REFERENCES news.comment (id),
    moderationstatus    TEXT DEFAULT 'published' CHECK (moderationstatus IN (
                            'published', 'flagged', 'removed'
                        )),
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_news_comment_article ON news.comment (article_id);
CREATE INDEX IF NOT EXISTS idx_news_comment_parent  ON news.comment (parentitem);

CREATE TABLE IF NOT EXISTS news.bookmark_action (
    article_id  UUID NOT NULL REFERENCES news.news_article (id) ON DELETE CASCADE,
    person_id   UUID NOT NULL REFERENCES identity.person (id),
    starttime   TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (article_id, person_id)
);

CREATE TABLE IF NOT EXISTS news.follow_journalist (
    follower_person_id      UUID NOT NULL REFERENCES identity.person (id),
    journalist_person_id    UUID NOT NULL REFERENCES identity.person (id),
    starttime               TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (follower_person_id, journalist_person_id)
);

CREATE TABLE IF NOT EXISTS news.follow_organization (
    follower_person_id  UUID NOT NULL REFERENCES identity.person (id),
    organization_id     UUID NOT NULL REFERENCES news.news_media_organization (id),
    starttime           TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (follower_person_id, organization_id)
);

-- ══════════════════════════════════════════════════
-- 007: News Pipeline Tables
-- ══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS news.feed_source (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID REFERENCES news.news_media_organization (id),
    name                TEXT NOT NULL,
    feed_url            TEXT NOT NULL UNIQUE,
    feed_type           TEXT CHECK (feed_type IN ('rss', 'atom', 'json_feed', 'api', 'scraper')),
    language            TEXT DEFAULT 'en',
    country             TEXT DEFAULT 'ZW',
    is_active           BOOLEAN DEFAULT TRUE,
    fetch_interval_mins INT DEFAULT 30,
    last_fetched_at     TIMESTAMPTZ,
    last_fetch_status   TEXT CHECK (last_fetch_status IN ('success', 'error', 'timeout')),
    last_fetch_error    TEXT,
    article_count       INT DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS news.processing_job (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id      UUID NOT NULL REFERENCES news.news_article (id) ON DELETE CASCADE,
    job_type        TEXT NOT NULL CHECK (job_type IN (
                        'nlp_enrichment', 'geo_tagging', 'category_tagging',
                        'sentiment_analysis', 'fact_check', 'summary_generation',
                        'image_processing', 'duplicate_detection', 'sync_to_platform'
                    )),
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending', 'running', 'completed', 'failed', 'skipped', 'retrying'
                    )),
    priority        INT DEFAULT 5,
    attempts        INT DEFAULT 0,
    max_attempts    INT DEFAULT 3,
    payload         JSONB,
    result          JSONB,
    error_message   TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    scheduled_for   TIMESTAMPTZ DEFAULT now(),
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_processing_job_article
    ON news.processing_job (article_id);
CREATE INDEX IF NOT EXISTS idx_processing_job_status_type
    ON news.processing_job (status, job_type, priority);
CREATE INDEX IF NOT EXISTS idx_processing_job_scheduled
    ON news.processing_job (scheduled_for) WHERE status = 'pending';

-- ══════════════════════════════════════════════════
-- 008: Sync & System Tables
-- ══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sync.sync_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_direction  TEXT NOT NULL CHECK (sync_direction IN ('to_platform', 'from_platform')),
    entity_type     TEXT NOT NULL,
    local_id        UUID NOT NULL,
    platform_id     UUID,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending', 'in_progress', 'success', 'failed', 'conflict'
                    )),
    payload         JSONB,
    response        JSONB,
    error_message   TEXT,
    attempts        INT DEFAULT 0,
    synced_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_log_entity ON sync.sync_log (entity_type, local_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_status ON sync.sync_log (status, sync_direction);

CREATE TABLE IF NOT EXISTS system.activity_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES identity.person (id),
    action      TEXT NOT NULL,
    entity_type TEXT,
    entity_id   UUID,
    metadata    JSONB,
    ip_address  TEXT,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user
    ON system.activity_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity
    ON system.activity_logs (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS system.feature_flags (
    key         TEXT PRIMARY KEY,
    value       BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT,
    updated_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO system.feature_flags (key, value, description) VALUES
    ('nlp_enrichment_enabled',  TRUE,  'Enable NLP enrichment pipeline'),
    ('auto_category_tagging',   TRUE,  'Auto-tag articles with interest categories'),
    ('fact_check_enabled',      FALSE, 'Enable automated fact-checking'),
    ('auto_sync_to_platform',   FALSE, 'Auto-sync published articles to platform cloud'),
    ('breaking_news_alerts',    TRUE,  'Enable breaking news push notifications'),
    ('rss_ingestion_enabled',   TRUE,  'Enable RSS feed ingestion workers')
ON CONFLICT (key) DO NOTHING;

-- ══════════════════════════════════════════════════
-- 009: Triggers
-- ══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION system.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
    CREATE TRIGGER trg_identity_person_updated_at
        BEFORE UPDATE ON identity.person
        FOR EACH ROW EXECUTE FUNCTION system.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TRIGGER trg_news_media_org_updated_at
        BEFORE UPDATE ON news.news_media_organization
        FOR EACH ROW EXECUTE FUNCTION system.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TRIGGER trg_news_journalist_updated_at
        BEFORE UPDATE ON news.journalist
        FOR EACH ROW EXECUTE FUNCTION system.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TRIGGER trg_news_article_updated_at
        BEFORE UPDATE ON news.news_article
        FOR EACH ROW EXECUTE FUNCTION system.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TRIGGER trg_feed_source_updated_at
        BEFORE UPDATE ON news.feed_source
        FOR EACH ROW EXECUTE FUNCTION system.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TRIGGER trg_interest_category_updated_at
        BEFORE UPDATE ON engagement.interest_category
        FOR EACH ROW EXECUTE FUNCTION system.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════
-- 010: claim_processing_job RPC
-- ══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION claim_processing_job(p_job_type TEXT)
RETURNS SETOF news.processing_job AS $$
    UPDATE news.processing_job
    SET status = 'running', started_at = now(), attempts = attempts + 1
    WHERE id = (
        SELECT id FROM news.processing_job
        WHERE job_type = p_job_type
          AND status IN ('pending', 'retrying')
          AND scheduled_for <= now()
        ORDER BY priority ASC, scheduled_for ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    RETURNING *;
$$ LANGUAGE sql;

-- ══════════════════════════════════════════════════
-- WORKER EXTENSIONS
-- Fly-worker operational columns not in canonical Supabase schema
-- ══════════════════════════════════════════════════

-- news.news_article: processing pipeline columns
ALTER TABLE news.news_article ADD COLUMN IF NOT EXISTS article_body_processed TEXT;
ALTER TABLE news.news_article ADD COLUMN IF NOT EXISTS ai_processed BOOLEAN DEFAULT FALSE;
ALTER TABLE news.news_article ADD COLUMN IF NOT EXISTS ai_processed_at TIMESTAMPTZ;
ALTER TABLE news.news_article ADD COLUMN IF NOT EXISTS quality_score REAL DEFAULT 0.0;
ALTER TABLE news.news_article ADD COLUMN IF NOT EXISTS engagement_score REAL DEFAULT 0.0;
ALTER TABLE news.news_article ADD COLUMN IF NOT EXISTS trending_score REAL DEFAULT 0.0;
ALTER TABLE news.news_article ADD COLUMN IF NOT EXISTS embedding JSONB;
ALTER TABLE news.news_article ADD COLUMN IF NOT EXISTS bookmark_count INT DEFAULT 0;
ALTER TABLE news.news_article ADD COLUMN IF NOT EXISTS content_type TEXT DEFAULT 'article';

CREATE INDEX IF NOT EXISTS idx_news_article_engagement ON news.news_article (engagement_score DESC);
CREATE INDEX IF NOT EXISTS idx_news_article_trending ON news.news_article (trending_score DESC);
CREATE INDEX IF NOT EXISTS idx_news_article_ai_processed ON news.news_article (ai_processed) WHERE ai_processed = FALSE;
CREATE INDEX IF NOT EXISTS idx_news_article_updated ON news.news_article (updated_at);

-- news.news_media_organization: slug for URL-friendly identification
ALTER TABLE news.news_media_organization ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;

-- news.feed_source: health tracking extensions
ALTER TABLE news.feed_source ADD COLUMN IF NOT EXISTS consecutive_failures INT DEFAULT 0;
ALTER TABLE news.feed_source ADD COLUMN IF NOT EXISTS total_fetch_count INT DEFAULT 0;
ALTER TABLE news.feed_source ADD COLUMN IF NOT EXISTS total_error_count INT DEFAULT 0;
ALTER TABLE news.feed_source ADD COLUMN IF NOT EXISTS last_successful_fetch_at TIMESTAMPTZ;
ALTER TABLE news.feed_source ADD COLUMN IF NOT EXISTS health_status TEXT DEFAULT 'unknown';
ALTER TABLE news.feed_source ADD COLUMN IF NOT EXISTS quality_score REAL DEFAULT 0.0;
ALTER TABLE news.feed_source ADD COLUMN IF NOT EXISTS credibility_score REAL DEFAULT 1.0;
ALTER TABLE news.feed_source ADD COLUMN IF NOT EXISTS priority INT DEFAULT 3;
ALTER TABLE news.feed_source ADD COLUMN IF NOT EXISTS article_section_slug TEXT;

CREATE INDEX IF NOT EXISTS idx_feed_source_active ON news.feed_source (is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_feed_source_health ON news.feed_source (health_status);
CREATE INDEX IF NOT EXISTS idx_feed_source_country ON news.feed_source (country);

-- engagement.interest_category: display metadata
ALTER TABLE engagement.interest_category ADD COLUMN IF NOT EXISTS emoji TEXT;
ALTER TABLE engagement.interest_category ADD COLUMN IF NOT EXISTS classification_keywords JSONB DEFAULT '[]';

-- identity.person: author/journalist extensions
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS normalized_name TEXT;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS works_for TEXT;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS same_as JSONB DEFAULT '[]';
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS article_count INT DEFAULT 0;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS total_views INT DEFAULT 0;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'unverified';

CREATE INDEX IF NOT EXISTS idx_persons_normalized ON identity.person (normalized_name);
CREATE INDEX IF NOT EXISTS idx_persons_slug ON identity.person (slug);
CREATE INDEX IF NOT EXISTS idx_persons_article_count ON identity.person (article_count DESC);

-- news.article_authorship: extraction metadata
ALTER TABLE news.article_authorship ADD COLUMN IF NOT EXISTS confidence REAL DEFAULT 1.0;
ALTER TABLE news.article_authorship ADD COLUMN IF NOT EXISTS extraction_method TEXT DEFAULT 'rss';
ALTER TABLE news.article_authorship ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- ══════════════════════════════════════════════════
-- OPERATIONAL TABLES
-- Fly-worker-specific tables not in canonical Supabase schema
-- ══════════════════════════════════════════════════

-- Countries (schema:Country / schema:Place)
CREATE TABLE IF NOT EXISTS news.country (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    flag_emoji TEXT,
    color TEXT,
    region TEXT,
    in_language TEXT DEFAULT 'en',
    timezone TEXT,
    enabled BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Defined Terms / Keywords (schema:DefinedTerm)
CREATE TABLE IF NOT EXISTS news.defined_term (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    term_code TEXT UNIQUE,
    term_type TEXT DEFAULT 'keyword'
        CHECK (term_type IN ('keyword', 'topic', 'entity', 'location')),
    article_count INTEGER DEFAULT 0,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_terms_article_count ON news.defined_term (article_count DESC);
CREATE INDEX IF NOT EXISTS idx_terms_type ON news.defined_term (term_type);

-- Article ↔ DefinedTerm junction
CREATE TABLE IF NOT EXISTS news.article_keyword (
    article_id UUID NOT NULL REFERENCES news.news_article (id) ON DELETE CASCADE,
    term_id TEXT NOT NULL REFERENCES news.defined_term (id),
    relevance_score REAL DEFAULT 1.0,
    source TEXT DEFAULT 'auto'
        CHECK (source IN ('auto', 'ai', 'manual')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (article_id, term_id)
);

-- Trending Cache
CREATE TABLE IF NOT EXISTS news.trending_cache (
    id SERIAL PRIMARY KEY,
    scope TEXT NOT NULL DEFAULT 'global',
    scope_id TEXT,
    term_id TEXT REFERENCES news.defined_term (id),
    term_name TEXT NOT NULL,
    article_count INTEGER DEFAULT 0,
    score REAL DEFAULT 0.0,
    computed_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '1 hour'),
    UNIQUE (scope, scope_id, term_id)
);

CREATE INDEX IF NOT EXISTS idx_trending_expires ON news.trending_cache (expires_at);
CREATE INDEX IF NOT EXISTS idx_trending_scope ON news.trending_cache (scope, scope_id);

-- Collection Log (job execution tracking)
CREATE TABLE IF NOT EXISTS system.collection_log (
    id SERIAL PRIMARY KEY,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('started', 'success', 'failed')),
    articles_collected INTEGER DEFAULT 0,
    articles_processed INTEGER DEFAULT 0,
    errors INTEGER DEFAULT 0,
    duration_ms INTEGER,
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collection_created ON system.collection_log (created_at DESC);

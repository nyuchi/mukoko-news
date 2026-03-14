-- Mukoko News — Fly.io Postgres Schema
-- Aligned to schema.org vocabulary (NewsArticle, NewsMediaOrganization, Person, DefinedTerm)
-- This is the processing worker's own database. It syncs outward to D1.
--
-- Naming convention: schema.org property names in snake_case
-- e.g., schema:headline → headline, schema:datePublished → date_published

-- ================================================
-- COUNTRIES (schema:Country / schema:Place)
-- https://schema.org/Country
-- ================================================

CREATE TABLE IF NOT EXISTS countries (
    -- schema:identifier (ISO 3166-1 alpha-2)
    id TEXT PRIMARY KEY NOT NULL,
    -- schema:name
    name TEXT NOT NULL,
    -- Display
    flag_emoji TEXT,
    color TEXT,
    region TEXT,
    -- schema:inLanguage (primary)
    in_language TEXT DEFAULT 'en',
    timezone TEXT,
    -- Config
    enabled BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 0,
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================
-- ARTICLE SECTIONS (schema:articleSection)
-- Categories are "sections" in schema.org vocabulary
-- https://schema.org/articleSection
-- ================================================

CREATE TABLE IF NOT EXISTS article_sections (
    -- schema:identifier
    id TEXT PRIMARY KEY NOT NULL,
    -- schema:name
    name TEXT NOT NULL,
    -- schema:description
    description TEXT,
    -- Display metadata
    emoji TEXT,
    color TEXT,
    -- Classification keywords (JSON array for auto-categorization)
    classification_keywords JSONB DEFAULT '[]',
    -- Config
    enabled BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================
-- NEWS ORGANIZATIONS (schema:NewsMediaOrganization)
-- Merged from rss_sources + news_sources — single source table
-- https://schema.org/NewsMediaOrganization
-- ================================================

CREATE TABLE IF NOT EXISTS organizations (
    -- schema:identifier
    id TEXT PRIMARY KEY NOT NULL,
    -- schema:name
    name TEXT NOT NULL,
    -- schema:url (website)
    url TEXT,
    -- RSS feed URL (not a schema.org property, operational)
    rss_feed_url TEXT NOT NULL,
    -- schema:logo
    logo TEXT,
    -- schema:description
    description TEXT,
    -- schema:areaServed → country reference
    area_served TEXT REFERENCES countries(id),
    -- schema:inLanguage
    in_language TEXT DEFAULT 'en',
    -- schema:publishingPrinciples
    publishing_principles TEXT,
    -- Linked section (primary category)
    article_section_id TEXT REFERENCES article_sections(id),

    -- Operational config
    enabled BOOLEAN DEFAULT TRUE,
    verified BOOLEAN DEFAULT FALSE,
    priority INTEGER DEFAULT 3,
    fetch_interval_minutes INTEGER DEFAULT 60,

    -- Scraping config
    scraping_enabled BOOLEAN DEFAULT FALSE,
    scraping_selectors JSONB DEFAULT '{}',

    -- Health tracking
    health_status TEXT DEFAULT 'unknown'
        CHECK (health_status IN ('healthy', 'degraded', 'failing', 'critical', 'unknown')),
    last_fetched_at TIMESTAMPTZ,
    last_successful_fetch_at TIMESTAMPTZ,
    consecutive_failures INTEGER DEFAULT 0,
    total_fetch_count INTEGER DEFAULT 0,
    total_error_count INTEGER DEFAULT 0,
    last_error TEXT,
    last_error_at TIMESTAMPTZ,

    -- Quality metrics
    credibility_score REAL DEFAULT 1.0,
    quality_score REAL DEFAULT 0.0,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================
-- NEWS ARTICLES (schema:NewsArticle)
-- https://schema.org/NewsArticle
-- ================================================

CREATE TABLE IF NOT EXISTS articles (
    -- Internal ID (auto-generated)
    id SERIAL PRIMARY KEY,

    -- schema:headline (required, ≤110 chars recommended)
    headline TEXT NOT NULL,
    -- schema:alternativeHeadline
    alternative_headline TEXT,
    -- schema:description (summary/excerpt)
    description TEXT,
    -- schema:articleBody (full text content)
    article_body TEXT,
    -- Cleaned/processed version of articleBody
    article_body_processed TEXT,

    -- schema:url (canonical URL on our site, generated)
    slug TEXT UNIQUE,
    -- schema:mainEntityOfPage (original source URL)
    main_entity_of_page TEXT NOT NULL,
    -- RSS guid for deduplication
    rss_guid TEXT,

    -- schema:image (primary image URL)
    image TEXT,

    -- schema:author (denormalized author name for display)
    author_name TEXT,
    -- schema:author → byline text
    byline TEXT,

    -- schema:publisher → organization reference
    publisher_id TEXT NOT NULL REFERENCES organizations(id),
    -- Denormalized publisher name for display
    publisher_name TEXT NOT NULL,

    -- schema:articleSection → category reference
    article_section_id TEXT REFERENCES article_sections(id),
    -- schema:about → country reference
    about_country_id TEXT DEFAULT 'ZW' REFERENCES countries(id),

    -- schema:datePublished
    date_published TIMESTAMPTZ NOT NULL,
    -- schema:dateModified
    date_modified TIMESTAMPTZ,
    -- schema:dateCreated (when we ingested it)
    date_created TIMESTAMPTZ DEFAULT NOW(),

    -- schema:wordCount
    word_count INTEGER DEFAULT 0,
    -- Computed from wordCount (minutes)
    reading_time_minutes INTEGER DEFAULT 0,
    -- schema:inLanguage
    in_language TEXT DEFAULT 'en',

    -- schema:interactionStatistic (denormalized counters)
    view_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    bookmark_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    share_count INTEGER DEFAULT 0,

    -- schema:keywords (denormalized JSON array for quick access)
    keywords JSONB DEFAULT '[]',

    -- Content classification
    content_type TEXT DEFAULT 'article'
        CHECK (content_type IN ('article', 'news-byte', 'opinion', 'analysis', 'feature')),
    urgency TEXT DEFAULT 'standard'
        CHECK (urgency IN ('breaking', 'urgent', 'standard')),
    status TEXT DEFAULT 'published'
        CHECK (status IN ('published', 'draft', 'archived')),

    -- AI processing state
    ai_processed BOOLEAN DEFAULT FALSE,
    ai_processed_at TIMESTAMPTZ,
    ai_summary TEXT,
    content_hash TEXT,

    -- Quality and scoring
    quality_score REAL DEFAULT 0.0,
    engagement_score REAL DEFAULT 0.0,
    trending_score REAL DEFAULT 0.0,

    -- Embedding vector (1024-dim, stored as JSON array for sync portability)
    embedding JSONB,

    -- Sync tracking
    synced_at TIMESTAMPTZ,
    sync_status TEXT DEFAULT 'pending'
        CHECK (sync_status IN ('pending', 'synced', 'failed', 'conflict')),

    -- Updated timestamp
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================
-- PERSONS / AUTHORS (schema:Person)
-- https://schema.org/Person
-- ================================================

CREATE TABLE IF NOT EXISTS persons (
    id SERIAL PRIMARY KEY,
    -- schema:name
    name TEXT NOT NULL,
    -- Normalized for deduplication
    normalized_name TEXT NOT NULL UNIQUE,
    -- schema:identifier (URL-safe slug)
    slug TEXT UNIQUE,
    -- schema:description
    description TEXT,
    -- schema:jobTitle
    job_title TEXT,
    -- schema:worksFor → organization
    works_for TEXT,
    -- schema:email
    email TEXT,
    -- schema:image
    image TEXT,
    -- schema:sameAs (JSON array of social profile URLs)
    same_as JSONB DEFAULT '[]',

    -- Stats (denormalized)
    article_count INTEGER DEFAULT 0,
    total_views INTEGER DEFAULT 0,

    -- Verification
    verification_status TEXT DEFAULT 'unverified'
        CHECK (verification_status IN ('verified', 'unverified', 'flagged')),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Article ↔ Person junction (schema:author relationship)
CREATE TABLE IF NOT EXISTS article_authors (
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    -- schema:roleName
    role_name TEXT DEFAULT 'author'
        CHECK (role_name IN ('author', 'contributor', 'editor')),
    byline_position INTEGER DEFAULT 1,
    confidence REAL DEFAULT 1.0,
    extraction_method TEXT DEFAULT 'rss'
        CHECK (extraction_method IN ('rss', 'ai', 'manual')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (article_id, person_id)
);

-- ================================================
-- DEFINED TERMS / KEYWORDS (schema:DefinedTerm)
-- https://schema.org/DefinedTerm
-- ================================================

CREATE TABLE IF NOT EXISTS defined_terms (
    -- schema:identifier
    id TEXT PRIMARY KEY NOT NULL,
    -- schema:name
    name TEXT NOT NULL,
    -- schema:termCode (URL-safe slug)
    term_code TEXT UNIQUE,
    -- Term type
    term_type TEXT DEFAULT 'keyword'
        CHECK (term_type IN ('keyword', 'topic', 'entity', 'location')),
    -- Stats
    article_count INTEGER DEFAULT 0,
    -- Config
    enabled BOOLEAN DEFAULT TRUE,
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Article ↔ DefinedTerm junction (schema:keywords relationship)
CREATE TABLE IF NOT EXISTS article_keywords (
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    term_id TEXT NOT NULL REFERENCES defined_terms(id),
    relevance_score REAL DEFAULT 1.0,
    source TEXT DEFAULT 'auto'
        CHECK (source IN ('auto', 'ai', 'manual')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (article_id, term_id)
);

-- ================================================
-- TRENDING CACHE (operational, not schema.org)
-- ================================================

CREATE TABLE IF NOT EXISTS trending_cache (
    id SERIAL PRIMARY KEY,
    scope TEXT NOT NULL DEFAULT 'global',
    scope_id TEXT,
    term_id TEXT REFERENCES defined_terms(id),
    term_name TEXT NOT NULL,
    article_count INTEGER DEFAULT 0,
    score REAL DEFAULT 0.0,
    computed_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '1 hour'),
    UNIQUE (scope, scope_id, term_id)
);

-- ================================================
-- FEED COLLECTION LOG (operational)
-- ================================================

CREATE TABLE IF NOT EXISTS collection_log (
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

-- ================================================
-- SYNC LOG (tracks what's been synced to production D1)
-- ================================================

CREATE TABLE IF NOT EXISTS sync_log (
    id SERIAL PRIMARY KEY,
    sync_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    direction TEXT DEFAULT 'outbound'
        CHECK (direction IN ('outbound', 'inbound')),
    status TEXT NOT NULL
        CHECK (status IN ('pending', 'synced', 'failed', 'conflict')),
    error_message TEXT,
    synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================
-- INDEXES
-- ================================================

-- Articles: common query patterns
CREATE INDEX IF NOT EXISTS idx_articles_date_published ON articles(date_published DESC);
CREATE INDEX IF NOT EXISTS idx_articles_publisher ON articles(publisher_id);
CREATE INDEX IF NOT EXISTS idx_articles_section ON articles(article_section_id);
CREATE INDEX IF NOT EXISTS idx_articles_country ON articles(about_country_id);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_ai_processed ON articles(ai_processed) WHERE ai_processed = FALSE;
CREATE INDEX IF NOT EXISTS idx_articles_sync_status ON articles(sync_status) WHERE sync_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_articles_content_hash ON articles(content_hash);
CREATE INDEX IF NOT EXISTS idx_articles_rss_guid ON articles(rss_guid);
CREATE INDEX IF NOT EXISTS idx_articles_main_entity ON articles(main_entity_of_page);
CREATE INDEX IF NOT EXISTS idx_articles_engagement ON articles(engagement_score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_trending ON articles(trending_score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_updated ON articles(updated_at);

-- Organizations: health monitoring
CREATE INDEX IF NOT EXISTS idx_orgs_enabled ON organizations(enabled) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_orgs_health ON organizations(health_status);
CREATE INDEX IF NOT EXISTS idx_orgs_country ON organizations(area_served);

-- Persons
CREATE INDEX IF NOT EXISTS idx_persons_normalized ON persons(normalized_name);
CREATE INDEX IF NOT EXISTS idx_persons_article_count ON persons(article_count DESC);

-- Keywords
CREATE INDEX IF NOT EXISTS idx_terms_article_count ON defined_terms(article_count DESC);
CREATE INDEX IF NOT EXISTS idx_terms_type ON defined_terms(term_type);

-- Trending cache: auto-cleanup via expires_at
CREATE INDEX IF NOT EXISTS idx_trending_expires ON trending_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_trending_scope ON trending_cache(scope, scope_id);

-- Sync log
CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_log(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_sync_entity ON sync_log(entity_type, entity_id);

-- Collection log
CREATE INDEX IF NOT EXISTS idx_collection_created ON collection_log(created_at DESC);

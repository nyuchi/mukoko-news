-- Mukoko News Database Schema v2
-- D1 Database — schema.org aligned
-- Naming: schema.org property names in snake_case
--
-- Auth/users: OIDC via id.mukoko.com | Identity: Mobile & Web3
-- Content: synced from Fly.io Postgres worker

PRAGMA defer_foreign_keys=TRUE;

-- ================================================
-- COUNTRIES (schema:Country)
-- ================================================

CREATE TABLE IF NOT EXISTS countries (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    flag_emoji TEXT,
    color TEXT,
    region TEXT,
    in_language TEXT DEFAULT 'en',
    timezone TEXT,
    enabled BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================================
-- ARTICLE SECTIONS (schema:articleSection)
-- Replaces: categories
-- ================================================

CREATE TABLE IF NOT EXISTS article_sections (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    emoji TEXT,
    color TEXT,
    classification_keywords TEXT DEFAULT '[]',
    enabled BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================================
-- ORGANIZATIONS (schema:NewsMediaOrganization)
-- Replaces: rss_sources + news_sources (merged)
-- ================================================

CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    url TEXT,
    rss_feed_url TEXT NOT NULL,
    logo TEXT,
    description TEXT,
    area_served TEXT REFERENCES countries(id),
    in_language TEXT DEFAULT 'en',
    publishing_principles TEXT,
    article_section_id TEXT REFERENCES article_sections(id),
    enabled BOOLEAN DEFAULT TRUE,
    verified BOOLEAN DEFAULT FALSE,
    priority INTEGER DEFAULT 3,
    fetch_interval_minutes INTEGER DEFAULT 60,
    scraping_enabled BOOLEAN DEFAULT FALSE,
    scraping_selectors TEXT DEFAULT '{}',
    health_status TEXT DEFAULT 'unknown'
        CHECK (health_status IN ('healthy', 'degraded', 'failing', 'critical', 'unknown')),
    last_fetched_at DATETIME,
    last_successful_fetch_at DATETIME,
    consecutive_failures INTEGER DEFAULT 0,
    total_fetch_count INTEGER DEFAULT 0,
    total_error_count INTEGER DEFAULT 0,
    last_error TEXT,
    last_error_at DATETIME,
    credibility_score REAL DEFAULT 1.0,
    quality_score REAL DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================================
-- ARTICLES (schema:NewsArticle)
-- Replaces: articles
-- ================================================

CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- schema:headline
    headline TEXT NOT NULL,
    -- schema:alternativeHeadline
    alternative_headline TEXT,
    -- schema:description
    description TEXT,
    -- schema:articleBody
    article_body TEXT,
    -- Cleaned/processed version
    article_body_processed TEXT,
    -- schema:url (our slug)
    slug TEXT UNIQUE,
    -- schema:mainEntityOfPage (original source URL)
    main_entity_of_page TEXT NOT NULL,
    -- RSS dedup
    rss_guid TEXT,
    -- schema:image
    image TEXT,
    -- schema:author (denormalized)
    author_name TEXT,
    byline TEXT,
    -- schema:publisher
    publisher_id TEXT NOT NULL REFERENCES organizations(id),
    publisher_name TEXT NOT NULL,
    -- schema:articleSection
    article_section_id TEXT REFERENCES article_sections(id),
    -- schema:about (country)
    about_country_id TEXT DEFAULT 'ZW' REFERENCES countries(id),
    -- schema:datePublished
    date_published DATETIME NOT NULL,
    -- schema:dateModified
    date_modified DATETIME,
    -- schema:dateCreated (ingestion time)
    date_created DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- schema:wordCount
    word_count INTEGER DEFAULT 0,
    reading_time_minutes INTEGER DEFAULT 0,
    -- schema:inLanguage
    in_language TEXT DEFAULT 'en',
    -- schema:interactionStatistic (denormalized)
    view_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    bookmark_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    share_count INTEGER DEFAULT 0,
    -- schema:keywords (JSON array)
    keywords TEXT DEFAULT '[]',
    -- Classification
    content_type TEXT DEFAULT 'article'
        CHECK (content_type IN ('article', 'news-byte', 'opinion', 'analysis', 'feature')),
    urgency TEXT DEFAULT 'standard'
        CHECK (urgency IN ('breaking', 'urgent', 'standard')),
    status TEXT DEFAULT 'published'
        CHECK (status IN ('published', 'draft', 'archived')),
    -- AI processing
    ai_processed BOOLEAN DEFAULT FALSE,
    ai_processed_at DATETIME,
    ai_summary TEXT,
    content_hash TEXT,
    -- Scores
    quality_score REAL DEFAULT 0.0,
    engagement_score REAL DEFAULT 0.0,
    trending_score REAL DEFAULT 0.0,
    -- Sync tracking
    synced_at DATETIME,
    -- Updated
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ================================================
-- PERSONS (schema:Person)
-- Replaces: authors
-- ================================================

CREATE TABLE IF NOT EXISTS persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    slug TEXT UNIQUE,
    description TEXT,
    job_title TEXT,
    works_for TEXT,
    email TEXT,
    image TEXT,
    same_as TEXT DEFAULT '[]',
    article_count INTEGER DEFAULT 0,
    total_views INTEGER DEFAULT 0,
    verification_status TEXT DEFAULT 'unverified'
        CHECK (verification_status IN ('verified', 'unverified', 'flagged')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Article ↔ Person junction
CREATE TABLE IF NOT EXISTS article_authors (
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    role_name TEXT DEFAULT 'author'
        CHECK (role_name IN ('author', 'contributor', 'editor')),
    byline_position INTEGER DEFAULT 1,
    confidence REAL DEFAULT 1.0,
    extraction_method TEXT DEFAULT 'rss'
        CHECK (extraction_method IN ('rss', 'ai', 'manual')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (article_id, person_id)
);

-- ================================================
-- DEFINED TERMS / KEYWORDS (schema:DefinedTerm)
-- Replaces: keywords + article_keyword_links + article_keywords
-- ================================================

CREATE TABLE IF NOT EXISTS defined_terms (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    term_code TEXT UNIQUE,
    term_type TEXT DEFAULT 'keyword'
        CHECK (term_type IN ('keyword', 'topic', 'entity', 'location')),
    article_count INTEGER DEFAULT 0,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Article ↔ DefinedTerm junction
CREATE TABLE IF NOT EXISTS article_keywords (
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    term_id TEXT NOT NULL REFERENCES defined_terms(id),
    relevance_score REAL DEFAULT 1.0,
    source TEXT DEFAULT 'auto'
        CHECK (source IN ('auto', 'ai', 'manual')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (article_id, term_id)
);

-- ================================================
-- TRENDING CACHE
-- ================================================

CREATE TABLE IF NOT EXISTS trending_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL DEFAULT 'global',
    scope_id TEXT,
    term_id TEXT REFERENCES defined_terms(id),
    term_name TEXT NOT NULL,
    article_count INTEGER DEFAULT 0,
    score REAL DEFAULT 0.0,
    computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    UNIQUE (scope, scope_id, term_id)
);

-- ================================================
-- USER TABLES (OpenID Connect Standard Claims)
-- ================================================

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    sub TEXT UNIQUE,
    email TEXT UNIQUE,
    email_verified BOOLEAN DEFAULT FALSE,
    name TEXT,
    given_name TEXT,
    family_name TEXT,
    picture TEXT,
    phone_number TEXT,
    phone_number_verified BOOLEAN DEFAULT FALSE,
    username TEXT UNIQUE,
    bio TEXT,
    role TEXT NOT NULL DEFAULT 'user'
        CHECK (role IN ('admin', 'moderator', 'support', 'author', 'user')),
    status TEXT DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'deleted')),
    last_login_at TIMESTAMP,
    login_count INTEGER DEFAULT 0,
    preferences JSON DEFAULT '{}',
    locale TEXT DEFAULT 'en',
    zoneinfo TEXT,
    analytics_consent BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ================================================
-- AUTH PROVIDERS
-- ================================================

CREATE TABLE IF NOT EXISTS user_auth_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    provider_type TEXT NOT NULL CHECK (provider_type IN ('oidc', 'mobile', 'web3')),
    provider_name TEXT NOT NULL,
    is_primary BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMP,
    last_used_at TIMESTAMP,
    oidc_subject TEXT,
    oidc_issuer TEXT,
    mobile_number TEXT,
    mobile_country_code TEXT,
    mobile_verified BOOLEAN DEFAULT FALSE,
    wallet_address TEXT,
    chain_id INTEGER,
    ens_name TEXT,
    metadata JSON DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider_type, oidc_subject, oidc_issuer),
    UNIQUE(provider_type, mobile_number),
    UNIQUE(provider_type, wallet_address, chain_id)
);

-- ================================================
-- RBAC
-- ================================================

CREATE TABLE IF NOT EXISTS role_definitions (
    role TEXT PRIMARY KEY,
    level INTEGER NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    permissions JSON DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT OR REPLACE INTO role_definitions (role, level, display_name, description, permissions) VALUES
    ('admin', 100, 'Administrator', 'Full system access', '["*"]'),
    ('moderator', 75, 'Moderator', 'Content moderation', '["moderate:*", "view:*"]'),
    ('support', 50, 'Support', 'Customer support', '["support:*", "view:users"]'),
    ('author', 25, 'Author', 'Content creation', '["create:articles", "edit:own"]'),
    ('user', 10, 'User', 'Basic access', '["read:*", "create:comments"]');

-- ================================================
-- USER ENGAGEMENT
-- ================================================

CREATE TABLE IF NOT EXISTS user_bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    tags TEXT,
    notes TEXT,
    UNIQUE(user_id, article_id)
);

CREATE TABLE IF NOT EXISTS user_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, article_id)
);

CREATE TABLE IF NOT EXISTS user_reading_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    reading_time INTEGER DEFAULT 0,
    scroll_depth INTEGER DEFAULT 0,
    completion_percentage INTEGER DEFAULT 0,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_position_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    device_type TEXT,
    referrer TEXT,
    UNIQUE(user_id, article_id)
);

CREATE TABLE IF NOT EXISTS user_follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    follow_type TEXT NOT NULL CHECK (follow_type IN ('source', 'author', 'category')),
    follow_id TEXT NOT NULL,
    notify_on_new BOOLEAN DEFAULT TRUE,
    notify_on_trending BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, follow_type, follow_id)
);

-- ================================================
-- COMMENTS
-- ================================================

CREATE TABLE IF NOT EXISTS article_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_comment_id INTEGER REFERENCES article_comments(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    like_count INTEGER DEFAULT 0,
    reply_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'published'
        CHECK (status IN ('published', 'pending', 'flagged', 'deleted')),
    flagged_reason TEXT,
    moderated_by TEXT REFERENCES users(id),
    moderated_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS comment_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL REFERENCES article_comments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(comment_id, user_id)
);

-- ================================================
-- SYSTEM
-- ================================================

CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trusted_domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL UNIQUE,
    type TEXT DEFAULT 'image' CHECK (type IN ('image', 'content', 'analytics')),
    source_id TEXT,
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cron_execution_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cron_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('started', 'success', 'failed')),
    articles_fetched INTEGER DEFAULT 0,
    articles_processed INTEGER DEFAULT 0,
    errors_encountered INTEGER DEFAULT 0,
    execution_time INTEGER,
    error_message TEXT,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    actor_ip TEXT,
    old_values JSON,
    new_values JSON,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    request_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================================
-- INDEXES
-- ================================================

-- Countries
CREATE INDEX IF NOT EXISTS idx_countries_enabled ON countries(enabled);
CREATE INDEX IF NOT EXISTS idx_countries_priority ON countries(priority DESC);

-- Article sections
CREATE INDEX IF NOT EXISTS idx_sections_enabled ON article_sections(enabled);

-- Organizations
CREATE INDEX IF NOT EXISTS idx_orgs_enabled ON organizations(enabled);
CREATE INDEX IF NOT EXISTS idx_orgs_health ON organizations(health_status);
CREATE INDEX IF NOT EXISTS idx_orgs_country ON organizations(area_served);

-- Articles (primary query patterns)
CREATE INDEX IF NOT EXISTS idx_articles_date_published ON articles(date_published DESC);
CREATE INDEX IF NOT EXISTS idx_articles_publisher ON articles(publisher_id);
CREATE INDEX IF NOT EXISTS idx_articles_section ON articles(article_section_id);
CREATE INDEX IF NOT EXISTS idx_articles_country ON articles(about_country_id);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug);
CREATE INDEX IF NOT EXISTS idx_articles_rss_guid ON articles(rss_guid);
CREATE INDEX IF NOT EXISTS idx_articles_content_hash ON articles(content_hash);
CREATE INDEX IF NOT EXISTS idx_articles_engagement ON articles(engagement_score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_trending ON articles(trending_score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_content_type ON articles(content_type);
-- Compound indexes for feed queries
CREATE INDEX IF NOT EXISTS idx_articles_status_published ON articles(status, date_published DESC);
CREATE INDEX IF NOT EXISTS idx_articles_status_country ON articles(status, about_country_id, date_published DESC);
CREATE INDEX IF NOT EXISTS idx_articles_status_section ON articles(status, article_section_id, date_published DESC);
CREATE INDEX IF NOT EXISTS idx_articles_status_country_section ON articles(status, about_country_id, article_section_id, date_published DESC);

-- Persons
CREATE INDEX IF NOT EXISTS idx_persons_normalized ON persons(normalized_name);
CREATE INDEX IF NOT EXISTS idx_persons_slug ON persons(slug);
CREATE INDEX IF NOT EXISTS idx_persons_article_count ON persons(article_count DESC);

-- Keywords
CREATE INDEX IF NOT EXISTS idx_terms_name ON defined_terms(name);
CREATE INDEX IF NOT EXISTS idx_terms_article_count ON defined_terms(article_count DESC);
CREATE INDEX IF NOT EXISTS idx_article_keywords_article ON article_keywords(article_id);
CREATE INDEX IF NOT EXISTS idx_article_keywords_term ON article_keywords(term_id);

-- Trending
CREATE INDEX IF NOT EXISTS idx_trending_scope ON trending_cache(scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_trending_expires ON trending_cache(expires_at);

-- Users
CREATE INDEX IF NOT EXISTS idx_users_sub ON users(sub);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- User engagement
CREATE INDEX IF NOT EXISTS idx_user_bookmarks_user ON user_bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_user_bookmarks_article ON user_bookmarks(article_id);
CREATE INDEX IF NOT EXISTS idx_user_likes_user ON user_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_likes_article ON user_likes(article_id);
CREATE INDEX IF NOT EXISTS idx_reading_history_user ON user_reading_history(user_id);
CREATE INDEX IF NOT EXISTS idx_reading_history_article ON user_reading_history(article_id);

-- Comments
CREATE INDEX IF NOT EXISTS idx_comments_article ON article_comments(article_id);
CREATE INDEX IF NOT EXISTS idx_comments_user ON article_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON article_comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_comments_status ON article_comments(status);

-- Trusted domains
CREATE INDEX IF NOT EXISTS idx_trusted_domains_source ON trusted_domains(source_id);

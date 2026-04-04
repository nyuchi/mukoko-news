-- Schema alignment with mukoko-platform (Schema.org camelCase)
-- Applied 2026-03-30

-- ═══════════════════════════════════════════
-- identity.person — match platform exactly
-- ═══════════════════════════════════════════

-- Auth
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS auth_method TEXT DEFAULT 'email_otp';
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_identity_person_stytch
    ON identity.person (stytch_user_id) WHERE stytch_user_id IS NOT NULL;

-- Name parts (Schema.org Person)
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS additionalname TEXT;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS honorificprefix TEXT;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS honorificsuffix TEXT;

-- Demographics
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS birthdate DATE;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS deathdate DATE;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS gender TEXT;

-- Location & contact
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS address JSONB;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS nationality JSONB;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS contactpoint JSONB;

-- Professional (Schema.org camelCase)
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS jobtitle TEXT;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS worksfor JSONB;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS affiliation JSONB;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS alumniof JSONB;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS knowslanguage TEXT[];
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS description TEXT;

-- Session tracking (match platform)
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS stytch_session_id TEXT;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS last_login_method TEXT;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS last_login_platform TEXT;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS registered_devices JSONB DEFAULT '[]'::jsonb;

-- Web3 identity
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS nft_identity_token_id TEXT;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS nft_identity_blockchain TEXT;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS nft_identity_contract_address TEXT;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS nft_identity_token_uri TEXT;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS nft_identity_ipfs_hash TEXT;

-- Sync
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS d1_person_id BIGINT;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS d1_synced_at TIMESTAMPTZ;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS sync_version INTEGER DEFAULT 1;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- ═══════════════════════════════════════════
-- news.news_article — Schema.org naming
-- ═══════════════════════════════════════════

ALTER TABLE news.news_article RENAME COLUMN status TO creativeworkstatus;
ALTER TABLE news.news_article ADD COLUMN IF NOT EXISTS bookmark_count INTEGER DEFAULT 0;

-- ═══════════════════════════════════════════
-- engagement — match platform tables
-- ═══════════════════════════════════════════

ALTER TABLE engagement.interest_category RENAME COLUMN parent_id TO parent_category_id;

CREATE TABLE IF NOT EXISTS engagement.interaction_counter (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "forType" TEXT NOT NULL,
    "forId" UUID NOT NULL,
    "interactionType" TEXT NOT NULL,
    "userInteractionCount" INTEGER DEFAULT 0,
    last_updated TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engagement.user_action (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent UUID REFERENCES identity.person(id),
    actiontype TEXT NOT NULL,
    object_type TEXT NOT NULL,
    object_id UUID NOT NULL,
    starttime TIMESTAMPTZ DEFAULT now(),
    endtime TIMESTAMPTZ,
    result JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engagement.follow_action (
    follower_person_id UUID NOT NULL REFERENCES identity.person(id),
    followed_type TEXT NOT NULL,
    followed_id UUID NOT NULL,
    starttime TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (follower_person_id, followed_type, followed_id)
);

CREATE TABLE IF NOT EXISTS engagement.recommendation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID REFERENCES identity.person(id),
    itemoffered_type TEXT NOT NULL,
    itemoffered_id UUID NOT NULL,
    score REAL,
    reasoning TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engagement.unverified_interaction (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID REFERENCES identity.person(id),
    content_id TEXT NOT NULL,
    content_type TEXT NOT NULL,
    interaction_type TEXT NOT NULL,
    duration_seconds INTEGER,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engagement.interest_keyword (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES engagement.interest_category(id),
    keyword TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════
-- places schema — match platform
-- ═══════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS places;

CREATE TABLE IF NOT EXISTS places.countries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    iso_code CHAR(2) NOT NULL UNIQUE,
    continent TEXT,
    currency_code CHAR(3),
    phone_code TEXT,
    flag_emoji TEXT,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO places.countries (name, iso_code, continent, currency_code, phone_code, flag_emoji) VALUES
('Zimbabwe', 'ZW', 'Africa', 'ZWL', '+263', '🇿🇼'),
('South Africa', 'ZA', 'Africa', 'ZAR', '+27', '🇿🇦'),
('Kenya', 'KE', 'Africa', 'KES', '+254', '🇰🇪'),
('Nigeria', 'NG', 'Africa', 'NGN', '+234', '🇳🇬'),
('Ghana', 'GH', 'Africa', 'GHS', '+233', '🇬🇭'),
('Tanzania', 'TZ', 'Africa', 'TZS', '+255', '🇹🇿'),
('Uganda', 'UG', 'Africa', 'UGX', '+256', '🇺🇬'),
('Rwanda', 'RW', 'Africa', 'RWF', '+250', '🇷🇼'),
('Ethiopia', 'ET', 'Africa', 'ETB', '+251', '🇪🇹'),
('Botswana', 'BW', 'Africa', 'BWP', '+267', '🇧🇼'),
('Zambia', 'ZM', 'Africa', 'ZMW', '+260', '🇿🇲'),
('Malawi', 'MW', 'Africa', 'MWK', '+265', '🇲🇼'),
('Egypt', 'EG', 'Africa', 'EGP', '+20', '🇪🇬'),
('Morocco', 'MA', 'Africa', 'MAD', '+212', '🇲🇦'),
('Namibia', 'NA', 'Africa', 'NAD', '+264', '🇳🇦'),
('Mozambique', 'MZ', 'Africa', 'MZN', '+258', '🇲🇿')
ON CONFLICT (iso_code) DO NOTHING;

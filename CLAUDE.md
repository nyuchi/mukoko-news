# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mukoko News is a **Pan-African news platform & API**. "Mukoko" means "Beehive" in Shona — where community gathers and stores knowledge. Primary market is Zimbabwe with expansion across 16 African countries.

**This is a platform, not a consumer app.** The interactive reading experience (feeds, NewsBytes, personalized content, saved articles) is migrating to the **Mukoko super app** (`app.mukoko.com`). This repository is the **news platform layer**: backend API, publisher onboarding, content moderation, MCP server, embed widgets, RSS distribution, open data analytics, and admin management.

### Three Codebases

| Directory | Runtime | Purpose |
|-----------|---------|---------|
| `src/` | Next.js 15 on Vercel | Platform dashboard + consumer pages (migrating out) |
| `fly-worker/` | FastAPI on Fly.io | **Production news API** — RSS ingestion, AI processing, engagement, search |
| `mcp-server/` | Node.js (stdio) | **MCP server** — Model Context Protocol for AI clients |
| `backend/services/platform/` | TypeScript (design) | **Platform services** — publisher, webhooks, API keys, moderation (next migration target to fly-worker) |
| `database/migrations/` | SQL | Schema migrations (Postgres + platform tables) |

> **Note on `backend/`**: The Cloudflare Workers HTTP layer (Hono) is archived and no longer deployed. However, `backend/services/platform/` contains the **active design** for 10 platform services that are the next migration target to fly-worker. Do not treat `backend/` as entirely dead.

## Common Commands

### Frontend (Root Level)

```bash
npm run dev              # Start Next.js dev server (port 3000)
npm run build            # Build for production
npm run start            # Start production server
npm run lint             # ESLint check
npm run lint:fix         # ESLint auto-fix
npm run typecheck        # TypeScript check
npm run test             # Vitest single run
npm run test:watch       # Vitest watch mode
npm run test:coverage    # Vitest with v8 coverage
npm run clean            # Clean build artifacts
```

### Backend (`cd fly-worker`)

```bash
uvicorn src.main:app --reload --port 8080  # Local dev server
pytest                                      # Run tests
pytest --cov                                # Tests with coverage
pyright                                     # Type checking
ruff check .                                # Lint

# Deployment (Fly.io)
fly deploy                                  # Deploy to production
fly secrets set KEY=VALUE                   # Set environment secrets
fly logs                                    # View production logs
```

### MCP Server (`cd mcp-server`)

```bash
npm install              # Install dependencies
node src/index.js        # Run MCP server (stdio transport)
```

## Architecture

### Platform Layer (This Repo)

```
┌──────────────────────────────────────────────────────────────────┐
│  PLATFORM FRONTEND — Next.js 15 (Vercel) — news.mukoko.com      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ /platform/*          Platform Dashboard                    │  │
│  │   /publishers        Publisher claiming & verification     │  │
│  │   /authors           Author portal                         │  │
│  │   /tools/embed       Widget builder                        │  │
│  │   /tools/mcp         MCP server setup docs                 │  │
│  │   /tools/rss         RSS feed configuration                │  │
│  │   /feed              Publisher feed management              │  │
│  ├────────────────────────────────────────────────────────────┤  │
│  │ /admin/*             Admin Dashboard (sources, users, etc) │  │
│  ├────────────────────────────────────────────────────────────┤  │
│  │ CONSUMER PAGES (migrating to super app)                    │  │
│  │   / /discover /newsbytes /search /saved /profile /insights │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────┬───────────────────────────────────────────┘
                       │ Bearer Token Auth (API_SECRET)
┌──────────────────────┼───────────────────────────────────────────┐
│  NEWS API — FastAPI on Fly.io — mukoko-news-api.fly.dev          │
│  12 API Routers (42+ endpoints) + 6 Background Jobs              │
│  ┌──────────┬──────────┬──────────┬──────────────────┐           │
│  │ Postgres │ CouchDB  │ Doris    │ Anthropic Claude │           │
│  │ Supabase │ Doc Store│ Analytics│ AI Processing    │           │
│  └──────────┴──────────┴──────────┴──────────────────┘           │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  MCP SERVER — @mukoko/mcp-server — stdio transport               │
│  9 tools + 5 resources for Claude Desktop, Claude Code, Cursor   │
└──────────────────────────────────────────────────────────────────┘
```

### Frontend Stack

- **Framework**: Next.js 15 with App Router
- **UI**: Tailwind CSS 4.x with custom design tokens
- **Components**: Radix UI primitives (Avatar, Dialog, Dropdown, Tabs, etc.)
- **Icons**: Lucide React
- **Theme**: next-themes for dark mode support
- **TypeScript**: Full type safety with strict mode
- **State**: React Context (ThemeContext, PreferencesContext)

### Backend Stack (fly-worker)

- **Runtime**: Fly.io (JNB region, shared CPU, 1GB RAM)
- **Framework**: FastAPI (Python)
- **Database**: Postgres (Supabase, direct connection via asyncpg)
- **Document Store**: CouchDB (article body storage, non-blocking writes)
- **Analytics**: Apache Doris (search indexing, engagement metrics)
- **AI**: Anthropic Claude (keyword extraction, quality scoring)
- **Search**: Hybrid Doris funnel + Postgres hydration (ILIKE fallback)
- **Auth**: Bearer token (API_SECRET), OIDC JWT from id.mukoko.com (planned)

### MCP Server Stack

- **Package**: `@mukoko/mcp-server` v1.0.0
- **SDK**: `@modelcontextprotocol/sdk` v1.12.1
- **Transport**: Stdio (for Claude Desktop, Claude Code, Cursor)
- **API**: Connects to `https://mukoko-news-api.fly.dev` with Bearer token
- **Validation**: Zod schemas for all tool inputs

### Backend Services Pattern

Services are in `fly-worker/src/services/`:

- `rss_parser.py` - RSS/Atom feed parsing (feedparser)
- `content_cleaner.py` - HTML cleaning, text extraction, word counting
- `keyword_extractor.py` - 3-stage keyword extraction (DB → section → AI)
- `quality_scorer.py` - Deterministic quality scoring (textstat, 0-100)
- `ai_client.py` - Anthropic Claude client (singleton)
- `analytics.py` - In-memory event buffer, flushes to Doris every 30s
- `couchdb.py` - CouchDB async HTTP client
- `doris.py` - Apache Doris HTTP API client

### Background Jobs (`fly-worker/src/jobs/`)

| Job | Trigger | What It Does |
|-----|---------|-------------|
| `rss_collector` | Every 15 min | Fetch RSS, parse, insert, AI processing |
| `engagement` | Every 5 min | Recalculate engagement scores |
| `trending` | Every 30 min | Refresh trending keyword cache |
| `health_checker` | Every 6 hours | Evaluate source health status |
| `analytics_flush` | Every 30 sec | Flush analytics buffer to Doris |
| `cleanup` | Daily @ 3 UTC | Delete old articles, orphaned data |

### Access Control

- **Admin routes** (`/api/admin/*`) - Protected, requires ADMIN_SESSION_SECRET
- **API routes** (`/api/*`) - Protected with bearer token (API_SECRET or OIDC JWT)
- **Public routes** - `/api/health`, `/api/analytics/*`
- **Platform API keys** (planned) - 5-tier self-service keys (free → enterprise)

### Design System (Nyuchi Brand v6)

**Colors** (African Minerals palette):
- Primary: Tanzanite (#4B0082)
- Secondary: Cobalt (#0047AB)
- Accent: Gold (#5D4037)
- Success: Malachite (#2E8B57)
- Warning: Terracotta (#E07A4D)
- Surface: Warm Cream (#FAF9F5) for light mode

**Typography**:
- Headings: Noto Serif
- Body: Plus Jakarta Sans

**Spacing**:
- Border radius: 12px buttons, 16px cards
- WCAG AAA compliant (7:1 contrast ratio)

## Frontend Structure

```text
src/
├── app/                     # Next.js App Router
│   ├── layout.tsx           # Root layout with providers
│   ├── page.tsx             # Home feed page (migrating to super app)
│   ├── globals.css          # Tailwind styles and CSS variables
│   │
│   ├── platform/            # ── PLATFORM DASHBOARD ──
│   │   ├── layout.tsx       # Platform layout with sidebar nav
│   │   ├── page.tsx         # Dashboard: stats, quick actions, features, super app banner
│   │   ├── publishers/
│   │   │   └── page.tsx     # Claim/verify news sources (4-step onboarding)
│   │   ├── authors/
│   │   │   └── page.tsx     # Author portal (blog connect, API publish, write on platform)
│   │   ├── feed/
│   │   │   └── page.tsx     # Publisher feed management
│   │   └── tools/
│   │       ├── page.tsx     # Tools hub (embed, MCP, RSS)
│   │       ├── embed/
│   │       │   └── page.tsx # Widget builder (5 layouts, 4 feed types)
│   │       ├── mcp/
│   │       │   └── page.tsx # MCP server setup (Claude Desktop, Code, Cursor)
│   │       └── rss/
│   │           └── page.tsx # RSS feed config (country + category feeds)
│   │
│   ├── admin/               # ── ADMIN DASHBOARD ──
│   │   ├── analytics/       # Admin analytics
│   │   ├── sources/         # RSS source management
│   │   ├── system/          # System settings
│   │   └── users/           # User management
│   │
│   ├── embed/               # ── EMBEDDABLE WIDGETS ──
│   │   ├── page.tsx         # Embed documentation & live preview
│   │   ├── layout.tsx       # Embed SEO metadata
│   │   ├── iframe/
│   │   │   ├── page.tsx     # Iframe renderer (5 layouts, 4 feed types)
│   │   │   └── layout.tsx   # Iframe layout with Suspense
│   │   └── __tests__/
│   │       ├── embed-iframe.test.tsx  # Widget rendering (42 tests)
│   │       └── widget.test.ts        # widget.js behavior (38 tests)
│   │
│   ├── sources/             # ── NEWS SOURCES DIRECTORY ──
│   │   ├── page.tsx         # Sources with search, filter, sort, health
│   │   ├── layout.tsx       # Sources SEO metadata
│   │   └── __tests__/
│   │       └── sources-page.test.tsx  # Sources page tests (13 tests)
│   │
│   ├── article/[id]/        # Article detail page
│   ├── categories/          # Categories page
│   │
│   │   # ── CONSUMER PAGES (migrating to Mukoko super app) ──
│   ├── discover/            # Discover page (country/category/tag cloud)
│   ├── newsbytes/           # TikTok-style vertical feed
│   ├── search/              # Search page
│   ├── profile/             # User profile/settings
│   ├── saved/               # Saved articles
│   ├── insights/            # Analytics insights
│   │
│   ├── help/                # Help pages
│   ├── privacy/             # Privacy policy
│   └── terms/               # Terms of service
│
├── components/
│   ├── layout/
│   │   ├── header.tsx       # Navigation header
│   │   ├── footer.tsx       # Footer component
│   │   └── bottom-nav.tsx   # Mobile bottom navigation
│   ├── ui/                  # Reusable UI components (Radix UI based)
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── avatar.tsx
│   │   ├── category-chip.tsx
│   │   ├── theme-toggle.tsx
│   │   ├── engagement-bar.tsx
│   │   ├── source-icon.tsx
│   │   ├── error-boundary.tsx  # React error boundary component
│   │   ├── skeleton.tsx        # Skeleton loading components
│   │   ├── discover-skeleton.tsx # Page-specific skeletons
│   │   ├── json-ld.tsx         # Schema.org JSON-LD components (8 types)
│   │   └── breadcrumb.tsx      # Breadcrumb navigation
│   ├── article-card.tsx     # Main article display component
│   ├── hero-card.tsx        # Featured article card with large image
│   ├── compact-card.tsx     # Text-focused card for articles without images
│   ├── share-modal.tsx      # Share/engagement modal
│   ├── onboarding-modal.tsx # Country/category selection
│   ├── theme-provider.tsx   # Theme context provider
│   └── __tests__/           # Component tests
│       ├── article-card.test.tsx
│       ├── engagement-bar.test.tsx
│       ├── share-modal.test.tsx
│       ├── onboarding-modal.test.tsx
│       ├── story-cluster.test.tsx
│       ├── hero-card.test.tsx
│       ├── compact-card.test.tsx
│       ├── json-ld.test.tsx
│       ├── bottom-nav.test.tsx
│       ├── breadcrumb.test.tsx
│       └── error-boundary.test.tsx
├── contexts/
│   ├── preferences-context.tsx # User preferences (countries, categories)
│   └── __tests__/
│       └── preferences-context.test.tsx
└── lib/
    ├── api.ts               # API client with fetch utilities
    ├── utils.ts             # Utility functions (cn, formatTimeAgo, isValidImageUrl, safeCssUrl)
    ├── constants.ts         # Centralized countries and categories data
    ├── source-profiles.ts   # News source configurations
    └── __tests__/
        ├── api.test.ts      # Tests for API client
        ├── utils.test.ts    # Tests for utility functions
        └── constants.test.ts # Tests for constants and helpers
```

## Backend Structure

```text
fly-worker/                  # ── PRODUCTION NEWS API ──
├── src/
│   ├── main.py              # FastAPI app, CORS, router registration, lifespan
│   ├── config.py            # pydantic-settings configuration
│   ├── db.py                # asyncpg connection pool, migrations
│   ├── scheduler.py         # APScheduler background job configuration
│   ├── api/                 # API routers (12 modules)
│   │   ├── auth.py          # Bearer token authentication
│   │   ├── feeds.py         # /api/feeds, /api/feeds/sectioned, /api/news-bytes
│   │   ├── articles.py      # /api/article/:id, /api/article/:id/related
│   │   ├── categories.py    # /api/categories, /api/trending-categories
│   │   ├── sources.py       # /api/sources, /api/countries
│   │   ├── search.py        # /api/search, /api/keywords
│   │   ├── engagement.py    # /api/articles/:id/like|save|view|engagement
│   │   ├── stories.py       # /api/stories/trending, /api/stories/cluster/:id
│   │   ├── authors.py       # /api/authors, /api/trending-authors, /api/featured-authors
│   │   ├── stats.py         # /api/health, /api/stats
│   │   ├── admin.py         # /api/admin/* (6 endpoints)
│   │   ├── analytics.py     # /api/analytics/* (8 public open data endpoints)
│   │   └── user.py          # /api/user/bookmarks (stub)
│   ├── jobs/                # Background jobs (6 scheduled)
│   │   ├── rss_collector.py # RSS fetch + AI processing pipeline
│   │   ├── ai_processor.py  # Keyword extraction + quality scoring
│   │   ├── engagement.py    # Engagement score recalculation
│   │   ├── trending.py      # Trending cache refresh
│   │   ├── health_checker.py # Source health evaluation
│   │   └── cleanup.py       # Daily data cleanup
│   └── services/            # Business logic
│       ├── ai_client.py     # Anthropic Claude singleton
│       ├── rss_parser.py    # RSS/Atom parsing (feedparser)
│       ├── content_cleaner.py # HTML cleaning, text extraction
│       ├── keyword_extractor.py # 3-stage keyword extraction
│       ├── quality_scorer.py # Textstat-based quality scoring
│       ├── analytics.py     # Event buffer → Doris
│       ├── couchdb.py       # CouchDB async client
│       └── doris.py         # Apache Doris HTTP client
├── tests/                   # pytest test suite
├── fly.toml                 # Fly.io deployment config
├── pyproject.toml           # Python project config
└── requirements.txt         # Python dependencies
```

```text
mcp-server/                  # ── MCP SERVER ──
├── src/
│   └── index.js             # MCP server (9 tools, 5 resources)
├── package.json             # @mukoko/mcp-server, bin: mukoko-mcp
└── node_modules/
```

```text
backend/                     # ── PLATFORM SERVICES (design, migration target) ──
├── services/
│   └── platform/            # 10 TypeScript platform services
│       ├── index.ts         # Service exports & types
│       ├── PublisherService.ts      # Publisher registration, DNS verification, article push
│       ├── APIKeyService.ts         # 5-tier API key management (free→enterprise)
│       ├── WebhookService.ts        # Event-driven webhooks, HMAC signing, retry
│       ├── ContentModerationService.ts # AI moderation, cultural alignment, fact-checking
│       ├── OpenDataService.ts       # Open data manifesto, bulk export, PII audit
│       ├── SmartHomeBriefingService.ts # Alexa, Google Assistant, HomePod briefings
│       ├── SSEStreamService.ts      # Server-sent events for real-time updates
│       ├── FeedOutputService.ts     # Feed formatting & output
│       └── DynamicDataService.ts    # Dynamic categories, keywords, sources, countries
└── ...                      # Archived Cloudflare Workers HTTP layer (Hono)
```

```text
database/
└── migrations/
    ├── ...                  # Core schema migrations
    └── 024_platform_services_tables.sql  # Platform tables (11 tables + seed data)
```

## MCP Server

The MCP server (`mcp-server/`) exposes the Mukoko News API to any MCP-compatible AI client.

### Tools (9)

| Tool | Endpoint | Description |
|------|----------|-------------|
| `search_articles` | GET /api/search | Search articles by query, country, category |
| `get_latest_articles` | GET /api/feeds | Latest articles with filtering and sorting |
| `get_article` | GET /api/article/:id | Single article by UUID or slug |
| `get_trending` | GET /api/stories/trending | Trending story clusters |
| `get_news_bytes` | GET /api/news-bytes | Short-form articles for quick consumption |
| `get_related_articles` | GET /api/article/:id/related | Related articles by keyword overlap |
| `list_sources` | GET /api/sources | All RSS sources with health status |
| `get_stats` | GET /api/stats | Platform statistics |
| `get_keywords` | GET /api/keywords | Trending keywords for topics |

### Resources (5)

| URI | Description |
|-----|-------------|
| `mukoko://openapi` | OpenAPI 3.0 schema reference |
| `mukoko://countries` | All 16 Pan-African countries |
| `mukoko://categories` | Content categories with article counts |
| `mukoko://sources` | News sources with health status |
| `mukoko://keywords` | Trending keywords |

### Client Setup

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "mukoko-news": {
      "command": "node",
      "args": ["/path/to/mcp-server/src/index.js"],
      "env": { "MUKOKO_API_SECRET": "your-secret" }
    }
  }
}
```

**Claude Code**: `claude mcp add mukoko-news node /path/to/mcp-server/src/index.js`

**Environment**: `MUKOKO_API_SECRET` (required), `MUKOKO_API_URL` (optional, defaults to production)

## Platform Services

These services are defined in `backend/services/platform/` (TypeScript) and are the next migration target to `fly-worker/` (Python). They represent the B2B/B2D platform capabilities.

### Publisher Portal

**Service**: `PublisherService.ts` | **Frontend**: `src/app/platform/publishers/page.tsx`

Publishers can claim ownership of news sources aggregated by Mukoko:

1. **Find Source** — Search the directory of aggregated sources
2. **Verify Ownership** — DNS TXT record verification (`mukoko-verify=<token>`)
3. **Connect API** — Direct article push via REST API (like Apple News)
4. **Manage & Monitor** — Analytics, content appearance, metadata control

**Verification Levels**:
- `unverified` → Submitted application, awaiting review
- `basic` → Domain ownership verified via DNS
- `verified` → Editorial review passed, organization confirmed
- `premium` → Partnership agreement, priority distribution

Verified and premium publishers get auto-approval for submitted articles.

### API Key Management

**Service**: `APIKeyService.ts`

| Tier | Rate Limit | Permissions | Price |
|------|-----------|-------------|-------|
| `free` | 100/day, 1/sec | Public data read-only | Free |
| `developer` | 10,000/day, 10/sec | Full API read | $29/mo |
| `business` | 100,000/day, 50/sec | Full API + batch | $149/mo |
| `enterprise` | Unlimited, 200/sec | Full API + batch + webhooks + SLA | Contact |
| `open_data` | Unlimited, 5/sec | Public analytics read-only | Free |

Key format: `mk_live_xxxx` (standard), `mk_od_xxxx` (open data). SHA-256 hashed at rest.

### Webhook System

**Service**: `WebhookService.ts`

14 event types across 5 categories:
- **Articles**: `article.published`, `article.updated`, `article.deleted`, `article.flagged`
- **Breaking**: `breaking_news`
- **Sources**: `source.added`, `source.removed`, `source.health_changed`
- **Categories**: `category.created`, `category.trending`
- **Keywords**: `keyword.discovered`, `keyword.trending`
- **Publishers**: `publisher.verified`, `publisher.article_submitted`
- **Moderation**: `moderation.completed`

Features: HMAC-SHA256 signing, filters (countries, categories, min_quality_score), exponential backoff retry (2s, 4s, 8s), delivery audit trail.

### Content Moderation

**Service**: `ContentModerationService.ts`

11 flag types: fake_news, misleading, hate_speech, incitement, bias, stereotype, unverified, manipulative, plagiarism, quality, cultural_insensitivity.

- **Cultural alignment scoring**: African perspective, local context, respectful language, community relevance
- **Fact-check signals**: claim detection, verifiability, sources cited, known misinformation patterns
- Auto-approve threshold: 80+, auto-flag threshold: <40

### Open Data

**Service**: `OpenDataService.ts`

Mukoko is an open data platform. All non-PII analytics are public (`/api/analytics/*` — no auth required).

- License: CC BY 4.0
- Data categories: Articles, Sources, Categories, Keywords, Analytics
- Privacy boundary: No PII (emails, phone numbers, IPs, device IDs, precise location)
- Access: API, RSS/Atom feeds, CouchDB replication, bulk CSV export

### Smart Home Briefings

**Service**: `SmartHomeBriefingService.ts`

- **Alexa Flash Briefing**: uid, updateDate, titleText, mainText, redirectionUrl
- **Google Assistant**: speech, displayText, carousel items
- **Apple HomePod**: SSML markup for voice-friendly output
- **Generic IoT**: greeting, summary, stories, metadata

Time-aware greetings, country/category filtering, configurable story limits.

### SSE Streaming

**Service**: `SSEStreamService.ts`

Real-time Server-Sent Events for: new articles, breaking news, trending updates, source health changes. Event log for client reconnection replay.

## Platform Database Tables

Defined in `database/migrations/024_platform_services_tables.sql` (11 tables):

| Table | Purpose |
|-------|---------|
| `api_keys` | Self-service developer keys (tier, permissions, rate limits, usage) |
| `publishers` | Publisher registration & verification (domain, level, token, analytics) |
| `webhook_subscriptions` | Event subscriptions (url, events, secret, filters, failure tracking) |
| `webhook_deliveries` | Delivery audit trail (status, attempts, response, retry schedule) |
| `content_moderation_log` | AI moderation results (score, flags, recommendation, cultural alignment) |
| `keywords` | Auto-discovered trending keywords (term, slug, trending_score, aliases) |
| `dynamic_sources` | Extended source management (verified, added_by: system/admin/publisher/discovery) |
| `dynamic_countries` | Database-driven country config (currencies, timezones, languages) |
| `tags` | Entity/topic/location/event/person/organization tags |
| `pii_audit_log` | PII removal tracking for open data compliance |
| `sse_event_log` | Event log for SSE client reconnection replay |

Seed data: All 16 Pan-African countries with currencies, timezones, languages.

## Database

**Postgres** (Supabase) with schemas: `public`, `news`, `engagement`, `identity`, `system`, `sync`.

Migrations in `fly-worker/src/db.py` (applied via `_migrations` tracking table).
Platform migrations in `database/migrations/024_platform_services_tables.sql`.

**Key Tables** (news schema): `news_article`, `feed_source`, `news_media_organization`, `defined_term`, `article_keyword`, `article_authorship`, `trending_cache`, `country`, `collection_log`

**Key Tables** (other schemas): `engagement.interest_category`, `identity.person`, `system.collection_log`

**Platform Tables**: `api_keys`, `publishers`, `webhook_subscriptions`, `webhook_deliveries`, `content_moderation_log`, `keywords`, `dynamic_sources`, `dynamic_countries`, `tags`, `pii_audit_log`, `sse_event_log`

## Schema.org Compliance

All content follows [Schema.org](https://schema.org) conventions. JSON-LD structured data is rendered via `src/components/ui/json-ld.tsx` with XSS prevention (`safeJsonLdStringify()`).

### Implemented Schema.org Types (8)

| Component | Schema.org Type | Where Used |
|-----------|----------------|------------|
| `ArticleJsonLd` | [NewsArticle](https://schema.org/NewsArticle) | Article detail pages (`/article/[id]`) |
| `OrganizationJsonLd` | [Organization](https://schema.org/Organization) | Root layout (`layout.tsx`) |
| `BreadcrumbJsonLd` | [BreadcrumbList](https://schema.org/BreadcrumbList) | Article pages, category pages |
| `WebSiteJsonLd` | [WebSite](https://schema.org/WebSite) | Root layout |
| `WebPageJsonLd` | [WebPage](https://schema.org/WebPage) | Static pages (help, privacy, terms) |
| `ItemListJsonLd` | [ItemList](https://schema.org/ItemList) | Feed pages, search results |
| `CollectionPageJsonLd` | [CollectionPage](https://schema.org/CollectionPage) | Discover page, categories |
| `SoftwareApplicationJsonLd` | [SoftwareApplication](https://schema.org/SoftwareApplication) | App promotion |

### Schema.org in API Responses

All API article responses follow Schema.org `NewsArticle` property naming:
- `headline`, `description`, `datePublished`, `dateModified`
- `mainEntityOfPage` (canonical URL), `articleBody`, `wordCount`
- `author` → `{ name }`, `publisher` → `{ name }`
- `articleSection`, `inLanguage`, `keywords`
- `image` → `{ url }`

The MCP server preserves these conventions in all tool responses.

### JSON-LD Security

All JSON-LD output uses `safeJsonLdStringify()` to prevent XSS:
- `<` → `\u003c` (prevents `</script>` injection)
- `>` → `\u003e` (prevents HTML tag injection)
- `&` → `\u0026` (prevents HTML entity issues)

Component: `src/components/ui/json-ld.tsx`
Tests: `src/components/__tests__/json-ld.test.tsx` (14 tests including injection payloads)

## Consumer → Super App Migration

The following consumer-facing pages are migrating to the **Mukoko super app** (`app.mukoko.com`). They remain functional in this repo but are not the primary focus of development:

| Page | Route | Status |
|------|-------|--------|
| Home Feed | `/` | Migrating — sectioned feed with top stories, categories |
| Discover | `/discover` | Migrating — tag cloud, country/category browsing |
| NewsBytes | `/newsbytes` | Migrating — TikTok-style vertical feed |
| Search | `/search` | Migrating — hybrid search UI |
| Saved | `/saved` | Migrating — bookmarked articles |
| Profile | `/profile` | Migrating — user settings and preferences |
| Insights | `/insights` | Migrating — analytics insights dashboard |

**What stays in this repo**:
- Platform dashboard (`/platform/*`)
- Admin dashboard (`/admin/*`)
- Embed widgets (`/embed/*`)
- Sources directory (`/sources/*`)
- Article detail (`/article/[id]`)
- Static pages (help, privacy, terms)
- The entire backend API (fly-worker)
- MCP server

## API

**Base URL**: `https://mukoko-news-api.fly.dev`

### Endpoint Protection

- `/api/*` - **Protected** (requires bearer token: API_SECRET or OIDC JWT)
- `/health`, `/api/health` - Public (no auth required)
- `/api/analytics/*` - Public (open data, no auth required)
- `/api/admin/*` - Admin only (requires ADMIN_SESSION_SECRET)

### Authentication Methods

1. **API_SECRET** - Bearer token for frontend (Vercel) to backend auth
   - Set via: `fly secrets set API_SECRET=your-secret`
   - Environment variable: `NEXT_PUBLIC_API_SECRET`
   - Configured in: `.env.local` (development), Vercel (production)

2. **OIDC JWT** - User authentication tokens from id.mukoko.com (planned)
   - JWTs with 2 dots are accepted but not yet validated
   - Full OIDC validation is a future milestone

3. **Platform API Keys** (planned) - Self-service keys for third-party developers
   - 5 tiers: free, developer, business, enterprise, open_data
   - See "API Key Management" in Platform Services section

### Key Endpoints

**Feeds & Articles**:
- `GET /api/feeds` - Articles feed with filtering, pagination, sorting
- `GET /api/feeds/sectioned` - Sectioned feed (top stories, by category, latest)
- `GET /api/article/:id` - Single article (UUID or slug)
- `GET /api/article/:id/related` - Related articles
- `GET /api/news-bytes` - NewsBytes (short-form articles)

**Discovery**:
- `GET /api/categories` - All enabled categories with counts
- `GET /api/trending-categories` - Trending categories with growth rate
- `GET /api/keywords` - Trending keywords for tag cloud
- `GET /api/sources` - RSS sources with health and article counts
- `GET /api/countries` - All 16 Pan-African countries
- `GET /api/search` - Hybrid search (Doris funnel → Postgres hydration → ILIKE fallback)
- `GET /api/stories/trending` - Trending story clusters

**Authors**:
- `GET /api/authors` - Authors by article count
- `GET /api/trending-authors` - Trending authors (last 7d)
- `GET /api/featured-authors` - Top authors by total output

**Engagement**:
- `POST /api/articles/:id/like` - Like article
- `POST /api/articles/:id/save` - Bookmark article
- `POST /api/articles/:id/view` - Track view
- `GET /api/articles/:id/engagement` - Engagement counts

**Public Analytics** (no auth):
- `GET /api/analytics/overview` - Platform-wide stats
- `GET /api/analytics/articles/top` - Top articles by engagement
- `GET /api/analytics/articles/:id/performance` - Single article performance
- `GET /api/analytics/sources` - Source reliability and performance
- `GET /api/analytics/sources/:id/performance` - Single source performance
- `GET /api/analytics/geo` - Geographic readership distribution
- `GET /api/analytics/categories` - Category performance
- `GET /api/analytics/trending` - Trending topics with scores

**Admin** (requires ADMIN_SESSION_SECRET):
- `GET /api/admin/*` - Admin endpoints (6 endpoints)

**User**:
- `GET /api/user/bookmarks` - User bookmarks (stub, needs OIDC)
- `GET /api/stats` - Database statistics

**API Auth Middleware**: `fly-worker/src/api/auth.py`
**OpenAPI Schema**: `api-schema.yml`

## Environment Variables

### Frontend (.env.local)

```bash
NEXT_PUBLIC_API_URL=https://mukoko-news-api.fly.dev
NEXT_PUBLIC_BASE_URL=https://news.mukoko.com  # Base URL for SEO/schema.org (optional, has default)
NEXT_PUBLIC_API_SECRET=your-api-secret  # Optional: for direct browser auth
API_SECRET=your-api-secret               # Server-side API authentication
```

### Backend (Fly.io Secrets)

```bash
fly secrets set API_SECRET=your-secret
fly secrets set ADMIN_SESSION_SECRET=your-admin-secret
fly secrets set DATABASE_URL=postgresql://...
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
fly secrets set COUCHDB_URL=http://...
fly secrets set DORIS_HTTP_URL=http://...
```

### MCP Server

```bash
MUKOKO_API_SECRET=your-api-secret        # Required: Bearer token for API
MUKOKO_API_URL=https://mukoko-news-api.fly.dev  # Optional: defaults to production
```

## Deployment

**Frontend**: Auto-deploys to Vercel on push to main

**Backend**: Deployed to Fly.io
```bash
cd fly-worker && fly deploy
```

**MCP Server**: Distributed as npm package (`@mukoko/mcp-server`), runs locally on user machines via stdio transport.

**CI/CD Pipeline** (`.github/workflows/deploy.yml`):
1. Test frontend (typecheck, lint, build)
2. Deploy frontend to Vercel
3. Deploy backend to Fly.io
4. Health check verification (`https://mukoko-news-api.fly.dev/health`)

## Testing

### Frontend Testing (Vitest)

```bash
npm run test              # Single run
npm run test:watch        # Watch mode
npm run test:coverage     # With v8 coverage report
```

**Test Files** (421 tests in 19 files):

`src/lib/__tests__/`:
- `api.test.ts` - API client, fetch wrapper, error handling, rate limiting, all endpoints (33 tests)
- `utils.test.ts` - Utility functions, safeCssUrl, CSS injection, prototype pollution, path traversal (62 tests)
- `constants.test.ts` - Constants, URL helpers, path traversal, URL injection security tests (28 tests)

`src/contexts/__tests__/`:
- `preferences-context.test.tsx` - localStorage persistence, country/category selection, onboarding flow (22 tests)

`src/components/__tests__/`:
- `article-card.test.tsx` - ArticleCard rendering, image handling, date formatting, engagement display (21 tests)
- `engagement-bar.test.tsx` - EngagementBar and InlineEngagement components, click handlers, count formatting (28 tests)
- `share-modal.test.tsx` - Share options, copy link, social sharing, escape key handling (18 tests)
- `onboarding-modal.test.tsx` - Modal visibility, country selection, completing onboarding, accessibility (16 tests)
- `story-cluster.test.tsx` - StoryCluster component tests (30 tests)
- `json-ld.test.tsx` - JSON-LD rendering, XSS prevention, expanded injection payloads (14 tests)
- `hero-card.test.tsx` - HeroCard component tests (8 tests)
- `compact-card.test.tsx` - CompactCard component tests (8 tests)
- `bottom-nav.test.tsx` - Mobile bottom navigation + routing tests (10 tests)
- `breadcrumb.test.tsx` - Breadcrumb navigation tests (7 tests)
- `error-boundary.test.tsx` - ErrorBoundary tests (5 tests)

`src/app/discover/__tests__/`:
- `discover-page.test.tsx` - Discover page rendering, tag cloud logarithmic scaling, sources section filtering/sorting (14 tests)

`src/app/sources/__tests__/`:
- `sources-page.test.tsx` - Sources page header/stats, search, country filter, sort, skeleton, source links, country flags, error state, accessibility (13 tests)

`src/app/embed/__tests__/`:
- `embed-iframe.test.tsx` - Embed widget rendering, params, themes, layouts, empty states, refresh (42 tests)
- `widget.test.ts` - widget.js script behavior, URL validation, sizing, security (38 tests)

**Test Pattern**: Vitest with jsdom environment, React Testing Library

### Backend Testing (pytest)

```bash
cd fly-worker
pytest                    # Single run
pytest --cov              # With coverage report
```

**Test Files** (`fly-worker/tests/`):
- `test_content_cleaner.py` - HTML cleaning, text extraction
- `test_engagement.py` - Engagement scoring
- `test_quality_scorer.py` - Quality scoring algorithm
- `test_rss_parser.py` - RSS/Atom parsing

**Test Pattern**: pytest with async mode via `pytest-asyncio`

## Theme System

The app uses CSS variables for theming, defined in `src/app/globals.css`:

```css
:root {
  --primary: #4B0082;      /* Tanzanite */
  --secondary: #0047AB;    /* Cobalt */
  --background: #FAF9F5;   /* Warm Cream */
  --foreground: #1a1a1a;
  /* ... more variables */
}

.dark {
  --background: #0a0a0a;
  --foreground: #ededed;
  /* ... dark mode overrides */
}
```

Use Tailwind classes like `bg-primary`, `text-foreground`, `bg-surface` etc.

## Code Conventions

### TypeScript

- Strict mode enabled
- `const` preferred over `let`
- Unused variables: prefix with `_` to ignore
- Path alias: `@/*` maps to `src/*`

### File Naming

- Components/services: camelCase (`ArticleService.ts`, `articleCard.tsx`)
- Pages: kebab-case (`article/[id]/page.tsx`)
- SQL identifiers: snake_case
- URL paths: kebab-case

### Component Patterns

- Functional components with React 19 + TypeScript
- Radix UI primitives for accessibility
- Tailwind classes for styling (no inline styles)
- Props spread via `className` prop pattern
- Error boundaries on all pages with data fetching
- Skeleton loaders for graceful loading states

### React Best Practices

**List Keys**: Use stable, unique keys instead of array indices:
```tsx
// Good - uses stable identifier
{items.map((item) => (
  <li key={item.id || item.href || item.label}>{item.name}</li>
))}

// Bad - array index can cause issues with reordering
{items.map((item, index) => (
  <li key={index}>{item.name}</li>
))}
```

**Memoization**: Use `useMemo` to prevent expensive recalculations:
```tsx
// Stable sorted key - prevents refetch when array is reordered
// Example: [ZW, KE] and [KE, ZW] produce same key "KE,ZW"
const countryKey = useMemo(
  () => selectedCountries.slice().sort().join(","),
  [selectedCountries]
);
```

**Cleanup Effects**: Always clean up timeouts and subscriptions:
```tsx
useEffect(() => {
  const timer = setTimeout(() => setFlag(false), 2000);
  return () => clearTimeout(timer);  // Cleanup prevents memory leaks
}, [dependency]);
```

**Pathname Matching**: Use anchored regex for robust route matching:
```tsx
// Good - anchored regex matches exactly /article/{id}, not sub-routes
if (/^\/article\/[^/]+$/.test(pathname)) return null;

// Less robust - matches sub-routes like /article/123/comments
if (/^\/article\/[^/]+/.test(pathname)) return null;

// Least robust - matches any path starting with /article/
if (pathname.startsWith("/article/")) return null;
```

**Clipboard API**: Provide fallbacks for older browsers:
```tsx
const copyToClipboard = async (text: string) => {
  if (!navigator.clipboard) {
    // Fallback for older browsers
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textArea);
    return success;
  }
  await navigator.clipboard.writeText(text);
  return true;
};
```

**useCallback Dependencies**: Align callback dependencies with the effect that triggers them:
```tsx
// fetchData derives countries from countryKey (not selectedCountries directly)
// This ensures fetchData only changes when countryKey changes
const fetchData = useCallback(async () => {
  const countries = countryKey ? countryKey.split(",") : [];
  await api.getArticles({ countries });
}, [countryKey]);

// Effect depends on fetchData, which only changes when countryKey changes
useEffect(() => { fetchData(); }, [fetchData]);
```

**Stable Event Handlers via Refs**: Avoid re-registering event listeners on state changes:
```tsx
// Ref always holds the latest handler without causing effect re-runs
const handleRefreshRef = useRef(() => {});
useEffect(() => { handleRefreshRef.current = handleRefresh; }, [handleRefresh]);

// Touch listener registered once, calls latest handler via ref
useEffect(() => {
  const onTouchEnd = () => { handleRefreshRef.current(); };
  window.addEventListener("touchend", onTouchEnd);
  return () => window.removeEventListener("touchend", onTouchEnd);
}, []); // No dependencies - never re-registers
```

**CSS URL Escaping**: Use `safeCssUrl()` from `@/lib/utils` for CSS `url()` values:
```tsx
import { safeCssUrl } from "@/lib/utils";

// Good - handles already-encoded URLs and encodes fresh
// Decodes first to prevent double-encoding (%20 → %2520)
style={{ backgroundImage: safeCssUrl(src) }}

// Bad - manual escaping is incomplete and error-prone
style={{ backgroundImage: `url('${src.replace(/'/g, "\\'")}')` }}

// Bad - unescaped URL could break out of quotes
style={{ backgroundImage: `url(${src})` }}
```

**Note**: `safeCssUrl()` uses `decodeURI()` then `encodeURI()` to safely handle URLs that may already be percent-encoded, preventing issues like `%20` becoming `%2520`.

### Error Boundaries

Error boundaries wrap page content in:
- Feed page (`page.tsx`) - All feed sections
- Article page (`article/[id]/page.tsx`)
- Discover page (`discover/page.tsx`)
- Search page (`search/page.tsx`)
- NewsBytes page (`newsbytes/page.tsx`)

Component: `src/components/ui/error-boundary.tsx`

### Skeleton Loaders

Skeleton components provide graceful loading states:
- `FeedPageSkeleton` - Home feed loading
- `ArticlePageSkeleton` - Article detail loading
- `ArticleCardSkeleton` - Individual card loading
- `CompactCardSkeleton` - Compact card loading
- `HeroCardSkeleton` - Hero section loading
- `DiscoverPageSkeleton` - Discover page loading
- `NewsBytesSkeleton` - NewsBytes loading
- `SearchPageSkeleton` - Search page loading

Components: `src/components/ui/skeleton.tsx`, `src/components/ui/discover-skeleton.tsx`

### API Client Pattern

- Centralized `fetchAPI<T>()` function with 10s timeout
- Bearer token authentication
- Error handling: AbortError → timeout message
- Response validation required (non-OK throws)

### Image URL Validation

Use `isValidImageUrl()` from `src/lib/utils.ts` before rendering user-provided image URLs:
- Allows: `http://`, `https://`, `/` (relative paths)
- Blocks: `javascript:`, `data:`, `blob:`, `vbscript:` protocols

### Base URL Pattern

Use centralized URL utilities from `src/lib/constants.ts`:
- `BASE_URL` - Uses `NEXT_PUBLIC_BASE_URL` env var or defaults to production URL
- `getArticleUrl(id)` - Generates full article URLs
- `getFullUrl(path)` - Generates full URLs from relative paths

```typescript
import { BASE_URL, getArticleUrl, getFullUrl } from "@/lib/constants";

// Examples
const url = getArticleUrl("123");  // https://news.mukoko.com/article/123
const fullUrl = getFullUrl("/discover");  // https://news.mukoko.com/discover
```

### Font Loading

Fonts are loaded via CSS `@import` in `globals.css` with preconnect hints in `layout.tsx`:
- Preconnect hints improve loading performance
- CSS @import chosen for build reliability (network-independent)
- Fonts: Noto Serif (headings), Plus Jakarta Sans (body)

### Embed Widget Pattern

The embed module provides embeddable news card iframes for sister apps (e.g., weather.mukoko.com):

**Layouts**: `cards` (grid), `compact` (text list), `hero` (featured card), `ticker` (horizontal scroll), `list` (thumbnails)
**Feed Types**: `top` (trending), `featured` (popular), `latest` (chronological), `location` (local news)
**Parameters**: `country`, `type`, `layout`, `limit`, `category`, `theme` (via URL search params)

**Widget Script** (`public/embed/widget.js`):
- Vanilla JS IIFE (~2KB), no dependencies
- Converts `<div data-mukoko-embed>` elements into sandboxed iframes
- `data-base-url` attribute validated with `new URL()` constructor (http/https only)
- Sandbox: `allow-scripts allow-popups allow-popups-to-escape-sandbox` (no `allow-same-origin`)

**Iframe Page** (`src/app/embed/iframe/page.tsx`):
- Client component using `useSearchParams()` wrapped in `<Suspense>`
- Theme effect with proper cleanup (restores previous theme on unmount)
- Empty states for hero/ticker layouts when no articles available

### Backend Error Handling

- FastAPI HTTPException with status codes: 400, 401, 403, 404, 500
- Timestamp inclusion in responses
- Console logging with `[SERVICE]` prefix (e.g., `[RSS]`, `[SEARCH]`, `[ADMIN]`)

## Pan-African Country Support

Supported countries (16 total) defined in `src/lib/constants.ts` (frontend) and `database/migrations/024_platform_services_tables.sql` (backend seed):

- Zimbabwe (ZW) - Primary market
- South Africa (ZA)
- Kenya (KE)
- Nigeria (NG)
- Ghana (GH)
- Tanzania (TZ)
- Uganda (UG)
- Rwanda (RW)
- Ethiopia (ET)
- Botswana (BW)
- Zambia (ZM)
- Malawi (MW)
- Egypt (EG)
- Morocco (MA)
- Namibia (NA)
- Mozambique (MZ)

RSS articles inherit `country_id` from source configuration.
Country data is centralized in `src/lib/constants.ts` (frontend) and `dynamic_countries` table (platform).

## Key Features

### Platform Features
1. **Publisher Portal**: Claim news sources, DNS verification, push API, analytics
2. **API Key Management**: 5-tier self-service keys (free → enterprise)
3. **Webhook System**: 14 event types, HMAC signing, retry with backoff
4. **Content Moderation**: AI + pattern detection, cultural alignment, fact-checking
5. **MCP Server**: 9 tools + 5 resources for AI clients (Claude, Cursor)
6. **Open Data Analytics**: Public API — business intelligence for the people
7. **Embed Widgets**: 5 layouts, 4 feed types, 16 countries, sandboxed iframes
8. **RSS Distribution**: Country-specific and category-specific feeds
9. **Smart Home Briefings**: Alexa, Google Assistant, HomePod
10. **SSE Streaming**: Real-time article and breaking news events

### News API Features
11. **RSS Feed Aggregation**: 56+ sources with AI-powered content processing
12. **AI Keyword Extraction**: 3-stage (DB match → section → Claude AI)
13. **Quality Scoring**: Deterministic textstat-based scoring (0-100)
14. **Story Clustering**: Jaccard similarity on headlines, groups related coverage
15. **Hybrid Search**: Doris funnel → Postgres hydration → ILIKE fallback
16. **Engagement Scoring**: Composite score from views, likes, bookmarks, shares
17. **Trending Topics**: Logarithmic-scaled tag cloud, cached every 30min

### Frontend Features
18. **Schema.org SEO**: 8 JSON-LD types (NewsArticle, Organization, BreadcrumbList, WebSite, WebPage, ItemList, CollectionPage, SoftwareApplication)
19. **Dark Mode**: System detection or manual toggle with next-themes
20. **Personalized Feeds**: Country/category filtering with localStorage persistence
21. **WCAG AAA**: 7:1 contrast ratios, semantic HTML, keyboard navigation
22. **Admin Dashboard**: User management, analytics, source configuration

## Key Files

### Platform Frontend
- `src/app/platform/page.tsx` - Platform dashboard with stats, quick actions, super app banner
- `src/app/platform/publishers/page.tsx` - Publisher claiming (4-step: find → verify → connect → manage)
- `src/app/platform/authors/page.tsx` - Author portal (blog connect, API publish)
- `src/app/platform/tools/mcp/page.tsx` - MCP server setup (Claude Desktop, Code, Cursor)
- `src/app/platform/tools/embed/page.tsx` - Widget builder (5 layouts, 4 feed types)
- `src/app/platform/tools/rss/page.tsx` - RSS feed config (country + category feeds)
- `src/app/platform/layout.tsx` - Platform layout with sidebar navigation

### MCP Server
- `mcp-server/src/index.js` - MCP server (9 tools, 5 resources, Schema.org conventions)
- `mcp-server/package.json` - @mukoko/mcp-server, bin: mukoko-mcp

### Platform Services (migration target)
- `backend/services/platform/index.ts` - Service exports & types
- `backend/services/platform/PublisherService.ts` - Publisher registration, DNS verification, article push
- `backend/services/platform/APIKeyService.ts` - 5-tier API key management
- `backend/services/platform/WebhookService.ts` - Event-driven webhooks, HMAC signing
- `backend/services/platform/ContentModerationService.ts` - AI moderation, cultural alignment
- `backend/services/platform/OpenDataService.ts` - Open data manifesto, bulk export
- `backend/services/platform/SmartHomeBriefingService.ts` - Alexa, Google, HomePod briefings
- `database/migrations/024_platform_services_tables.sql` - Platform database tables

### News Frontend
- `src/app/layout.tsx` - Root layout with providers, bottom nav, and Organization JSON-LD
- `src/app/page.tsx` - Home feed with simplified layout (Featured + Latest)
- `src/app/globals.css` - Tailwind config, CSS variables, and font imports
- `src/lib/api.ts` - API client with all backend endpoints
- `src/lib/utils.ts` - Utilities (cn, formatTimeAgo, isValidImageUrl, safeCssUrl)
- `src/lib/constants.ts` - Centralized countries and categories (single source of truth)
- `src/contexts/preferences-context.tsx` - User preferences context with localStorage persistence
- `src/components/article-card.tsx` - Main article display component
- `src/components/share-modal.tsx` - Share/engagement modal with social sharing
- `src/components/onboarding-modal.tsx` - Country/category selection onboarding
- `src/components/ui/json-ld.tsx` - Schema.org JSON-LD with XSS prevention (8 types)
- `src/components/ui/engagement-bar.tsx` - Article engagement buttons (like, save, share)
- `src/components/ui/breadcrumb.tsx` - Breadcrumb navigation component
- `src/components/layout/bottom-nav.tsx` - Mobile bottom navigation
- `src/components/ui/skeleton.tsx` - Skeleton loading components
- `src/components/ui/error-boundary.tsx` - Error boundary component
- `src/app/embed/page.tsx` - Embed documentation page with live previews
- `src/app/embed/iframe/page.tsx` - Embed iframe widget (5 layouts)
- `public/embed/widget.js` - Lightweight embed script (~2KB) for sister apps
- `src/app/discover/page.tsx` - Discover page with log-scaled tag cloud
- `src/app/sources/page.tsx` - Sources directory with search, filters, health indicators

### Backend (fly-worker)
- `fly-worker/src/main.py` - FastAPI app entry point, CORS, router registration
- `fly-worker/src/config.py` - pydantic-settings configuration
- `fly-worker/src/db.py` - asyncpg pool, migrations
- `fly-worker/src/api/auth.py` - Bearer token authentication middleware
- `fly-worker/src/api/feeds.py` - Feed endpoints (most critical, powers homepage)
- `fly-worker/src/api/search.py` - Hybrid search (Doris → Postgres → ILIKE fallback)
- `fly-worker/src/api/analytics.py` - Public open data analytics (8 endpoints, no auth)
- `fly-worker/src/jobs/rss_collector.py` - RSS collection + AI processing pipeline
- `fly-worker/src/jobs/ai_processor.py` - Keyword extraction + quality scoring
- `fly-worker/src/services/keyword_extractor.py` - 3-stage keyword extraction
- `fly-worker/src/services/quality_scorer.py` - Textstat-based quality scoring
- `fly-worker/fly.toml` - Fly.io deployment config

### Config
- `next.config.ts` - Next.js configuration
- `tailwind.config.ts` - Tailwind CSS configuration
- `eslint.config.js` - Flat ESLint 9 config
- `api-schema.yml` - OpenAPI documentation
- `vitest.config.ts` - Frontend test configuration

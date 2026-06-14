# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mukoko News is a Pan-African digital news aggregation platform. "Mukoko" means "Beehive" in Shona — where community gathers and stores knowledge. Primary market is Zimbabwe with expansion across 16 African countries.

**Architecture**: Next.js 15 frontend (`src/`) + Cloudflare Workers API backend (`backend/`) + Fly.io Python pipeline worker (`fly-worker/`) + Cloudflare Python edge processor (`processing/`) + D1 database (`database/`) + MongoDB Atlas (primary data store, ~30 databases) + WorkOS AuthKit (authentication)

## Commands

### Frontend (root level)

```bash
pnpm dev              # Next.js dev server (port 3000)
pnpm build            # Production build
pnpm lint             # ESLint check
pnpm lint:fix         # ESLint auto-fix
pnpm typecheck        # TypeScript check
pnpm test             # Vitest (single run)
pnpm test:watch       # Vitest (watch mode)
pnpm test:coverage    # Vitest with v8 coverage

# Run a single test file
pnpm vitest run src/lib/__tests__/utils.test.ts
# Run tests matching a pattern
pnpm vitest run -t "formatTimeAgo"

# Install dependencies
pnpm install
# Add a new package
pnpm add <package>
```

### Backend (`cd backend`)

```bash
npm run dev              # wrangler dev (port 8787)
npm run test             # Vitest (single run)
npm run test:watch       # Vitest (watch mode)
npm run test:coverage    # Vitest with v8 coverage
npm run typecheck        # tsc --noEmit
npm run validate         # typecheck && build
npm run deploy           # Clean, build, and deploy to Cloudflare Workers

# Run a single backend test
cd backend && npx vitest run services/__tests__/ArticleService.test.ts

# Database
npm run db:migrate       # Apply schema to remote D1
npm run db:local         # Apply schema to local D1
```

### Processing Worker — Python (`cd processing`)

```bash
uv run pywrangler dev    # Start Python Worker dev server
uv run pytest            # Run Python tests
uv run pyright           # Type check Python
uv run pywrangler deploy # Deploy to Cloudflare Workers

# Run a single Python test
cd processing && uv run pytest tests/test_rss_parser.py
# Run tests matching a pattern
cd processing && uv run pytest -k "test_parses_rss"
```

### Fly.io Pipeline Worker (`cd fly-worker`)

```bash
uv sync --extra dev          # Install including dev deps (uses [project.optional-dependencies])
uv run pytest                # Run tests
uv run pyright               # Type check Python
flyctl deploy --remote-only  # Deploy to Fly.io

# Run a single test file
cd fly-worker && uv run pytest tests/test_engagement.py
# Run tests matching a pattern
cd fly-worker && uv run pytest -k "test_updates_article"
```

### From root (shortcuts)

```bash
npm run dev:backend      # Start backend dev server
npm run build:backend    # Build backend
npm run deploy:backend   # Deploy to Cloudflare Workers
npm run test:backend     # Run backend tests
npm run dev:api          # Start Python Worker dev server
npm run deploy:api       # Deploy Python Worker
npm run test:api         # Run Python tests
npm run typecheck:api    # Type check Python
```

## Architecture

### Frontend Stack

- **Next.js 15** App Router with React 19 + TypeScript strict mode
- **Tailwind CSS 4.x** with CSS variables for theming (defined in `src/app/globals.css`)
- **Radix UI** primitives for accessible components
- **Lucide React** for icons, **next-themes** for dark mode
- **MongoDB** — Next.js Route Handlers read/write `news` database directly via server-side calls
- **WorkOS AuthKit** (`@workos-inc/authkit-nextjs`) — authentication, session management via `src/middleware.ts`
- **State**: React Context (`PreferencesContext` for country/category, `ThemeContext`)
- **Path alias**: `@/*` maps to `src/*`
- **Package manager**: pnpm (v10+)

### Backend Stack

- **Cloudflare Workers** with **Hono** framework
- **D1** (SQLite at edge) — schema in `database/schema.sql`, 23 migrations
- **KV** namespaces (AUTH_STORAGE, CACHE_STORAGE)
- **Durable Objects** (4 classes for real-time interactions/analytics)
- **Workers AI** + **Vectorize** for content processing and semantic search
- **Auth**: OIDC (id.mukoko.com), Mobile SMS, Web3 wallets
- Bindings defined in `backend/wrangler.jsonc`

### Processing Worker Stack (`processing/`)

- **Cloudflare Python Workers** (Pyodide-based) with **FastAPI**
- **Anthropic Claude** via Cloudflare AI Gateway for NLP tasks
- **MongoDB Atlas** Data API (HTTP-based via JS FFI transport — edge constraint)
- **D1** as edge cache (binding: `EDGE_CACHE_DB`, same database as backend)
- **Workers AI** for embeddings (`baai/bge-base-en-v1.5` for Vectorize compatibility)
- Libraries: `feedparser`, `beautifulsoup4`, `numpy`, `textstat`
- Config: `processing/wrangler.jsonc`, deps: `processing/pyproject.toml`
- Called by backend via **Service Binding** (`DATA_PROCESSOR` → `ProcessingClient.ts`)

**Python Services** (`processing/services/`):

- `rss_parser.py` — RSS/Atom parsing via feedparser
- `content_cleaner.py` — bs4 HTML cleaning
- `content_extractor.py` — bs4 CSS selector scraping
- `article_ai.py` — Full AI processing pipeline orchestrator
- `ai_client.py` — Anthropic Claude via AI Gateway wrapper
- `keyword_extractor.py` — AI + text matching keyword extraction
- `quality_scorer.py` — textstat deterministic scoring
- `clustering.py` — numpy + AI embeddings clustering
- `feed_ranker.py` — numpy vectorized feed ranking
- `search_processor.py` — Vectorize + D1 semantic search
- `mongodb.py` — MongoDB Atlas Data API client (JS FFI transport)

### Fly.io Pipeline Worker (`fly-worker/`)

The primary background data pipeline. Runs on Fly.io (Johannesburg region, `jnb`) as a persistent FastAPI + APScheduler process with full native Python access — no Pyodide constraints.

- **FastAPI** + **uvicorn** + **APScheduler** for scheduled job execution
- **Motor** (async pymongo) with connection pooling — native MongoDB driver
- **Anthropic Claude** via direct API for AI enrichment
- **Cloudflare Workers AI** for BGE-M3 vector embeddings
- Config: `fly-worker/fly.toml`, deps: `fly-worker/pyproject.toml`
- MongoDB cluster: ~30 databases. Named accessors in `fly-worker/src/services/mongodb.py`:
  - `get_news_db()` → `news` (articles, feedSources)
  - `get_engagement_db()` → `engagement` (aggregateContributions, aggregateDefinitions)
  - `get_entity_db()` → `entity`
  - `get_platform_db()` → `platform` (serviceHealth)

**Scheduled jobs** (`fly-worker/src/jobs/`):

- `rss_collector.py` — RSS/Atom feed ingestion → `news.feedSources` + `news.articles` (every 15 min)
- `newsdata_collector.py` — newsdata.io API ingestion + source discovery → `news.articles`, `news.feedSources`, `news.sourceDiscoveryCandidates` (every 6h at :30)
- `ai_processor.py` — AI enrichment pipeline (Claude NLP, keyword extraction, quality scoring)
- `engagement.py` — Aggregates `engagement.aggregateContributions` → `news.articles.bundu.ubuntuScoreSnapshot`
- `health_checker.py` — Source health monitoring → `news.feedSources` + `platform.serviceHealth`
- `trending.py` — Trending topics and story clustering
- `embedding_backfill.py` — Vector embedding backfill for semantic search
- `cleanup.py` — Stale data pruning

**Source discovery flow**: `newsdata_collector` pulls articles for 16 African countries. For each unknown source, it probes common RSS paths (`/feed/`, `/rss`, `/atom.xml`, etc.). If an RSS feed is found, a live `feedSource` is created (`isActive: true`) and the RSS collector picks it up automatically on its next run. If no RSS is found, an inactive placeholder is created (`feedType: "newsdata_api"`, `isActive: false`) so the newsdata job continues supplying articles. All discovered sources are logged in `news.sourceDiscoveryCandidates`.

**Services** (`fly-worker/src/services/`):

- `newsdata_client.py` — newsdata.io HTTP client (`NewsdataClient`), `map_country()`, `map_language()`

**Services** (`fly-worker/src/services/`):

- `mongodb.py` — Motor async client, named DB accessors, `ping_mongodb()`, `close_mongodb()`
- `ai_client.py` — Anthropic Claude wrapper (messages API, async)
- `rss_parser.py` — feedparser RSS/Atom parsing with structured output
- `content_cleaner.py` — bs4 HTML cleaning (`clean_html(html: str | None) -> str`)
- `quality_scorer.py` — textstat deterministic readability scoring
- `embeddings.py` — BGE-M3 embeddings via Cloudflare Workers AI
- `keyword_extractor.py` — AI + text matching keyword extraction

### Backend Services (`backend/services/`)

Services follow a class-based pattern with D1 database access:

- **ArticleService** / **ArticleAIService** — Article CRUD, AI content processing (keywords, quality, embeddings)
- **SimpleRSSService** / **NewsSourceManager** — RSS feed aggregation and source management
- **CategoryManager** — Category operations (single source of truth)
- **CountryService** — Pan-African country management (16 countries in `src/lib/constants.ts`)
- **StoryClusteringService** — Groups similar articles using Jaccard similarity
- **SourceHealthService** — RSS source health monitoring (healthy/degraded/failing/critical)
- **PersonalizedFeedService** — User-specific feeds with scoring algorithms
- **AISearchService** — Semantic search via Vectorize
- **AuthProviderService** / **OIDCAuthService** — Unified auth with RBAC
- **D1Service** / **D1CacheService** / **D1UserService** — Database operations

### Access Control

- `/api/health` — Public
- `/api/feeds`, `/api/article/*`, `/api/search`, `/api/categories`, `/api/keywords`, `/api/sources`, `/api/countries`, `/api/trending-*`, `/api/news-bytes`, `/api/stories/*` — **Public** (read-only, no auth required)
- `/api/articles/:id/like`, `/api/articles/:id/save`, `/api/user/*` — User auth (OIDC JWT)
- `/api/admin/*` — Admin only (requires admin role via RBAC)
- Server-side Next.js sends `API_SECRET` as a bearer token for server-to-server calls; browser fetches are unauthenticated
- Auth middleware: `backend/middleware/apiAuth.ts`, `backend/middleware/oidcAuth.ts`
- OIDC JWT takes priority over API_SECRET when both present

### API Client (`src/lib/api.ts`)

- Centralized `fetchAPI<T>()` with 10s timeout and bearer token auth
- Key endpoints: `/api/feeds`, `/api/article/:id`, `/api/categories`, `/api/keywords`, `/api/sources`, `/api/newsbytes`
- OpenAPI schema: `api-schema.yml`

## Testing

**Frontend + Backend**: Vitest (985 total: 437 frontend + 548 backend)

- Frontend: jsdom environment, React Testing Library, setup in `src/__tests__/setup.ts`
- Backend: node environment, 10s timeout per test
- Backend mock pattern: Mock D1Database with `prepare().bind().first/all/run()` chain
- Coverage thresholds: 60% statements/functions/lines, 50% branches

**Processing Worker**: pytest + pytest-asyncio (7 test files in `processing/tests/`)

- Run: `cd processing && uv run pytest`
- Type check: `cd processing && uv run pyright`

**Fly.io Pipeline**: pytest + pytest-asyncio (tests in `fly-worker/tests/`)

- Install: `cd fly-worker && uv sync --extra dev` (uses `[project.optional-dependencies]`, not `--group dev`)
- Run: `cd fly-worker && uv run pytest`
- Type check: `cd fly-worker && uv run pyright`
- Mock pattern: `MagicMock.__getitem__` returns the same object for all keys — always use `side_effect=dict.__getitem__` to dispatch collection names to distinct mocks

**Pre-commit hook** (Husky): typecheck + build validation

**CI** (`.github/workflows/deploy.yml`): lint matrix (actionlint, JSON validity, prettier, markdownlint, yamllint) + test-frontend + test-backend + test-api + test-fly-worker

## Deployment

- **Frontend**: Auto-deploys to Vercel on push to main
- **Pipeline Worker** (`mukoko-news`): CI deploys to Fly.io on push to main via `deploy-fly-worker` job (requires `FLY_API_TOKEN` secret). Manual: `cd fly-worker && flyctl deploy --remote-only`
- **Python Worker** (`mukoko-news-api`): Deployed by Cloudflare GitHub App on push to main. Manual: `cd processing && uv run pywrangler deploy`
- **Backend** (`mukoko-news-gateway`): Deployed by Cloudflare GitHub App on push to main. Manual: `cd backend && npm run deploy`
- **Image Worker** (`mukoko-images`): Deployed by Cloudflare GitHub App on push to main. Manual: `cd image-worker && npx wrangler deploy`. Routes to `assets.mukoko.com/i/*`.
- **Cloudflare GitHub App** manages Workers — configure each worker's root directory in the Cloudflare dashboard (Workers & Pages → Settings → Build). For `mukoko-news-gateway` the root directory must be set to `backend/`.

## MCP Servers

`.mcp.json` registers project-scoped MCP servers that load automatically in Claude Code.

| Server | URL | Auth |
|---|---|---|
| `nyuchi-mongodb` | `https://mongodb.nyuchi.dev/mcp` | OAuth — each developer authenticates on first use; tokens stored in `~/.claude.json`, never committed |

**First-time setup**: On session start, Claude Code will prompt for OAuth authentication with `nyuchi-mongodb`. This grants read/write access to the MongoDB cluster. Only team members with nyuchi.dev credentials should approve this.

**Security note**: The URL is committed intentionally (team-shared config). Credentials are never in the file — OAuth tokens are per-developer and stored locally.

## Environment Variables

### Frontend (`.env.local`)

```bash
# MongoDB Atlas — Next.js reads/writes directly via server-side Route Handlers
MONGODB_URI=mongodb+srv://<user>:<pass>@nyuchi-platform-doc-db.ge8d8qi.mongodb.net/?appName=nyuchi-platform-doc-db
MONGODB_DATABASE=news

# Leave empty — Next.js Route Handlers serve all reads from MongoDB.
# Set to Cloudflare Worker URL only for the external widget/MCP API.
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_BASE_URL=https://news.mukoko.com

# WorkOS AuthKit
WORKOS_API_KEY=sk_live_...
WORKOS_CLIENT_ID=client_01KV2GGE5A7WRSFPWZ5HQJ3FNZ
WORKOS_COOKIE_PASSWORD=<32+ char random string>
```

### Backend (Cloudflare Secrets)

```bash
npx wrangler secret put API_SECRET
npx wrangler secret put ADMIN_SESSION_SECRET
npx wrangler secret put OIDC_CLIENT_SECRET
```

### Processing Worker (Cloudflare Secrets)

```bash
cd processing
uv run pywrangler secret put ANTHROPIC_API_KEY
uv run pywrangler secret put MONGODB_API_KEY
uv run pywrangler secret put MONGODB_APP_ID
```

### Fly.io Pipeline Worker (Fly.io Secrets)

```bash
# Set from fly-worker/ directory: flyctl secrets set KEY=value
MONGODB_URI=mongodb+srv://<user>:<pass>@nyuchi-platform-doc-db.ge8d8qi.mongodb.net/?appName=nyuchi-platform-doc-db
ANTHROPIC_API_KEY=...     # Claude AI for article enrichment
CF_ACCOUNT_ID=...         # Cloudflare account ID for BGE-M3 embeddings
CF_AI_API_TOKEN=...       # Cloudflare AI API token for embeddings
NEWSDATA_API_KEY=...      # newsdata.io API key for article ingestion + source discovery
```

Named database defaults (override via env if needed):
- `MONGODB_NEWS_DB=news`
- `MONGODB_ENGAGEMENT_DB=engagement`
- `MONGODB_ENTITY_DB=entity`
- `MONGODB_PLATFORM_DB=platform`

## Authentication (WorkOS AuthKit)

**WorkOS AuthKit** handles all user authentication via the custom auth domain `identity.nyuchi.com`.
Public OAuth client — PKCE only, no client secret.

Two separate WorkOS OAuth applications:

**1. Web AuthKit** — embedded sign-in components within `news.mukoko.com`
- Client ID: `WORKOS_CLIENT_ID` (web-specific app)
- Signs users in via `AuthKitProvider` + embedded components — no redirect to external domain
- Session stored in encrypted HTTP-only cookie (`WORKOS_COOKIE_PASSWORD`)

**2. MCP OAuth** — PKCE public client for AI agents and Claude Desktop
- Client ID: `WORKOS_MCP_CLIENT_ID` = `client_01KV2GGE5A7WRSFPWZ5HQJ3FNZ`
- Auth domain: `https://identity.nyuchi.com` (no secret required)
- Discovery: `GET https://news.mukoko.com/.well-known/oauth-authorization-server`

**Auth files:**
- `src/middleware.ts` — AuthKit session-refresh middleware (no forced redirect; embedded sign-in handles gating)
- `src/app/auth/callback/route.ts` — WorkOS OAuth callback handler
- `src/app/.well-known/oauth-authorization-server/route.ts` — OAuth metadata for MCP clients
- `src/app/layout.tsx` — wraps app in `AuthKitProvider`

**Usage in Server Components:**
```tsx
import { withAuth } from '@workos-inc/authkit-nextjs'
const { user } = await withAuth()
```

**MCP JWT verification** (`src/lib/mcp/server.ts`) uses `jose` to verify WorkOS JWTs via:
`https://identity.nyuchi.com/.well-known/jwks.json` (issuer: `https://identity.nyuchi.com`)

**Env vars (Next.js `.env.local`):**
```bash
WORKOS_CLIENT_ID=client_01KV2G41CHGBSH6HG57AQBFKDD       # web AuthKit app
WORKOS_MCP_CLIENT_ID=client_01KV2GGE5A7WRSFPWZ5HQJ3FNZ   # MCP OAuth app
WORKOS_COOKIE_PASSWORD=<32+ char random string>
```

## Design System (Nyuchi Brand v6)

**Colors** (African Minerals palette): Primary Tanzanite (#4B0082), Secondary Cobalt (#0047AB), Accent Gold (#5D4037), Success Malachite (#2E8B57), Warning Terracotta (#E07A4D), Surface Warm Cream (#FAF9F5)

**Typography**: Noto Serif (headings), Plus Jakarta Sans (body) — loaded via CSS `@import` with preconnect hints in layout.tsx

**Spacing**: 12px border-radius buttons, 16px cards. WCAG AAA compliant (7:1 contrast).

CSS variables in `src/app/globals.css`. Use Tailwind classes: `bg-primary`, `text-foreground`, `bg-surface`, etc.

## Code Conventions

### Naming

- Components/services: PascalCase files (`ArticleService.ts`, `ArticleCard.tsx`)
- Pages: kebab-case directories (`article/[id]/page.tsx`)
- SQL: snake_case identifiers
- Unused variables: prefix with `_`

### Component Patterns

- Functional components with TypeScript
- Radix UI for accessibility, Tailwind for styling (no inline styles)
- Error boundaries on all pages with data fetching (`src/components/ui/error-boundary.tsx`)
- Skeleton loaders for loading states (`src/components/ui/skeleton.tsx`)
- Use stable unique keys for lists (not array indices)

### Security Patterns

**JSON-LD XSS prevention**: All structured data uses `safeJsonLdStringify()` in `src/components/ui/json-ld.tsx` — escapes `<`, `>`, `&` in script tags.

**Image URL validation**: Use `isValidImageUrl()` from `src/lib/utils.ts` before rendering user-provided image URLs. Blocks `javascript:`, `data:`, `blob:`, `vbscript:` protocols.

**CSS URL escaping**: Use `safeCssUrl()` from `src/lib/utils.ts` for CSS `url()` values. Decodes then re-encodes to prevent double-encoding (`%20` → `%2520`).

```tsx
import { safeCssUrl } from "@/lib/utils";
style={{ backgroundImage: safeCssUrl(src) }}  // Good
style={{ backgroundImage: `url(${src})` }}    // Bad — injectable
```

**Base URL helpers**: Use `BASE_URL`, `getArticleUrl(id)`, `getFullUrl(path)` from `src/lib/constants.ts`.

### React Patterns (Project-Specific)

**Pathname matching** — Use anchored regex for route matching:
```tsx
if (/^\/article\/[^/]+$/.test(pathname)) return null;  // Exact match
```

**Stable event handlers via refs** — Avoid re-registering listeners:
```tsx
const handleRefreshRef = useRef(() => {});
useEffect(() => { handleRefreshRef.current = handleRefresh; }, [handleRefresh]);
useEffect(() => {
  const onTouchEnd = () => { handleRefreshRef.current(); };
  window.addEventListener("touchend", onTouchEnd);
  return () => window.removeEventListener("touchend", onTouchEnd);
}, []);
```

**Memoized cache keys** — Sorted array keys prevent duplicate fetches:
```tsx
const countryKey = useMemo(() => selectedCountries.slice().sort().join(","), [selectedCountries]);
```

**Clipboard fallback** — `copyToClipboard()` in share-modal provides textarea fallback for older browsers.

### Backend Patterns

- Hono responses: `c.json({ error, message }, statusCode)` with timestamp
- Console logging with `[SERVICE_NAME]` prefix
- Service classes receive env bindings via constructor

### Embed Widget System

Embeddable news widgets for sister apps (e.g., weather.mukoko.com):

- Widget script: `public/embed/widget.js` (vanilla JS IIFE, ~2KB)
- Iframe renderer: `src/app/embed/iframe/page.tsx`
- 5 layouts (cards, compact, hero, ticker, list) × 4 feed types (top, featured, latest, location)
- Sandbox: `allow-scripts allow-popups allow-popups-to-escape-sandbox` (no `allow-same-origin`)

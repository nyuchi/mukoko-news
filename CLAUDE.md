# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mukoko News is a Pan-African digital news aggregation platform. "Mukoko" means "Beehive" in Shona — where community gathers and stores knowledge. Primary market is Zimbabwe with expansion across 16 African countries.

**Architecture**: Next.js 15 frontend (`src/`) + Cloudflare Workers API backend (`backend/`) + Python data processing Worker (`processing/`) + D1 database (`database/`) + two Supabase projects (news processing pipeline + platform permanent store)

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
- **Supabase** (`@supabase/supabase-js` + `@supabase/ssr`) — reads published articles from `mukoko_platform_cloud` (the permanent store)
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
- **Anthropic Claude** via Cloudflare AI Gateway for NLP tasks (replaces Llama-3-8b)
- **MongoDB Atlas** Data API (HTTP-based, primary data store — planned)
- **D1** as edge cache (binding: `EDGE_CACHE_DB`, same database as backend)
- **Workers AI** for embeddings (`baai/bge-base-en-v1.5` for Vectorize compatibility)
- Libraries: `feedparser`, `beautifulsoup4`, `numpy`, `textstat`
- Config: `processing/wrangler.jsonc`, deps: `processing/pyproject.toml`
- Called by backend via **Service Binding** (`DATA_PROCESSOR` → `ProcessingClient.ts`)

**Python Services** (`processing/services/`):

- `rss_parser.py` — RSS/Atom parsing via feedparser (replaces SimpleRSSService XML logic)
- `content_cleaner.py` — bs4 HTML cleaning (replaces regex loops in ArticleAIService)
- `content_extractor.py` — bs4 CSS selector scraping (replaces regex patterns)
- `article_ai.py` — Full AI processing pipeline orchestrator
- `ai_client.py` — Anthropic Claude via AI Gateway wrapper
- `keyword_extractor.py` — AI + text matching keyword extraction
- `quality_scorer.py` — textstat deterministic scoring (replaces AI-only scoring)
- `clustering.py` — numpy + AI embeddings clustering (replaces Jaccard-only)
- `feed_ranker.py` — numpy vectorized feed ranking
- `search_processor.py` — Vectorize + D1 semantic search
- `mongodb.py` — MongoDB Atlas Data API client (JS FFI transport)

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

- `/api/health` — Public (no auth)
- `/api/*` — Protected with bearer token (API_SECRET or OIDC JWT)
- `/api/admin/*` — Admin only (requires admin role via RBAC)
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

**Pre-commit hook** (Husky): typecheck + build validation

## Deployment

- **Frontend**: Auto-deploys to Vercel on push to main
- **Python Worker** (`mukoko-news-api`): Deployed by Cloudflare GitHub App on push to main. Manual: `cd processing && uv run pywrangler deploy`
- **MongoDB Proxy Worker** (`mukoko-mongo-proxy`): Deployed by Cloudflare GitHub App on push to main. Manual: `cd processing/mongo-proxy && npx wrangler deploy`
- **Backend** (`mukoko-news-backend`): Deployed by Cloudflare GitHub App on push to main. Manual: `cd backend && npm run deploy`
- **Cloudflare GitHub App** manages all three Workers — configure each worker's root directory in the Cloudflare dashboard (Workers & Pages → Settings → Build). Deploy order must be: mongo-proxy → Python Worker → backend (service binding dependency).
- `.github/workflows/deploy.yml` runs tests only (CI); deployment is handled by Cloudflare

## Environment Variables

### Frontend (`.env.local`)

```bash
NEXT_PUBLIC_API_URL=https://mukoko-news-backend.nyuchi.workers.dev
NEXT_PUBLIC_BASE_URL=https://news.mukoko.com  # Optional, for SEO/JSON-LD
API_SECRET=your-api-secret               # Server-side API auth (SSR, Route Handlers)
NEXT_PUBLIC_API_SECRET=your-api-secret   # Client-side API auth (browser — NEXT_PUBLIC_ prefix required)

# Supabase platform project (mukoko_platform_cloud — permanent store)
NEXT_PUBLIC_SUPABASE_URL=https://tdcpuzqyoodrdsxldgsh.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
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

## Supabase Architecture

Two Supabase projects are used. Supabase is the **processing pipeline** (temporary staging), not permanent storage.

| Project | Supabase ID | Role |
|---|---|---|
| `supabase_mukoko_news` | `gjdmtthumkopkwuttwnd` | News processing pipeline — ingest, enrich, moderate (temporary staging) |
| `mukoko_platform_cloud` | `tdcpuzqyoodrdsxldgsh` | Permanent store — published articles synced here; Next.js reads from here |

**Data flow:**
```
RSS / partner feeds
      ↓
FastAPI worker (Python + supabase-py)
      ↓ ingest → enrich → moderate
supabase_mukoko_news  (staging)
      ↓ sync_to_platform job (on status = published)
mukoko_platform_cloud  (permanent)
      ↓
Next.js frontend reads via @supabase/supabase-js
```

**Auth**: Handled by **Stytch** on the platform side. Supabase does not issue JWTs or manage auth in this project.

**Edge functions**: This project uses **Cloudflare Workers** as its edge runtime — `supabase/functions/` does not exist and is not used.

### News Processing Project (`supabase_mukoko_news`)

FastAPI Python backend. Articles are ingested, enriched (NLP, sentiment, geo, categorisation), and moderated here before syncing to the platform. Data is **not permanent** — it stages work in progress.

**Schemas:** `news` · `identity` (projection from platform) · `engagement` (interest categories mirror) · `sync` (audit log) · `system` (feature flags)

**Key tables:**
- `news.news_article` — core article table with both Schema.org fields and pipeline fields (`sentiment_score`, `named_entities`, `topic_tags`, `moderation_status`, `sync_status`)
- `news.processing_job` — async enrichment queue polled by workers
- `news.feed_source` — RSS/Atom/API feed registry
- `news.news_media_organization` — publishers

**Processing job types** (executed in priority order):

| Job | Priority |
|---|---|
| `duplicate_detection` | 1 |
| `nlp_enrichment` | 2 |
| `sentiment_analysis` | 3 |
| `geo_tagging` | 3 |
| `category_tagging` | 4 |
| `summary_generation` | 5 |
| `sync_to_platform` | 1 (triggered on publish) |

**Auto-triggers:** Inserting an article with `ingestion_method` set queues all 7 enrichment jobs. Setting `status = published` queues `sync_to_platform` and sets `sync_status = pending_sync`.

**Python client** (`supabase-py`):
```python
from supabase import create_client
db = create_client(os.environ["SUPABASE_NEWS_URL"], os.environ["SUPABASE_NEWS_SERVICE_KEY"])
```

**Env vars (FastAPI processing worker):**
```bash
SUPABASE_NEWS_URL=https://gjdmtthumkopkwuttwnd.supabase.co
SUPABASE_NEWS_SERVICE_KEY=<service_role_key>
SUPABASE_PLATFORM_URL=https://tdcpuzqyoodrdsxldgsh.supabase.co
SUPABASE_PLATFORM_SERVICE_KEY=<platform_service_role_key>
```

### Platform Cloud Project (`mukoko_platform_cloud`)

Permanent store. Receives enriched, moderated articles from the news processing project via the `sync_to_platform` worker. Source of truth for all published content.

**Next.js client files** (in `src/lib/supabase/`):
- `client.ts` — Browser client (`createBrowserClient`). Use in Client Components.
- `server.ts` — Server client (`createServerClient`). Use in Server Components, Route Handlers, Server Actions.
- `middleware.ts` — Session refresh helper (`updateSession`).

```tsx
// Client Component
import { createClient } from '@/lib/supabase/client'
const supabase = createClient()

// Server Component / Route Handler
import { createClient } from '@/lib/supabase/server'
const supabase = await createClient()
```

**Env vars (Next.js `.env.local`):**
```bash
NEXT_PUBLIC_SUPABASE_URL=https://tdcpuzqyoodrdsxldgsh.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_aNdSABNOLB3sG7OMjHN0Vw_5SDouXAL
```

### shadcn Registry

`components.json` includes the Supabase registry:
```json
"registries": { "@supabase": "https://supabase.com/ui/r/{name}.json" }
```
Add more Supabase UI components: `npx shadcn@latest add @supabase/<component-name>`

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

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mukoko News is a Pan-African digital news aggregation platform. "Mukoko" means "Beehive" in Shona — where community gathers and stores knowledge. Primary market is Zimbabwe with expansion across 16 African countries.

## Three-Repo Architecture

This repo (`nyuchi/mukoko-news`) is the **Next.js frontend only**. It deploys to Vercel.

| Repo | Contents | Deploys to |
| --- | --- | --- |
| `nyuchi/mukoko-news` | Next.js 15 frontend | Vercel |
| `nyuchi/mukoko-news-gateway` | Cloudflare Workers API + MCP | Cloudflare Workers |
| `nyuchi/mukoko-news-pipeline` | Fly.io pipeline + Cloudflare processing | Fly.io + Cloudflare |

**Hard rules for this repo:**
- Frontend reads/writes directly to MongoDB Atlas via Next.js Server Actions — never through the gateway Worker
- The gateway (`news.mukoko.com/api/*`, `/mcp`) is a separate product API; the frontend does not call it except for **admin mutations** (see `src/lib/admin/gateway.ts`)
- The only external trigger is the pipeline refresh — one server action (`src/lib/actions/refresh.ts`) that pings the Fly.io worker's `/trigger/collect` endpoint

> History: the gateway and pipeline used to live in this repo. They were extracted in the v5.1.0 three-repo split (see `CHANGELOG.md`). If you find references to `backend/`, `fly-worker/`, `processing/`, etc., they are stale — those directories no longer exist here.

## Commands

The repo ships **both** a `package-lock.json` and a `pnpm-lock.yaml`. The human-facing docs (`README.md`, `CONTRIBUTING.md`) use **pnpm**, but **CI (`deploy.yml`) and the Husky pre-commit hook use `npm`**. Either works locally; if you change dependencies, update **both** lockfiles to keep them consistent (or CI's `npm ci` will drift from local `pnpm install`).

```bash
# pnpm (documented dev workflow) / npm equivalents both shown
pnpm dev              # next dev — dev server on :3000   (npm run dev)
pnpm build            # next build — production build      (npm run build)
pnpm start            # next start — serve the build       (npm run start)
pnpm lint             # next lint (ESLint)                 (npm run lint)
pnpm lint:fix         # next lint --fix                    (npm run lint:fix)
pnpm typecheck        # tsc --noEmit                       (npm run typecheck)
pnpm test             # vitest run (single run)            (npm run test)
pnpm test:watch       # vitest (watch mode)               (npm run test:watch)
pnpm test:coverage    # vitest run --coverage (v8)         (npm run test:coverage)
pnpm clean            # rm -rf .next out                   (npm run clean)

# Run a single test file
pnpm vitest run src/lib/__tests__/utils.test.ts
# Run tests matching a pattern (-t = test name)
pnpm vitest run -t "formatTimeAgo"

# Install dependencies / add a package
pnpm install          # or: npm ci  (CI uses npm ci)
pnpm add <package>    # or: npm install <package>
```

## Architecture

### Frontend Stack

- **Next.js 15** App Router with React 19 + TypeScript strict mode
- **Tailwind CSS 4.x** with CSS variables for theming (defined in `src/app/globals.css`)
- **Radix UI** primitives for accessible components
- **Lucide React** for icons, **next-themes** for dark mode
- **MongoDB driver v7** — Server Actions in `src/lib/actions/*.ts` call `src/lib/mongodb/*.ts` → MongoDB Atlas directly
- **WorkOS AuthKit** (`@workos-inc/authkit-nextjs`, `authkit-js`, `@workos-inc/node`) — authentication + RBAC
- **State**: React Context — `PreferencesContext` (`src/contexts/preferences-context.tsx`, country/category) and theme via `next-themes`
- **Path alias**: `@/*` maps to `src/*`

### Directory Map

```
src/
  app/                     # App Router pages (kebab-case dirs)
    page.tsx               # Home feed
    article/[id]/          # Article detail (server page + client component)
    discover/ search/ saved/ categories/ sources/ newsbytes/ insights/ analytics/
    admin/                 # RBAC-gated admin app (layout.tsx enforces tier)
    embed/ embed/iframe/   # Embeddable widget renderer
    auth/callback/route.ts # WorkOS OAuth callback
    api/                   # Route Handlers (engagement + health) — see below
    sitemap.ts globals.css layout.tsx
  components/              # UI + feature components
    ui/                    # Primitives (button, card, skeleton, error-boundary, json-ld, …)
    admin/ auth/ layout/   # Feature-scoped components
    article-card.tsx hero-card.tsx compact-card.tsx story-cluster.tsx share-modal.tsx …
  contexts/               # React Context providers
  lib/
    actions/              # 'use server' Server Actions (feed.ts, refresh.ts)
    mongodb/              # Mongo client + collection queries (articles, categories, sources, admin)
    admin/gateway.ts      # The ONLY frontend→gateway calls (admin mutations)
    auth/                 # roles.ts (RBAC tiers), actions.ts
    api.ts constants.ts utils.ts rate-limit.ts source-profiles.ts
  middleware.ts           # AuthKit session-refresh middleware
  __tests__/setup.ts      # Vitest global setup
```

### Data Flow (reads)

All news data reads go through Server Actions → MongoDB Atlas (`news` database). Server Actions live in `src/lib/actions/feed.ts` and delegate to `src/lib/mongodb/*.ts`:

| Server Action | Backed by | Returns |
| --- | --- | --- |
| `getSectionedFeedAction(params)` | articles/categories/sources | `SectionedFeed` (topStories, yourNews, byCategory, latest, …) |
| `getArticlesAction(params)` | `getArticles` | `{ articles: Article[], total: number }` |
| `getArticleAction(id)` | `getArticleById` | `Article \| null` |
| `getNewsBytesAction(limit)` | `getNewsByteArticles` | `Article[]` |
| `searchArticlesAction(q, …)` | `searchArticles` | `{ articles, total }` |
| `getSavedArticlesAction()` | `getSavedArticles` | `Article[]` |
| `getCategoriesAction()` | `getCategories` | `Category[]` |
| `getTrendingCategoriesAction(limit)` | `getTrendingCategories` | trending categories |
| `getSourcesAction()` | `getSources` | `Source[]` |
| `getStatsAction()` | `getStats` | aggregate stats |
| `getTrendingAuthorsAction(limit)` | `getTrendingAuthors` | trending authors |

`mongodb/client.ts` owns the singleton `MongoClient` (reads `MONGODB_URI` / `MONGODB_DATABASE`). `mongodb/admin.ts` powers admin **reads**; admin **writes** go through the gateway (below).

### Data Flow (writes / mutations)

- **Engagement** (like / view / save) — Next.js **Route Handlers** under `src/app/api/articles/[id]/{like,view,save}/route.ts` (`POST`, `runtime = 'nodejs'`), rate-limited via `src/lib/rate-limit.ts` (`checkRateLimit`, `getRequestIp`). `src/app/api/health/route.ts` is the health probe.
- **Admin mutations** — `src/lib/admin/gateway.ts` proxies to the gateway Worker's WorkOS-gated `/api/admin/*` endpoints, forwarding the WorkOS access token as a Bearer header so the Worker re-verifies the same RBAC. **This is the only place the frontend touches the gateway.**
- **Pipeline refresh** — `src/lib/actions/refresh.ts` `triggerFeedCollection()` fire-and-forget `POST`s to `FLY_WORKER_URL/trigger/collect` with `FLY_TRIGGER_TOKEN`.

### API Client (`src/lib/api.ts`)

Used for client-side fetches and the embed widget, and exports the shared `Article` type. `NEXT_PUBLIC_API_URL` is empty by default (relative URLs → Next.js Route Handlers → MongoDB). Only set it to an external URL for the Cloudflare widget/resale API.

## Testing

**~460 frontend tests across 21 files** — Vitest 4 with jsdom + React Testing Library.

- Config: `vitest.config.ts` (globals on, `@` alias, `include: src/**/*.{test,spec}.*`)
- Setup: `src/__tests__/setup.ts`
- Coverage (v8): thresholds **60%** statements/functions/lines, **50%** branches
- **Mock pattern for pages**: always mock `@/lib/actions/feed` (NOT `@/lib/api`) — pages read via Server Actions. Match the return shapes in the table above.

**Pre-commit hook** (Husky, `.husky/pre-commit`): runs `vitest related` on staged files, then `typecheck`, then `build`. All three must pass (uses `npm run`).

**CI** (`.github/workflows/deploy.yml`):
- `lint` matrix — actionlint, JSON validity, prettier (`**/*.json`), markdownlint (`**/*.md`), yamllint
- `test-frontend` — `npm ci` → `npm run test` → `npm run typecheck` → `npm run lint` → `npm run build` (Node 20)

There are also `claude.yml` and `claude-code-review.yml` workflows for the Claude GitHub app.

## Deployment

Auto-deploys to Vercel on push to `main`.

## MCP Servers

`.mcp.json` registers project-scoped MCP servers that load automatically in Claude Code.

| Server | Type / URL | Auth |
| --- | --- | --- |
| `mukoko-news` | http — `https://news.mukoko.com/mcp` | Product MCP (gateway) |
| `fly` | stdio — `flyctl mcp server` | Local `flyctl` auth |

**MongoDB access**: the nyuchi MongoDB MCP (`https://mongodb.nyuchi.dev/mcp`) is **not** project-scoped — it is added per-developer as a **personal Claude connector** (Claude → Settings → Connectors), not via this repo's `.mcp.json`. So it is not listed above.

## Environment Variables

### Frontend (`.env.local`) — see `.env.example` for the full annotated list

```bash
# Base URL
NEXT_PUBLIC_BASE_URL=https://news.mukoko.com

# MongoDB Atlas — Server Actions read/write directly
MONGODB_URI=mongodb+srv://<user>:<pass>@nyuchi-platform-doc-db.ge8d8qi.mongodb.net/?appName=nyuchi-platform-doc-db
MONGODB_DATABASE=news

# WorkOS AuthKit (inline sign-in on news.mukoko.com)
WORKOS_CLIENT_ID=client_01KV2G41CHGBSH6HG57AQBFKDD
WORKOS_API_KEY=sk_live_...
WORKOS_REDIRECT_URI=https://news.mukoko.com/auth/callback
WORKOS_COOKIE_PASSWORD=<32+ char random string>   # openssl rand -base64 32
WORKOS_PLATFORM_ORG_ID=org_...                     # platform-team org → /admin access

# External API (widget/resale only) — leave EMPTY; reads go through Server Actions
NEXT_PUBLIC_API_URL=

# Gateway Worker (admin mutations only)
GATEWAY_API_URL=https://news.mukoko.com

# Pipeline trigger (manual refresh action)
FLY_WORKER_URL=https://news-ingestion.fly-worker.nyuchi.dev
FLY_TRIGGER_TOKEN=...                              # must match the fly secret
```

## Authentication & RBAC (WorkOS AuthKit)

**WorkOS AuthKit** handles all user authentication. Web users sign in via the **embedded inline AuthKit form** on `news.mukoko.com` (`src/components/auth/inline-sign-in.tsx`) — they are **never** redirected to the hosted `identity.nyuchi.com` page.

- `src/middleware.ts` — AuthKit **session-refresh only** (`middlewareAuth` intentionally NOT enabled; it would force a hosted redirect). `/admin` is NOT gated here — cookie presence is spoofable.
- `src/app/admin/layout.tsx` — the **authoritative** admin gate: calls `withAuth()` and enforces RBAC via `src/lib/auth/roles.ts`, rendering inline sign-in for unauthenticated users.
- `src/app/auth/callback/route.ts` — WorkOS OAuth callback handler.
- `src/app/layout.tsx` — wraps the app in `AuthKitProvider`.

**RBAC tiers** (`src/lib/auth/roles.ts`) — `resolveTier(claims)` → `'none' | 'moderator' | 'admin' | 'superadmin'`:

- `superadmin` — WorkOS role `admin` within the platform-team org
- `admin` (staff) — any member of the platform-team org
- `moderator` — within platform-team, role `moderator`/`support` OR the `mukoko:news-moderator` permission
- `none` — everyone else

All grants are honored **only inside the platform-team org** (`WORKOS_PLATFORM_ORG_ID`) — WorkOS permission slugs are environment-wide, so an unscoped check would leak access across orgs. `canAccessAdmin(tier)` allows moderator and above.

**Usage in Server Components:**
```tsx
import { withAuth } from '@workos-inc/authkit-nextjs'
const { user } = await withAuth()
```

The MCP OAuth server (`news.mukoko.com/.well-known/oauth-authorization-server`, `/mcp`) lives in `nyuchi/mukoko-news-gateway`.

## Design System (Mukoko "Swarm" — doctrine v4.1.0)

**Mark**: the **Seed of Life** — one centre cell ringed by six, the first ring of the honeycomb, rendered in the 7 minerals with **tanzanite at the core**. Full-palette mark at ≥32px (`public/mukoko-mark-full-{light,dark}.svg`, used by `AppIcon`); mono-tanzanite favicon below 32px. App icon = full palette on deep tanzanite (`public/mukoko-appicon.png`). Never add gradients/shadows, recolour petals, or reorder the ring.

**Palette** — 7 **African Minerals**, each with light/dark + container/on-container values (full set in `src/app/globals.css`, theme-aware via the `.light`/`.dark` classes; mirrored in the brand kit `tokens/minerals.json`):

| mineral | light | dark | role |
| --- | --- | --- | --- |
| cobalt | `#0047AB` | `#00B0FF` | secondary / links / CTAs |
| tanzanite | `#4B0082` | `#B388FF` | **primary / brand** |
| malachite | `#004D40` | `#64FFDA` | success |
| gold | `#5D4037` | `#FFD740` | accent / rewards |
| terracotta | `#A0522D` | `#E1B07E` | warning / community |
| sodalite | `#283593` | `#3D5AFE` | AI / Shamwari surfaces |
| copper | `#BF5A36` | `#FF8A65` | commons |

`--primary`=tanzanite, `--secondary`=cobalt, `--accent`=gold, `--success`=malachite, `--warning`=terracotta. Use light hex on light surfaces, dark hex on dark.

**Typography**: **Noto Serif** (display/headings, wordmark = lowercase weight 600 — always "mukoko", never capitalised), **Noto Sans** (UI/body), **JetBrains Mono** (code/data/labels) — loaded via CSS `@import` with preconnect hints in `layout.tsx`.

**Spacing**: 12px border-radius buttons, 16px cards. WCAG AAA compliant (7:1 contrast).

CSS variables in `src/app/globals.css`. Use Tailwind classes: `bg-primary`, `text-foreground`, `bg-surface`, and the mineral utilities `bg-tanzanite`, `text-cobalt`, `bg-container-sodalite`, etc. (`components.json` configures the shadcn-style component generator; `tailwind.config.ts` holds the theme.)

## Code Conventions

Prettier (`.prettierrc.json`): single quotes, semicolons, 2-space tabs, `es5` trailing commas, 100 print width.

### Naming

- Components/services: PascalCase files (`ArticleCard.tsx`)
- Pages: kebab-case directories (`article/[id]/page.tsx`)
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

**Rate limiting**: Engagement Route Handlers use `checkRateLimit()` + `getRequestIp()` from `src/lib/rate-limit.ts`.

**Base URL helpers**: Use `BASE_URL`, `getArticleUrl(id)`, `getFullUrl(path)` from `src/lib/constants.ts` (which also exports `COUNTRIES`, `CATEGORY_META`, `getCategoryEmoji`).

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

### Embed Widget System

Embeddable news widgets for sister apps (e.g., weather.mukoko.com):

- Widget script: `public/embed/widget.js` (vanilla JS IIFE, ~2KB)
- Iframe renderer: `src/app/embed/iframe/page.tsx` (excluded from auth middleware matcher)
- 5 layouts (cards, compact, hero, ticker, list) × 4 feed types (top, featured, latest, location)
- Sandbox: `allow-scripts allow-popups allow-popups-to-escape-sandbox` (no `allow-same-origin`)

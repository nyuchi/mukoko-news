# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mukoko News is a Pan-African digital news aggregation platform. "Mukoko" means "Beehive" in Shona — where community gathers and stores knowledge. Primary market is Zimbabwe with expansion across 16 African countries.

## Three-Repo Architecture

This repo (`nyuchi/mukoko-news`) is the **Next.js frontend only**. It deploys to Vercel.

| Repo | Contents | Deploys to |
|---|---|---|
| `nyuchi/mukoko-news` | Next.js 15 frontend | Vercel |
| `nyuchi/mukoko-news-gateway` | Cloudflare Workers API + MCP | Cloudflare Workers |
| `nyuchi/mukoko-news-pipeline` | Fly.io pipeline + Cloudflare processing | Fly.io + Cloudflare |

**Hard rules for this repo:**
- Frontend reads/writes directly to MongoDB Atlas via Next.js Server Actions — never through the gateway Worker
- The gateway (`news.mukoko.com/api/*`, `/mcp`) is a separate product API; the frontend does not call it except for admin mutations (see `src/lib/admin/gateway.ts`)
- The only external trigger is the pipeline refresh (one server action that pings the fly-worker)

## Commands

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

## Architecture

### Frontend Stack

- **Next.js 15** App Router with React 19 + TypeScript strict mode
- **Tailwind CSS 4.x** with CSS variables for theming (defined in `src/app/globals.css`)
- **Radix UI** primitives for accessible components
- **Lucide React** for icons, **next-themes** for dark mode
- **MongoDB** — Server Actions in `src/lib/actions/feed.ts` call `src/lib/mongodb/*.ts` → MongoDB Atlas directly
- **WorkOS AuthKit** (`@workos-inc/authkit-nextjs`) — authentication, session management via `src/middleware.ts`
- **State**: React Context (`PreferencesContext` for country/category, `ThemeContext`)
- **Path alias**: `@/*` maps to `src/*`
- **Package manager**: pnpm (v10+)

### Data Flow

All news data reads go through Server Actions → MongoDB Atlas (`news` database):

- `src/lib/actions/feed.ts` — `getArticlesAction`, `getCategoriesAction`, `getSourcesAction`, `getKeywordsAction`
- `src/lib/mongodb/articles.ts` — article queries
- `src/lib/mongodb/categories.ts` — category queries
- `src/lib/mongodb/sources.ts` — source queries

**Return shapes** (important for test mocks):
- `getArticlesAction(params)` → `{ articles: Article[], total: number }`
- `getCategoriesAction()` → `Category[]`
- `getSourcesAction()` → `Source[]`

Admin mutations call the gateway Worker (`src/lib/admin/gateway.ts`) — this is the only place the frontend touches the gateway, and only with WorkOS access tokens.

### API Client (`src/lib/api.ts`)

Used for client-side fetches and the embed widget. `NEXT_PUBLIC_API_URL` is empty by default (relative URLs → Next.js Route Handlers → MongoDB). Only set it to an external URL for the Cloudflare widget/resale API.

## Testing

**448 frontend tests** — Vitest with jsdom environment + React Testing Library

- Setup: `src/__tests__/setup.ts`
- Coverage thresholds: 60% statements/functions/lines, 50% branches
- **Mock pattern for pages**: Always mock `@/lib/actions/feed` (NOT `@/lib/api`) since pages use Server Actions

**Pre-commit hook** (Husky): typecheck + build validation

**CI** (`.github/workflows/deploy.yml`): lint matrix (actionlint, JSON validity, prettier, markdownlint, yamllint) + `test-frontend` (tests, typecheck, lint, build)

## Deployment

Auto-deploys to Vercel on push to main.

## MCP Servers

`.mcp.json` registers project-scoped MCP servers that load automatically in Claude Code.

| Server | URL | Auth |
|---|---|---|
| `nyuchi-mongodb` | `https://mongodb.nyuchi.dev/mcp` | OAuth — each developer authenticates on first use; tokens stored in `~/.claude.json`, never committed |

**First-time setup**: On session start, Claude Code will prompt for OAuth authentication with `nyuchi-mongodb`. This grants read/write access to the MongoDB cluster. Only team members with nyuchi.dev credentials should approve this.

## Environment Variables

### Frontend (`.env.local`)

```bash
# MongoDB Atlas — Server Actions read/write directly
MONGODB_URI=mongodb+srv://<user>:<pass>@nyuchi-platform-doc-db.ge8d8qi.mongodb.net/?appName=nyuchi-platform-doc-db
MONGODB_DATABASE=news

# Leave empty — Server Actions serve all reads from MongoDB.
# Set to Cloudflare Worker URL only for the external widget/resale API.
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_BASE_URL=https://news.mukoko.com

# WorkOS AuthKit
WORKOS_API_KEY=sk_live_...
WORKOS_CLIENT_ID=client_01KV2G41CHGBSH6HG57AQBFKDD
WORKOS_COOKIE_PASSWORD=<32+ char random string>

# Gateway Worker (admin mutations only)
GATEWAY_API_URL=https://news.mukoko.com
```

## Authentication (WorkOS AuthKit)

**WorkOS AuthKit** handles all user authentication via the custom auth domain `identity.nyuchi.com`.

- `src/middleware.ts` — AuthKit session-refresh middleware (no forced redirect; embedded sign-in handles gating)
- `src/app/auth/callback/route.ts` — WorkOS OAuth callback handler
- `src/app/layout.tsx` — wraps app in `AuthKitProvider`

**Usage in Server Components:**
```tsx
import { withAuth } from '@workos-inc/authkit-nextjs'
const { user } = await withAuth()
```

The MCP OAuth server (`news.mukoko.com/.well-known/oauth-authorization-server`, `/mcp`) lives in `nyuchi/mukoko-news-gateway`.

## Design System (Nyuchi Brand v6)

**Colors** (African Minerals palette): Primary Tanzanite (#4B0082), Secondary Cobalt (#0047AB), Accent Gold (#5D4037), Success Malachite (#2E8B57), Warning Terracotta (#E07A4D), Surface Warm Cream (#FAF9F5)

**Typography**: Noto Serif (headings), Plus Jakarta Sans (body) — loaded via CSS `@import` with preconnect hints in layout.tsx

**Spacing**: 12px border-radius buttons, 16px cards. WCAG AAA compliant (7:1 contrast).

CSS variables in `src/app/globals.css`. Use Tailwind classes: `bg-primary`, `text-foreground`, `bg-surface`, etc.

## Code Conventions

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

### Embed Widget System

Embeddable news widgets for sister apps (e.g., weather.mukoko.com):

- Widget script: `public/embed/widget.js` (vanilla JS IIFE, ~2KB)
- Iframe renderer: `src/app/embed/iframe/page.tsx`
- 5 layouts (cards, compact, hero, ticker, list) × 4 feed types (top, featured, latest, location)
- Sandbox: `allow-scripts allow-popups allow-popups-to-escape-sandbox` (no `allow-same-origin`)

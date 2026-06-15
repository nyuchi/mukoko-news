# Changelog

All notable changes to Mukoko News will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.0.0] - 2026-06-15

### Added

- **newsdata.io ingestion** (`fly-worker`): New `newsdata_collector` job runs every 6 h, ingesting articles from 16 African countries across English and French language batches. Probes 9 RSS paths on new sources — creates active `feedSource` if found, inactive placeholder otherwise. All discovered sources logged in `news.sourceDiscoveryCandidates`.
- **MongoDB Atlas search indexes**: `articles_vector_search` (1024-dim BGE-M3 cosine via `$vectorSearch`) and `articles_text_search` (lucene.english fuzzy via `$search`). `getRelatedArticles()` and `searchArticles()` now use Atlas search with regex fallback.
- **MCP server v2.0.0** (`backend/mcp/server.ts`): Complete rewrite to task-based tools supporting country codes (ZW, KE), region names (East Africa), and city names (Harare, Lagos). Task tools: `get_briefing`, `track_story`, `get_location_news`, `compare_locations`, `get_source_view`, `find_stories`, `get_my_feed`. Open data analytics: `get_trending_analytics`, `detect_surge`, `get_content_analytics`.
- **CI test coverage**: `test-image-worker`, `test-fundi-enrichment`, and `smoke-tests` jobs added — smoke tests check all live endpoints after every Fly.io deploy.
- **OpenAPI schema**: Expanded from 6 to 84 paths covering backend, fly-worker, and fundi enrichment worker.
- **fly-worker README**: Full documentation for pipeline worker — jobs, endpoints, secrets, deployment.
- **New tests**: `fly-worker/tests/test_trigger_collect.py`, `src/lib/__tests__/rate-limit.test.ts`, `src/lib/__tests__/refresh.test.ts`.

### Changed

- **fly-worker**: Pure pipeline worker (`mukoko-news-api` on Fly.io). `POST /trigger/collect` is rate-limited (3/min) with no authentication.
- **fundi-news-enrichment**: Added `pnpm-lock.yaml` so Cloudflare GitHub App CI installs dependencies correctly.
- **image-worker**: Added to CI (`test-image-worker` typecheck job).

### Security

- **IDOR fixes** (`backend/index.ts`): Four `/api/user/*` handlers replaced `c.req.query('userId')` with `getCurrentUserId(c)` — identity now comes from verified JWT, not query param.
- **Admin gate**: `POST /api/feed/initialize-sources` now requires admin role via `requireAdminRole()`.
- **Input clamping**: `POST /api/articles/:id/view` clamps `reading_time` (0–3600 s) and `scroll_depth` (0–100%).

### Fixed

- **Fly.io app name**: `fly.toml` corrected to `mukoko-news-api` (was `mukoko-news`).
- **DNS**: `news-ingestion.fly-worker.nyuchi.dev` CNAME updated to point at `mukoko-news-api.fly.dev`.
- **fundi CI**: 3-second build failures fixed by adding `pnpm-lock.yaml` to the subdirectory.

---

## [4.0.2] - 2026-01-24

### Added

- **Schema.org JSON-LD**: Structured data for SEO (NewsArticle, Organization, BreadcrumbList)
- **Mobile Bottom Navigation**: Quick access to Home, Discover, NewsBytes, Search, Profile
- **Breadcrumb Navigation**: Clear navigation hierarchy on article pages
- **Country Selector Integration**: Onboarding modal country selection now filters news feed
- **Centralized Constants**: Single source of truth for countries and categories (`src/lib/constants.ts`)
- **BASE_URL Utilities**: `getArticleUrl()` and `getFullUrl()` for consistent URL generation
- **JSON-LD XSS Prevention**: Unicode escaping for `<`, `>`, `&` in structured data
- **Font Preconnect**: Improved font loading with preconnect hints for Google Fonts
- **safeCssUrl Utility**: Centralized `encodeURI`-based CSS `url()` builder in `src/lib/utils.ts`
- **Security Test Suite**: Comprehensive injection and attack vector tests (CSS, XSS, JSON-LD, URL traversal)
- **New Tests**: 131 total tests (+38 security tests for injection, leak, and attack vector coverage)

### Fixed

- **XSS Vulnerabilities**: Fixed potential XSS in Avatar, NewsBytes, and JSON-LD components
- **Memory Leak**: Fixed timeout cleanup in article page share functionality
- **SSR Safety**: Fixed server-side rendering issues with window.location usage
- **useEffect Dependencies**: Fixed React hook dependency chain - `fetchData` now derives countries from `countryKey`
- **Stale Closure**: Pull-to-refresh uses ref pattern to avoid re-registering touch listeners on every state change
- **Performance**: Fixed O(n²) keyword cloud rendering with memoization
- **Theme Consistency**: Replaced hardcoded colors in onboarding modal with theme tokens
- **Breadcrumb Keys**: Use stable keys (`href || label`) without index fallback
- **Clipboard Fallback**: Added error handling and success check for legacy `document.execCommand("copy")`
- **Bottom Nav Routing**: Anchored regex `/^\/article\/[^/]+$/` to match exact article paths only
- **IntersectionObserver**: NewsBytes observer depends on `bytes.length` to avoid unnecessary re-creation
- **Article Page Dependencies**: Wrapped `loadArticle` in `useCallback` with proper effect dependency
- **Pull-to-Refresh**: Moved `rafId` to ref for safer cleanup on unmount

### Changed

- **Simplified Feed Layout**: Reduced from 5 sections to 2 (Featured + Latest)
- **Font Loading**: Switched from next/font to CSS @import for build reliability
- **Card Styling**: Updated to thin 1px border instead of one-sided border
- **Article Cards**: Removed misleading "Read Original" Google search link

### Security

- **JSON-LD Escaping**: All JSON-LD content sanitized with Unicode escaping
- **Image URL Validation**: Added `isValidImageUrl()` checks to prevent XSS via image URLs
- **CSS Injection Prevention**: Centralized `safeCssUrl()` with `encodeURI()` for standards-compliant CSS URL escaping

---

## [4.0.1] - 2025-12-31

### Added

- **Keywords API**: New `/api/keywords` endpoint for trending topics
- **Tag Cloud**: Trending Topics section on Discover page with dynamic font sizing
- **TikTok Desktop Layout**: NewsBytes maintains centered vertical frame on desktop/tablet (9:16 aspect ratio)
- **Pan-African Country Support**: RSS articles now inherit country_id from their source

### Fixed

- **Country Display**: Discover page now shows all 12 Pan-African countries regardless of article count
- **Category Filtering**: Articles filter correctly using category_id from API

### Changed

- **NewsBytes Layout**: Mobile-first vertical experience preserved on larger screens with centered frame
- **Article Cards**: Support both category and category_id fields from API

---

## [4.0.0] - 2025-12-31

### Added

- **Next.js 15 Frontend**: Complete migration from React Native Expo to Next.js
- **Tailwind CSS 4**: Modern styling with CSS variables and design tokens
- **Dark Mode Support**: Full theme support with next-themes and system detection
- **TikTok-Style NewsBytes**: Vertical scroll feed with CSS scroll-snap
- **Radix UI Components**: Accessible primitives for dialogs, dropdowns, tabs
- **Error Boundaries**: Graceful error handling throughout the app
- **Responsive Design**: Mobile-first design that works on all devices

### Changed

- **Framework Migration**: React Native Expo → Next.js 15 with App Router
- **Styling System**: React Native Paper → Tailwind CSS 4
- **Build System**: Expo build → Next.js build with Vercel deployment
- **Environment Variables**: `EXPO_PUBLIC_*` → `NEXT_PUBLIC_*`
- **GitHub Actions**: Updated workflows for Next.js (removed mobile tests)
- **Documentation**: Updated README.md, CLAUDE.md for Next.js architecture

### Removed

- **React Native/Expo**: Removed `mobile/` directory and all Expo dependencies
- **React Native Paper**: Replaced with Tailwind CSS
- **AsyncStorage**: No longer needed (using browser APIs)
- **React Navigation**: Replaced with Next.js App Router
- **Legacy Documentation**: Removed NativeWind migration docs, old config files
- **Expo-specific files**: vercel.json (Expo config), react-router.config.ts

### Frontend Stack

- **Framework**: Next.js 15 with App Router
- **UI**: Tailwind CSS 4 with custom design tokens
- **Components**: Radix UI primitives
- **Icons**: Lucide React
- **Theme**: next-themes for dark mode
- **TypeScript**: Full type safety
- **React**: React 19

### Pages

- `/` - Home feed with article cards
- `/discover` - Browse articles with category/source filters
- `/newsbytes` - TikTok-style vertical scroll feed
- `/article/[id]` - Full article view
- `/search` - Search articles
- `/profile` - User settings and theme toggle
- `/admin` - Admin dashboard (analytics, sources, users, system)
- `/help`, `/terms`, `/privacy` - Static info pages

## [0.1.0] - 2025-12-20

### Added

- Initial release of Mukoko News
- Cloudflare Workers backend with Hono framework
- React Native Expo mobile app (iOS, Android, Web)
- D1 database with 17 migrations
- Pan-African news aggregation from 16 countries
- RSS feed collection and processing
- User authentication via OIDC (id.mukoko.com)
- Role-based access control (RBAC) with admin role
- Article interactions tracking (likes, saves, views)
- Real-time analytics with Durable Objects
- Semantic search with Cloudflare Vectorize
- AI-powered content processing with Workers AI
- Offline-first mobile app with IndexedDB caching
- Nyuchi Brand v6 design system (Tanzanite, Cobalt, Gold)
- Admin dashboard with analytics
- Health check endpoint for monitoring
- Comprehensive test suite (Vitest + Jest)
- Pre-commit hooks (TypeScript check + build validation)
- ESLint 9 flat config

### Backend Features

- **API Framework**: Hono (lightweight, fast)
- **Database**: Cloudflare D1 (SQLite at edge)
- **Cache**: KV Namespaces for session storage
- **Real-time**: 4 Durable Objects classes
  - ArticleInteractions
  - UserBehavior
  - RealtimeCounters
  - RealtimeAnalytics
- **AI**: Workers AI for content processing
- **Search**: Vectorize for semantic search
- **Cron Jobs**: Scheduled RSS collection
- **Analytics**: Analytics Engine for metrics

---

## Version History

- **[4.0.2]** - 2026-01-24 - Schema.org SEO, mobile bottom nav, simplified feed, XSS fixes
- **[4.0.1]** - 2025-12-31 - Keywords API, TikTok desktop layout, Pan-African country support
- **[4.0.0]** - 2025-12-31 - Next.js migration (major rewrite)
- **[0.1.0]** - 2025-12-20 - Initial release (React Native Expo)

## Links

- [Repository](https://github.com/nyuchitech/mukoko-news)
- [Issues](https://github.com/nyuchitech/mukoko-news/issues)
- [Pull Requests](https://github.com/nyuchitech/mukoko-news/pulls)
- [Security Policy](SECURITY.md)
- [Contributing Guide](CONTRIBUTING.md)

---

"Ndiri nekuti tiri" — I am because we are

Built with love by [Nyuchi Technologies](https://brand.nyuchi.com)

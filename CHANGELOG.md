# Changelog

All notable changes to Mukoko News will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [5.3.0] - 2026-07-02

### Added

- **On-site MFA (TOTP) step-up for inline sign-in.** When an account has MFA enabled, WorkOS returns an `mfa_challenge` / `mfa_enrollment` step-up after a correct Magic Auth code. `src/lib/auth/actions.ts` now resolves it (`verifyEmailCode` challenges the enrolled TOTP factor, or enrols a new one and returns its QR; new `verifyMfaCode` completes the second factor via `authenticateWithTotp`), and `inline-sign-in.tsx` renders the authenticator-code step on-site — no hosted redirect. See `auth.md`.
- **Segmented 6-box one-time-code input** shared by the emailed Magic Auth code and the authenticator code (auto-advance, paste, backspace, arrow keys).

### Changed

- `InlineSignIn` reworked into a three-step flow (email → code → MFA); MFA enrolment shows a scannable QR + manual secret fallback.

## [5.2.0] - 2026-06-27

### Changed

- **Brand refresh: Mukoko "Swarm" identity** (doctrine v4.1.0). Replaces the Nyuchi Brand v6 styling.
  - **Palette**: full **7 African Minerals** palette (cobalt, tanzanite, malachite, gold, terracotta, sodalite, copper) — each with light/dark + container/on-container values — added as theme-aware CSS variables in `src/app/globals.css` and exposed as Tailwind utilities. `--primary`=tanzanite, `--secondary`=cobalt, `--accent`=gold, `--success`=malachite, `--warning`=terracotta. Cobalt-dark corrected to `#00B0FF`.
  - **Mark**: new **Seed-of-Life** mark (7 hexes, tanzanite core) drives the header logo (`AppIcon` now renders `mukoko-mark-full-{light,dark}.svg`).
  - **App icons + favicon**: new full-palette app icons on deep tanzanite (`public/mukoko-appicon.png` + `-paper`/`-mono-tanzanite`), mono-tanzanite favicon set (`favicon.svg`, `favicon-dark.svg`, `favicon-{16,32,48,180}.png`), and Seed-of-Life lockups. `manifest.json` / layout metadata / theme-color updated (`#4B0082`).
  - **Typography**: body now **Noto Sans** (was Plus Jakarta Sans); headings stay **Noto Serif**; **JetBrains Mono** added for code/data. Wordmark is lowercase Noto Serif 600.

---

## [5.1.1] - 2026-06-27

### Fixed

- **Feed categories & keywords now read from the `engagement` subdocument**: `toArticle` resolves the display category from `engagement.interest_categories` (falling back to `articleSection`) and maps `engagement.tags` → `keywords` — handling both string- and object-shaped elements. Previously every article showed as **"general"** because the category was read from `articleSection`, which the RSS collector hardcodes.
- **Raw HTML no longer leaks into the article body**: new `stripHtml()` util (block tags → newlines, tags removed, common entities decoded, `script`/`style` dropped) cleans `content` in `toArticle`; the detail view drops empty paragraphs. Hardened against the CodeQL incomplete-multi-character-sanitization finding. +7 `stripHtml` unit tests.

### Added

- **"Read original" button** on the article page linking to the source URL.

### Notes

- Cross-repo (gateway/pipeline) work shipped alongside this release: the gateway migrated off the decommissioned `mukoko-news-api` Worker to **direct MongoDB reads + a fly-worker collection trigger**, consolidated to a single `POST /api/refresh`, and added a platform-team-gated **`trigger_enrichment` MCP tool**; the fly-worker's RSS fetch interval is now tunable via `RSS_COLLECTION_INTERVAL_MINUTES`. See the `mukoko-news-gateway` and `mukoko-news-pipeline` repos.

---

## [5.1.0] - 2026-06-21

### Changed

- **Three-repo split**: This repository (`nyuchi/mukoko-news`) is now the Next.js frontend only.
  - Gateway (Cloudflare Workers API + MCP) → [`nyuchi/mukoko-news-gateway`](https://github.com/nyuchi/mukoko-news-gateway)
  - Pipeline (Fly.io + Cloudflare processing) → [`nyuchi/mukoko-news-pipeline`](https://github.com/nyuchi/mukoko-news-pipeline)
- **Data access**: Pages now use MongoDB Server Actions (`src/lib/actions/feed.ts`) directly — no Cloudflare Worker API calls for reads
- **CI**: `.github/workflows/deploy.yml` reduced to `lint` + `test-frontend` jobs only
- **CLAUDE.md**, **README.md**, **CONTRIBUTING.md**, **SECURITY.md**: Rewritten to reflect frontend-only scope

### Removed

- `backend/`, `database/`, `mcp-package/` — moved to `nyuchi/mukoko-news-gateway`
- `fly-worker/`, `processing/`, `fundi-news-enrichment/`, `image-worker/` — moved to `nyuchi/mukoko-news-pipeline`
- `api-schema.yml`, `tsconfig.cloudflare.json`, `worker-configuration.d.ts` — gateway-specific
- `Dockerfile`, `fly.toml`, `docker-entrypoint.js` — pipeline-specific
- `scripts/dev-local.sh`, `scripts/generate-sitemap.js`, `test-backend-api.sh` — no longer applicable
- `.cloudflare/workers.json`, `.wranglerignore`, `.dockerignore` — not needed in frontend repo
- `plan.md` — stale planning document
- Root-level npm scripts for backend/pipeline (`dev:backend`, `build:backend`, `deploy:api`, etc.)

### Fixed

- Test mocks updated: `sources-page.test.tsx`, `embed-iframe.test.tsx`, `discover-page.test.tsx` now mock `@/lib/actions/feed` (Server Actions) instead of the removed `@/lib/api`
- `tsconfig.json` `exclude` list cleaned of non-existent directories

---

## [5.0.0] - 2026-06-15

### Added

- **newsdata.io ingestion** (pipeline): New collector runs every 6 h, ingesting articles from 16 African countries. Probes 9 RSS paths on new sources — creates active `feedSource` if found, inactive placeholder otherwise.
- **MongoDB Atlas search indexes**: `articles_vector_search` (1024-dim BGE-M3 cosine) and `articles_text_search` (lucene.english fuzzy). Related articles and search now use Atlas search with regex fallback.
- **MCP server v2.0.0**: Task-based tools supporting country codes (ZW, KE), region names, and city names. Tools: `get_briefing`, `track_story`, `get_location_news`, `compare_locations`, `get_source_view`, `find_stories`, `get_my_feed`, `get_trending_analytics`, `detect_surge`, `get_content_analytics`.
- **Sources page** (`/sources`): Full directory of all news sources with stats, filtering, and sorting.
- **New tests**: `src/lib/__tests__/rate-limit.test.ts`, `src/lib/__tests__/refresh.test.ts`.

### Security

- **IDOR fixes**: Four `/api/user/*` handlers replaced query-param userId with identity from verified JWT.
- **Admin gate**: Feed source initialization now requires admin role.
- **Input clamping**: View endpoint clamps `reading_time` (0–3600 s) and `scroll_depth` (0–100%).

### Fixed

- Fly.io app name corrected in configuration.

---

## [4.0.2] - 2026-01-24

### Added

- **Schema.org JSON-LD**: Structured data for SEO (NewsArticle, Organization, BreadcrumbList)
- **Mobile Bottom Navigation**: Quick access to Home, Discover, NewsBytes, Search, Profile
- **Breadcrumb Navigation**: Clear navigation hierarchy on article pages
- **Country Selector Integration**: Country selection filters the news feed
- **Centralized Constants**: Countries and categories in `src/lib/constants.ts`
- **BASE_URL Utilities**: `getArticleUrl()` and `getFullUrl()` for consistent URL generation
- **JSON-LD XSS Prevention**: Unicode escaping for `<`, `>`, `&` in structured data
- **safeCssUrl Utility**: Centralized CSS `url()` builder in `src/lib/utils.ts`
- **Security Test Suite**: Injection and attack vector tests (+38 security tests)

### Fixed

- XSS vulnerabilities in Avatar, NewsBytes, and JSON-LD components
- Memory leak in article page share timeout cleanup
- SSR safety: fixed `window.location` usage in server context
- Stale closure in pull-to-refresh (now uses ref pattern)
- O(n²) keyword cloud rendering — memoized
- Breadcrumb keys use stable `href || label`, not array index
- Bottom nav routing uses anchored regex to match exact article paths

### Changed

- Simplified feed layout: Featured + Latest (from 5 sections)
- Font loading: switched from `next/font` to CSS `@import`

---

## [4.0.1] - 2025-12-31

### Added

- **Tag Cloud**: Trending Topics section on Discover page
- **TikTok Desktop Layout**: NewsBytes centered vertical frame on desktop (9:16 aspect ratio)
- **Pan-African Country Support**: RSS articles inherit `country_id` from their source

### Fixed

- Discover page shows all 54 countries regardless of article count
- Category filtering uses `category_id` correctly

---

## [4.0.0] - 2025-12-31

### Added

- **Next.js 15 Frontend**: Complete migration from React Native Expo
- **Tailwind CSS 4**: CSS variables and design tokens
- **Dark Mode**: next-themes with system detection
- **TikTok-Style NewsBytes**: Vertical scroll feed with CSS scroll-snap
- **Radix UI**: Accessible primitives for dialogs, dropdowns, tabs
- **Error Boundaries**: Graceful error handling throughout

### Changed

- Framework: React Native Expo → Next.js 15 App Router
- Styling: React Native Paper → Tailwind CSS 4
- Build: Expo → Next.js / Vercel
- Environment variables: `EXPO_PUBLIC_*` → `NEXT_PUBLIC_*`

### Removed

- `mobile/` directory and all React Native / Expo dependencies

---

## [0.1.0] - 2025-12-20

### Added

- Initial release: Cloudflare Workers backend (Hono), React Native Expo app, D1 database, Pan-African RSS aggregation, WorkOS authentication, RBAC, real-time analytics

---

## Version History

| Version | Date | Summary |
|---------|------|---------|
| [5.1.0] | 2026-06-21 | Three-repo split — frontend only |
| [5.0.0] | 2026-06-15 | newsdata.io ingestion, MCP v2, Sources page |
| [4.0.2] | 2026-01-24 | Schema.org SEO, mobile nav, XSS fixes |
| [4.0.1] | 2025-12-31 | Keywords API, TikTok desktop layout |
| [4.0.0] | 2025-12-31 | Next.js migration |
| [0.1.0] | 2025-12-20 | Initial release (React Native Expo) |

## Links

- [Repository](https://github.com/nyuchi/mukoko-news)
- [Issues](https://github.com/nyuchi/mukoko-news/issues)
- [Security Policy](SECURITY.md)
- [Contributing Guide](CONTRIBUTING.md)

---

"Ndiri nekuti tiri" — I am because we are

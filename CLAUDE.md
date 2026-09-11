# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Canonical docs:** `agents.md` (task rules + data-flow boundaries), `review.md` (merge gate / review checklist), and `auth.md` (trust model) are the authoritative rule set for this repo. This file carries the full architecture detail and stays consistent with them.

## Project Overview

Mukoko News is a Pan-African digital news aggregation platform. "Mukoko" means "Beehive" in Shona — where community gathers and stores knowledge. Primary market is Zimbabwe. **Scope is all 54 African Union member states; the live count is a QUERY, not a constant** — `getLiveCoverageAction()` (`src/lib/actions/coverage.ts`) counts the countries that actually cleared the aggregation bar in the last 30 days, and `coverageFragment(n)` / `coverageClaim(n)` in `src/lib/constants.ts` are the only sanctioned wording. Every public surface interpolates them rather than writing a number, so a country that starts producing appears on its own and one that goes dark drops off on its own. `FALLBACK_LIVE_COUNTRY_CODES` is a failure floor for when the read fails — never the source of the claim. (This **supersedes** the earlier "16 are released" line and its `RELEASED_COUNTRY_CODES` / `COVERAGE_CLAIM` symbols, which no longer exist.)

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
- The header's date/time + weather strip (`src/components/layout/datetime-weather.tsx`) reads the sibling weather app's PUBLIC embed endpoint `weather.mukoko.com/api/embed/current` via `src/lib/weather.ts` — **from the reader's browser only, never server-side**. The endpoint derives the location from the caller's IP, so a server-side call would hand every reader the Vercel datacenter's location (measured: `"Your location"`, 37.751/-97.822, the US centroid). It is not a gateway call, it is fail-soft (any failure renders no weather at all), and it is suppressed on `/newsbytes` and `/embed*`.

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
- **WorkOS AuthKit** (`@workos-inc/authkit-nextjs`, `@workos-inc/authkit-js`, `@workos-inc/node`) — authentication (WorkOS-hosted AuthKit page — owns MFA + the shared cross-app session) + RBAC
- **State**: React Context — `PreferencesContext` (`src/contexts/preferences-context.tsx`, country/category; edited from the onboarding modal, the home feed picker, and `/profile` via `components/profile/profile-preferences.tsx` — **localStorage only**, so it is per-device and does NOT follow the account across the Mukoko apps yet) and theme via `next-themes`
- **Path alias**: `@/*` maps to `src/*`

### Directory Map

```
src/
  app/                     # App Router pages (kebab-case dirs)
    page.tsx               # Home feed (home-client.tsx = its client half)
    article/[id]/          # Article detail (server page + client component)
    author/[...slug]/      # Byline page — /author/<person> or /author/<newsroom>/<desk>
    topic/[slug]/          # Developing-story timeline (Mzizi nyuchi-timeline, ISR 300s)
    discover/ search/ saved/ categories/ sources/ newsbytes/ insights/ analytics/
    profile/ dashboard/ publishers/claim/
    about/ help/ privacy/ terms/ offline/
    admin/                 # RBAC-gated admin app (layout.tsx enforces tier)
                           # analytics/ articles/ publishers/ sources/ system/ users/
    embed/ embed/iframe/   # Embeddable widget renderer
    sign-in/               # The single sign-in entry point
    auth/login/route.ts    # AuthKit initiate-login (the only getSignInUrl call site)
    auth/callback/route.ts # WorkOS OAuth callback
    .well-known/           # MCP + OAuth discovery documents
    api/                   # Route Handlers — see Data Flow below
    llms.txt/ robots.txt/ auth.md/ api/agent-md/   # agent-readable docs, served as routes
    sitemap.ts manifest.ts globals.css layout.tsx error.tsx global-error.tsx
  components/              # UI + feature components
    ui/                    # Primitives (button, card, skeleton, error-boundary, json-ld, …)
    admin/ agent/ article/ brand/ layout/ profile/ publisher/ pwa/
    article-card.tsx hero-card.tsx compact-card.tsx story-cluster.tsx share-modal.tsx …
  contexts/               # React Context providers (preferences, coverage)
  lib/
    actions/              # 'use server' Server Actions — feed, authors, analytics,
                          # insights, coverage, profile, article-metrics, refresh, …
    mongodb/              # Mongo client + collection queries (articles, authors,
                          # analytics, insights, coverage, identity, entity, places, …)
    admin/gateway.ts      # The ONLY frontend→gateway calls (admin mutations)
    auth/                 # roles.ts (RBAC tiers), entity-access.ts, actions.ts
    publisher/ pwa/
    api.ts constants.ts countries.ts utils.ts safety.ts rate-limit.ts
    author-identity.ts publisher-icon.ts source-profiles.ts image.ts
    appearance.ts engagement.ts weather.ts security-headers.ts agent-discovery.ts …
  middleware.ts           # AuthKit session-refresh middleware
  __tests__/setup.ts      # Vitest global setup
```

### Navigation (`src/lib/navigation.ts`)

**One registry, three surfaces.** `DESTINATIONS` is every page a reader can go to, grouped; the nav sidebar, the mobile bottom bar and `/profile` all read it (the footer takes four legal links from the same registry through `pick()`). Each used to carry its own hand-written array and they had drifted — the header dropdown named ten destinations and omitted `/sources`, `/about`, `/terms`, `/privacy` and `/publishers/claim`; the footer named five, none of them a reading surface — so **no surface in the app could reach every page**. `pick(...hrefs)` **throws** on an unknown href rather than rendering a shorter bar, and `navigation.test.ts` walks the App Router directory and fails when a route has a page but is neither registered nor listed in `NOT_DESTINATIONS` with a reason. Adding a page and linking it from nowhere is now a CI failure. `/admin` is deliberately excluded: it is RBAC-gated, and listing it for everyone advertises a door almost nobody can open.

**The full map is a SIDEBAR, not a drawer and not the footer** (owner decision 2026-09-11, superseding the drawer of 2026-09-10). `components/layout/nav-sidebar.tsx` holds every destination and has **two modes from one DOM tree**:

| | docked (`lg`+) | overlay (below `lg`) |
| --- | --- | --- |
| role | `navigation` landmark | `dialog` + `aria-modal` |
| page | inset by `--sidebar-width` | **pushed aside** by `--sidebar-overlay-width`, dimmed |
| choosing a page | **stays open** | closes |
| focus / scroll | untouched | trapped / locked |
| Escape | ignored | closes |

The docked column is the point. It first shipped as a modal drawer that closed on every navigation, and owner review named that exactly right: *"what you showed us was just a menu dropdown"*. **A menu that closes on every click is a dropdown**; a sidebar is the thing you navigate *from*, repeatedly, with it still there. Below `lg` there is no room for an 18rem column beside an article, so it overlays — and the four modal behaviours belong to the overlay **only**: docked, a focus trap strands a keyboard reader inside a panel that is simply part of the page, and a scroll lock freezes a document nothing is covering.

It is **one DOM tree reshaped by responsive classes plus an `isDocked` flag**, never two subtrees behind `lg:hidden` — jsdom applies no media queries, so both would render in every test and every `getByRole` would match twice (the trap the deleted `ArticleActionBar` is the cautionary tale for — see the island note below). `isDocked` comes from `matchMedia`, because focus trapping, scroll locking and closing-on-navigation cannot be expressed in CSS, and it is kept **live** so a rotated tablet gets the right behaviour rather than the one its viewport had at mount.

**The breakpoint is 1024px in two places and must stay that way** — `SIDEBAR_DOCK_BREAKPOINT_PX` builds the `matchMedia` query, and a `@media (min-width: 1024px)` rule in `globals.css` insets the page. `sidebar.test.ts` asserts they still agree: a drift leaves a band of widths where the page is inset for a sidebar that still behaves like a modal.

**Below `lg` the page is PUSHED, not covered** (owner direction 2026-09-11, with the Claude mobile sidebar as the reference). The shell translates right by exactly the panel's width and stays on screen, dimmed, with its leading corner rounded — so it reads as the page you were on, moved aside, and it is obvious you get back by tapping it. A panel that merely covers the page leaves nothing to aim at but a scrim. **`--sidebar-overlay-width` is the panel's width AND the push distance**, one value: short and a strip of page is still covered, long and there is a band of void beside it; `sidebar.test.ts` asserts both read the same token. It is capped at `86vw` so a narrow phone never pushes the page clean off the right edge, leaving the way back invisible. The floating bottom pill moved **inside** `.app-shell` for this — left outside it would hang over the sidebar while everything beneath it slid away.

The push uses `transform`, not `margin-left`, to stay off the layout path. The cost is that a non-`none` transform makes the shell the containing block for `position: fixed` descendants — the island, chiefly — so the page's pinned furniture travels with the page, which is what you want while the sidebar is open. Closed, the transform is `none` and nothing is contained (`none` interpolates as the identity transform, so it still animates).

**The page inset is CSS keyed off `data-sidebar`, not React state**, set pre-paint by the same bootstrap that restores the theme and outlines. The panel may arrive a frame late — it slides in on a transform, so late reads as the animation — but the inset cannot: from an effect it would shift the whole document sideways one frame after paint on every load for a reader who left the sidebar open. State is persisted to `localStorage` (`mukoko-news-sidebar`); within a session the provider lives in the root layout and so already survives every in-app navigation.

**`inert` when closed is load-bearing** — a `-translate-x-full` alone leaves every link focusable off-screen, so a keyboard reader tabs into an invisible menu; and it must be `inert={!open || undefined}`, because the attribute is inert by PRESENCE and `inert={false}` renders `inert=""`. The panel carries **no theme toggle**: that would make `ThemeProvider` a hard requirement of every surface mounting it.

**The toggle is at the FAR LEFT of the header and wears `PanelLeft`.** Both were corrected on owner review. It had sat in the actions pill on the right, grouped with search and the account control — the one place a sidebar toggle never goes, and (once the sidebar docks) the opposite edge from the thing it toggles. The icon was a hamburger, which promises a menu that drops down and goes away; `PanelLeft` is the glyph readers already know from every editor and mail client, and it swaps to `PanelLeftClose` when open so it states what the next tap does. `header-sidebar-toggle.test.tsx` asserts the DOM order and the rendered glyph, because "far left" is a claim about order rather than a class name.

**The header is two bands, not one centred container** (owner review 2026-09-11). The toggle belongs to the SHELL's left edge, hard against the sidebar it opens; the masthead belongs to the centred reading column. They were one `mx-auto max-w-[var(--width-wide)]` container, which on a wide screen put **~580px of empty header** between the docked sidebar and the control that closes it — *"this versus this is too far apart"*. **And the header hides its own wordmark while the sidebar is docked open**: the sidebar carries the masthead there, so the header repeating it put the same lockup on screen twice at two different heights — *"the sidebar heading sits here, it's out of context across the whole"*. The sidebar's brand row now uses the header's own icon size, wordmark size and vertical padding, so the masthead sits on one baseline straight across the top of the app. The header now genuinely requires `SidebarProvider` — that coupling is the feature, so the header's suites wrap it rather than mocking it away.

**The header's page-list dropdown is gone.** It was a second, shorter copy of the same navigation — eleven of sixteen destinations — and the sidebar replaces it. The scrolled page title is now a plain **refresh** control, which is one of the two jobs it was already doing depending on hidden state (one tap opened the list, a second refreshed).

**The bottom island is contextual, and it is on every DEVICE** (owner decision 2026-09-11, superseding the phone-only bar). `[ Feed | …the page's own actions… | Profile ]` — the two ends never move, because a control that shifts under your thumb between pages is worse than no control; everything between belongs to the page. A page contributes through `useIslandActions` (`contexts/island-context.tsx`); one that contributes nothing falls back to `ISLAND_DEFAULT_HREFS` so the island is never a gap.

**`ArticleActionBar` is gone** — the article's like/save/share/original are island actions now. It was `md:hidden` on one side and a separate desktop bar on the other: two components doing one job, only ever one visible, which is how the desktop bar shipped **left-anchored with an invisible Share button** and stayed that way until an owner screen recording caught it. (`md:inset-x-0 md:right-auto` resolves to `right: auto`, so the bar was content-width at the left edge; and `ACTION`'s `md:bg-transparent` beat the Share button's unprefixed `bg-primary` inside the media query, leaving `text-on-primary` white on a near-white page.) One island cannot have a breakpoint nobody looks at.

**The island centres on the CONTENT COLUMN**, not the viewport. The shell's inset is padding, and padding on an ancestor does nothing to a `position: fixed` child, so `#bottom-island` carries its own `left` offset — a CSS rule keyed off `data-sidebar`, same mechanism and same reason as the shell inset. Below `lg` the island rides inside `.app-shell` and is carried by the push transform, so it must NOT be offset again there. **`--bottom-nav-clearance` now applies at every width**; it used to be reset to zero above `md`, which with one island on every screen would put the last line of every desktop article underneath it.

**Handler freshness is the island's one correctness rule.** A page's `onSelect` closures capture its state (`handleLike` reads `isLiked`, `likesCount`), so storing a stale one means a tap that toggles the wrong way. `signatureOf` covers every piece of state those closures read — pressed state, count, label, href, emphasis — and the hook re-registers whenever it changes. A page whose handler depends on something outside the signature must surface it there, or the island keeps calling the closure it first stored. `island-contextual.test.tsx` proves it with a counter that can only reach 3 if each stored handler saw the previous value.

**The bottom nav is on every route** (owner decision 2026-09-10, TikTok as the reference). It used to return `null` on `/newsbytes` and on every article page, so the two surfaces a reader is most likely to arrive on from a shared link were the two with no visible way out — the only routes back were the browser's own back gesture or knowing to tap the wordmark. It read as a deliberate immersive choice in the code and as being stranded in the product. `hidesAppChrome()` is now true for **one** route, `/embed/iframe`, which is our markup inside somebody else's page.

**Navigation and content actions share one bar, not two.** This was briefly the TikTok split — navigation along the bottom, content actions up a right-hand rail — and `/newsbytes` still uses a rail for its own swipe surface. The article did not: it got a rail on mobile and a separate full-width bar from `md` up, which is the arrangement the island replaced. The lesson that survives is the one about **one DOM tree that reshapes**, never two taking turns behind a breakpoint: jsdom applies no media queries, so two `role="toolbar"` regions with the same accessible name make every `getByRole` in the suite match both — and, worse, the breakpoint nobody renders in tests is the one that ships broken.

**`--bottom-nav-clearance`** (`globals.css`) is how much bottom space the floating pill needs kept clear — its height, its lift, a breathing gap and the home-indicator inset. The page padding in `layout.tsx`, the NewsBytes caption column and action rail, and the article page all read it, so the pill and whatever sits above it can never be lifted by different amounts. Consumers apply the `md:` reset themselves, since a CSS variable cannot carry a breakpoint.

**The pill is `rounded-full`.** It floats because this is a web app rather than an installed one: there is no OS-drawn tab bar to sit flush against, and a full-width bar welded to the bottom of a browser viewport collides with the browser's own toolbar and the home-indicator gesture zone. A floating bar is a pill; `rounded-2xl` read as a card that happened to be at the bottom of the screen.

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

**Public Insights / open-data analytics** — `src/lib/mongodb/insights.ts` holds read-only aggregation pipelines over `news.articles` (+ `feedSources` / `newsMediaOrganizations`) for the flagship open-data dashboard: `getCorpusSummary`, `getPublishingVolume`, `getSourceLeaderboard`, `getCategoryDistribution`, `getCountryCoverage`, `getSentimentBreakdown`, `getTopTopics`. **Every function is wrapped so a failure returns an empty-but-typed result — it never throws to the page.** `src/lib/actions/insights.ts` exposes them as Server Actions (incl. the aggregate `getInsightsBundleAction`), which back the server-rendered, ISR-cached (`revalidate = 600`) `/insights` page. Metrics computed over an enriched subset (sentiment, quality) carry an explicit **coverage %** so nothing is misrepresented.

**Analytics query console (`/analytics`)** — the deep dive `/insights` links into. `src/lib/mongodb/analytics.ts` holds the corpus query engine: `runCorpusQuery` returns every panel from a single `$facet` (daily series, source/country/category/keyword/named-entity/byline breakdowns, sentiment, quality, sample articles) plus the **normalized** query it actually ran, so the UI captions results with the filters that were applied rather than the ones requested. A text term leads with Atlas Search (`articles_text_search`) and falls back to a bounded substring `$match`, flagged on the result as `usedSearchIndex` so the page can say so. `getCoverageConcentration` answers the editorial question the old page faked — sources per country, top-source share, HHI, and the countries with no coverage at all. `getQueryFacets` populates the controls. All three are wrapped fail-soft like the Insights reads. `src/lib/actions/analytics.ts` exposes them, validating **every** input through the `@/lib/safety` schemas first (Server Actions are a public RPC surface); the two query-independent reads are wrapped in `unstable_cache` (600s, tag `analytics-facets`) so the `force-dynamic` page costs one aggregation per view, not three. `src/app/api/analytics/export/route.ts` exports one query as JSON or a labelled multi-table CSV — cells are RFC-4180 quoted **and** formula-neutralised (a leading `=`/`+`/`-`/`@` is prefixed with `'`, because the file carries publisher-controlled text: source names, bylines, `aiKeywords`, `aiNamedEntities`). It is per-caller by design so it is NOT edge-cached; 10 req/min/IP instead.

**Byline pages (`/author/[...slug]`)** — `src/lib/mongodb/authors.ts` answers two reads. `getBylineDirectory()` is one aggregation over the attributed corpus, cached for an hour and shared by every author page: it folds spelling variants onto a single key (diacritics included, so "José Silva" and "Jose Silva" are one journalist), names each by its most-published spelling, and is what makes slug → byline resolution *exact* rather than a reconstruction. `getAuthorProfile()` answers all seven panels from a single `$facet`. `src/lib/author-identity.ts` is the pure module that decides whether a byline is a **person** or a **desk** — a closed lexicon, word-boundary matched without `\b` (which is defined on `\w` and so excludes the accented letters this corpus carries). A person gets one page over the whole corpus; a desk gets one page *per newsroom* (`/author/<newsroom>/<desk>`), because "Staff Reporter" is measurably the desk byline of ten mastheads in four countries and one page for it would assert a single writer filed all 198 articles. A desk with no resolvable newsroom renders as plain text and gets no page — there is nothing to scope it to, and plain text is a smaller loss than a false attribution. Both reads are windowed to 365 days so they ride `status_1_datePublished_-1` as a range seek, and byline matching is `$in` **equality, never regex**, so an index on `{'author.name': 1, datePublished: -1}` would serve them if one is ever added (a live-cluster change, not made here). A failed directory read returns empty and 404s rather than rendering a real person's name above "0 articles". `src/lib/actions/authors.ts` is the Server-Action door.

### Data Flow (writes / mutations)

- **Engagement** (like / view / save) — Next.js **Route Handlers** under `src/app/api/articles/[id]/{like,view,save}/route.ts` (`POST`, `runtime = 'nodejs'`), rate-limited via `src/lib/rate-limit.ts` (`checkRateLimit` — **async** — and `getRequestIp`). When `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are set the limit is enforced globally via the Upstash REST API (fixed window, fails open); otherwise it's the in-memory per-instance window. Likes/saves are keyed to an **engagement subject** (`src/lib/engagement.ts`): the signed-in WorkOS user (`user:<id>` — follows the account across devices; anonymous cookie history is claimed on first signed-in interaction) or the `mukoko_session` cookie. The stored field remains `sessionId` — an opaque subject key to the gateway/pipeline. `src/app/api/health/route.ts` is the health probe.
- **Admin mutations** — `src/lib/admin/gateway.ts` proxies to the gateway Worker's WorkOS-gated `/api/admin/*` endpoints, forwarding the WorkOS access token as a Bearer header so the Worker re-verifies the same RBAC. **This is the only place the frontend touches the gateway.**
- **Own-profile reads/writes** (owner decision 2026-09-01) — **`identity.persons` is the source for user profile data, not the WorkOS session claims.** It carries strictly more: the profile picture is hosted on `profile-images.mukoko.com` (absent from the token), plus `preferredUsername` and `interests`. `src/lib/mongodb/identity.ts` reads/writes the caller's own record (matched on `workosUserId`, `$set` restricted to an explicit allowlist — `givenName`/`familyName`/`name`/`preferredUsername`/`interests`; never `bundu`, `role`, `workosUserId`, or the merge bookkeeping, and **never upserts** since the gateway webhook creates the record). `src/lib/actions/profile.ts` exposes `getMyProfileAction()`, `updateProfileAction()` and `updateInterestsAction()`; each takes **no user id** — it comes from the verified session, so a crafted request cannot retarget another account. A name write updates the DB record first (that is what the platform reads) and then **mirrors to WorkOS best-effort** so the IdP does not drift; the mirror round-trips back through the gateway's `user.updated` webhook into the same record, so a WorkOS failure must not report failure to a user whose canonical copy saved. ⚠️ `mukoko-news-gateway/CLAUDE.md` still says the gateway is the only writer of the `identity` domain — that doc needs updating to match this decision.
- **Pipeline refresh** — `src/lib/actions/refresh.ts` `triggerFeedCollection()` fire-and-forget `POST`s to `FLY_WORKER_URL/trigger/collect` with `FLY_TRIGGER_TOKEN`.
- **Open-data export** (read-only, public) — `src/app/api/insights/export/route.ts` (`GET`, `runtime = 'nodejs'`, `revalidate = 600`) returns the aggregated Insights bundle. `?format=json` (default) emits the full `InsightsBundle`; `?format=csv` emits one CSV with three labelled tables — `## media_organizations`, `## topic_distribution`, `## country_coverage` (RFC-4180 quoted). Rate-limited via `checkRateLimit`/`getRequestIp` (20 req/min/IP → `429` + `Retry-After`); edge-cached (`Cache-Control: public, s-maxage=600, stale-while-revalidate=1800`). Linked from the `/insights` page ("Download open data"). This is a plain Route Handler → MongoDB, not a gateway call.

### Publisher icons (`src/lib/publisher-icon.ts`)

Source favicons resolve from the **publisher's own record**, never from a table of names and never from anything stored on the article. `resolvePublisherIcon()` tries, in order: the organisation's `logo` → the organisation's own `url` → the feed source's own URL (`Article.source_url`, derived on read from `feedSources.sourceUrl ?? feedUrl`) → the article's `externalUrl` host → the `source-profiles.ts` brand table on an **exact** name match → coloured initials. `SourceIcon` (`components/ui/source-icon.tsx`) renders it and falls back to initials on any load failure; `sourceIconProps(article)` is the single place the preference order is expressed.

Why it exists: the old `getFaviconUrl()` only answered for the ~20 hardcoded profiles. Measured 2026-09-10 on the live cluster — **38 of 587** feed sources matched, and because the lookup falls through to a *substring* test **11 of those 38 matched the wrong publisher** ("National Geographic" and "Amnesty International" both contain "Nation", so both were served the Daily Nation's icon). All **537** organisations carry an http(s) `url` and all 587 sources resolve to one, so a domain is now derivable for **587 of 587**. Nothing is written to `news.articles`: publisher identity — including verification — has exactly one instance, on the publisher record, and the article's `mediaOrganizationId` / `feedSourceId` is the whole link.

**Privacy**: the favicon service URL is never handed to the browser. It is wrapped in `imageProxyUrl()` so the request goes to the image worker (`assets.mukoko.com/i/*`), which fetches it server-side and caches it in R2 — so no reader IP, UA, cookie or `Referer` reaches a third party, and one fetch serves every reader. A publisher-hosted `/favicon.ico` is deliberately not tried: `image/x-icon` is not on the worker's content-type allowlist.

### API Client (`src/lib/api.ts`)

Used for client-side fetches and the embed widget, and exports the shared `Article` type. `NEXT_PUBLIC_API_URL` is empty by default (relative URLs → Next.js Route Handlers → MongoDB). Only set it to an external URL for the Cloudflare widget/resale API.

## Testing

**Vitest 4 with jsdom + React Testing Library.** `npm run test` prints the current count;
no figure is written down here, for the same reason the README carries no coverage number —
a count in a document nothing checks is stale by the next merge. (It went stale inside a
single branch once already: this line was corrected from "~1,000 across 64", then a later
commit on the same branch added 19 tests.)

- Config: `vitest.config.ts` (globals on, `@` alias, `include: src/**/*.{test,spec}.*`)
- Setup: `src/__tests__/setup.ts`
- Coverage (v8): thresholds **75%** statements, **64%** branches, **72%** functions, **77%** lines — enforced by CI, which runs `npm run test:coverage`. Ratchet them up as coverage rises; never down to make a build pass.
- **Mocking the MongoDB readers**: `src/lib/__tests__/helpers/mongo.ts` stubs the driver at the `getDb()` seam (`collectionStub` / `dbStub`), which is what lets a test assert on the query that was issued — the projection, the sort key, the filter. Use it rather than mocking the reader module, and follow the existing suites (`mongodb-articles`, `mongodb-catalogue`, `mongodb-analytics`, `insights`, `places`).
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
| `mukoko-news` | http — `https://news.mukoko.dev/mcp` | Product MCP (gateway) |
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

# WorkOS AuthKit (hosted AuthKit sign-in — /sign-in redirects to the hosted page)
WORKOS_CLIENT_ID=client_01KV2G41CHGBSH6HG57AQBFKDD
WORKOS_API_KEY=sk_live_...
WORKOS_REDIRECT_URI=https://news.mukoko.com/auth/callback
WORKOS_COOKIE_PASSWORD=<32+ char random string>   # openssl rand -base64 32
WORKOS_PLATFORM_ORG_ID=org_...                     # platform-team org → /admin access

# External API (widget/resale only) — leave EMPTY; reads go through Server Actions
NEXT_PUBLIC_API_URL=

# Gateway Worker (admin mutations only)
GATEWAY_API_URL=https://news.mukoko.dev

# Pipeline trigger (manual refresh action)
FLY_WORKER_URL=https://news-ingestion.fly-worker.nyuchi.dev
FLY_TRIGGER_TOKEN=...                              # must match the fly secret
```

## Authentication & RBAC (WorkOS AuthKit)

**WorkOS AuthKit** handles all user authentication. Web users sign in via the **WorkOS-hosted AuthKit page** — every entry point funnels through `/sign-in` → `/auth/login` (the Route Handler that calls `getSignInUrl({ returnTo })` — it writes the PKCE/state cookie, so it must never be called during a page render); users return via `/auth/callback`. The hosted page owns the full flow — Magic Auth, passwords, passkeys, and the **environment-required MFA step-up** — and maintains the **shared AuthKit session** that gives continuous sign-in across the Mukoko/Nyuchi apps (all AuthKit applications in one WorkOS environment). (Owner correction 2026-07-09 — this **supersedes** the 2026-07-02 inline-form doctrine; the inline Magic Auth form and its hand-rolled MFA step-up were removed. See `auth.md`.)

- `src/app/sign-in/page.tsx` — the single sign-in entry point (`dynamic = 'force-dynamic'`): validates `returnTo` (root-relative only), redirects to `/auth/login?returnTo=…`; signed-in users skip straight to `returnTo`. A callback `?error=…` renders a manual-retry error card — never an auto-redirect loop.
- `src/app/auth/login/route.ts` — AuthKit initiate-login endpoint (the WorkOS app's `initiateLoginUri`) and the only `getSignInUrl()` call site: 307s into a fresh hosted sign-in.
- `src/middleware.ts` — AuthKit **session-refresh only** (`middlewareAuth` still NOT enabled — public reading of nearly every route must stay unauthenticated, so page-level gates protect the few private surfaces instead). `/admin` is NOT gated here — cookie presence is spoofable.
- `src/app/admin/layout.tsx` — the **authoritative** admin gate: calls `withAuth()` and enforces RBAC via `src/lib/auth/roles.ts`, redirecting unauthenticated users to `/sign-in?returnTo=/admin`.
- `src/app/auth/callback/route.ts` — WorkOS OAuth callback handler; hardened with `handleAuth({ returnPathname, onError })` so a bad/missing `code` or a failed exchange redirects to `/sign-in?error=…` instead of a 500.
- `src/lib/auth/actions.ts` — `isSignedIn()`, `signOutAction()` (clears the AuthKit session cookie).
- `src/app/layout.tsx` — wraps the app in `AuthKitProvider`.
- `src/components/layout/user-avatar.tsx` — the header account control, and the only chrome that shows whether a session exists. Reads `useAuth()` (the client hook `AuthKitProvider` supplies) rather than `withAuth()` in the root layout: reading cookies in the root layout would opt **every** route into dynamic rendering to decorate one control. Signed out → `/sign-in`; signed in → the WorkOS `profilePictureUrl` (validated with `isValidImageUrl`, monogram on failure) linking to `/profile`.

**Entity memberships (read-only)** — `src/lib/mongodb/entity.ts` reads the caller's **active** memberships from `entity.memberships`, joined to `entity.entities` for the org name. This exists because the WorkOS token cannot carry them: measured on the live cluster, **every currently-active membership has no `workosOrganizationId`**, while the only memberships that do carry one have already ended — so a claims-only check reports "no membership" for every active member the platform has. Resolution is two hops (`WorkOS user id → identity.persons._id → entity.memberships.personId`), because the domains key on different ids. The active filter checks **both** `isActive` and `endedAt`; neither is redundant (`endedAt` is set on more rows than `isActive: false` covers). Fail-soft: a failed read returns an empty list, so callers must treat empty as *unproven*, never as *proven absent* — it is not a signal to grant anything. **Nothing here writes**: `entity` is owned by the gateway and its WorkOS webhook.

**Entity capabilities are not platform tiers** (owner decision 2026-09-02) — `src/lib/auth/entity-access.ts` is the *only* consumer of memberships, and it turns one into `EntityCapability`s (`entity:read` / `entity:manage` / `entity:members`) that apply to **that one entity**. It cannot produce a `Tier`: it imports nothing from `roles.ts`, `roles.ts` reads no database, and `/admin` takes no membership input — three assertions the `entity-access` test suite enforces structurally, so a future edit that wires them together fails CI rather than silently widening access. Capabilities come from `membershipRole` through a **closed** map (an unknown role grants nothing); the row's own `permissions` array is never consulted for a decision, and `sanitizeEntityPermissions` strips the reserved namespaces (`platform:`, `mukoko:`, `nyuchi:`, `admin:`, `news:`, plus bare `admin`/`superadmin`/`moderator`/`support`/`staff`) on read. That is not theoretical: an active membership on the live cluster carries `permissions: ["platform:admin"]`, on an entity with **no** `workosOrgId` to reconcile against, and several other active memberships are of `entityType: "family"` entities — founding your own household is not staff access. Since `entity` is written by the gateway's WorkOS webhook and MongoDB's validators accept unknown fields, honouring a slug from there would make every writer to `entity` an authority on who administers this app. Every decision grants on the **presence** of a membership, so the fail-soft empty read denies rather than opens. `src/lib/actions/entity-access.ts` is the Server-Action door; `src/components/profile/profile-organizations.tsx` shows the caller their own memberships on `/profile`.

### Reader access tiers (`src/lib/access.ts`) — NOT staff RBAC

**One map, consulted everywhere** (owner decision 2026-09-11 — *"I need to start making money from this some how"*). `canAccess(feature, plan)` answers whether a READER may reach a gated capability; `planFor(signedIn)` produces the plan. Plans rank `anonymous` < `free` < `subscriber`, and both the map and the rank **fail closed**: an unknown feature or an unknown plan grants nothing, the same rule `entity-access.ts` applies to membership roles.

⚠️ **Nothing returns `subscriber` yet.** There is no billing — no plan field, no webhook, no checkout — so `planFor` can only answer `anonymous` or `free`, and a test asserts it. The tier exists so features can be *declared* against it now and moved in one edit later. The plan must never be read from a field another domain writes: `identity`/`entity` are written by the gateway's WorkOS webhook and Mongo's validators accept unknown keys, so honouring a `plan` from there would make every writer to those databases an authority on who has paid.

**This is not `roles.ts`.** That answers "is this person platform staff" from the WorkOS org claims and gates `/admin`. This answers "has this reader paid". An admin is not a subscriber and a subscriber is not an admin; `access.test.ts` asserts structurally that neither module imports the other, so an edit that wires them together fails CI rather than quietly turning a paywall into a privilege escalation.

| gated | plan | enforced where |
| --- | --- | --- |
| `ai-summary` | `free` | `article-summary.tsx`, client-side |
| `analytics-console` | `free` | `/analytics` page redirect **+** `requireViewer()` in every action |
| `analytics-export` | `free` | the export route |
| `saved-articles` | `free` | account-scoped by the engagement subject |
| `publisher-dashboard` | `free` | ownership-gated |

**What is deliberately public, and why it must stay so.** Article bodies, the home feed, `/search`, `/discover`, `/categories`, `/sources`, `/topic`, `/author` — these are what search engines index, and for an aggregator that traffic *is* the asset; gating them hides the product from the people who would pay for it. And **`/insights` stays open**: it is the published open-data dashboard this project is partly known for, with a public export endpoint, and a login on it contradicts the claim. `access.test.ts` asserts no gate exists for any of them, so adding one is a deliberate act with a failing test in front of it.

⚠️ **The AI-summary gate is a CONVERSION gate, not a confidentiality one.** It is enforced client-side from `useAuth()`, and the summary text still travels in the article payload — a determined reader can find it in the network tab. That is the deliberate trade: enforcing it server-side means making `getArticleAction` session-aware, which makes the article route dynamic and gives up ISR on the most-visited surface in the app. If the text must genuinely not leave the server, the fix is a separate session-gated action for the summary alone, not dynamic rendering of the whole article.

**The gate teases, it does not vanish.** An anonymous reader sees the card, its heading, and the first sentence faded out under a "Sign in to read the summary" link that returns them to the article. A component that simply disappears converts nobody, because they never learn the feature exists. It stays locked while the session is resolving — the other way round would flash the gated text to every anonymous reader on every load.

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

**Mark**: the **Seed of Life** — one centre cell ringed by six, the first ring of the honeycomb, rendered in the 7 minerals with **tanzanite at the core**. **The full-palette mark is the only icon, at every size.** Bare mark on a transparent ground: `public/mukoko-mark-full-{light,dark}.svg` (used by `AppIcon`). Mark on the deep-tanzanite (`#1A0033`) rounded ground: `public/mukoko-appicon.png` — the app icon, and the source the favicons are downscaled from, so the browser tab, the installed app and every other surface carry identical artwork. (Owner correction 2026-09-01 — this **supersedes** the earlier "mono-tanzanite favicon below 32px" rule. The mono variant made the tab icon a solid purple blob that looked like a different product; `favicon.svg`, `favicon-{16,32,48}.png`, `favicon-180.png`, `apple-touch-icon.png` and `favicon.ico` are now the full-palette mark, and `mukoko-appicon-mono-tanzanite.png` was deleted so it cannot be wired up again. `favicon.svg` carries its own ground, so one file serves both browser themes and there is no `favicon-dark.svg`.) Never add gradients/shadows, recolour petals, reorder the ring, or substitute a mono/single-colour reduction.

**Palette** — 7 **African Minerals**, each with light/dark + container/on-container values (full set in `src/app/globals.css`, theme-aware via the `.light`/`.dark` classes). **The source of truth is the Mzizi MCP** (`mzizi_get_tokens` — 21 colour families: 7 minerals, 7 heritage, 7 experimental), not a file in this repo. Verified 2026-09-05: all 7 minerals and all 14 container values here match Mzizi exactly. (An earlier version of this line claimed a brand kit at `tokens/minerals.json`; **no such file has ever existed** in this repo — query the MCP instead.)

| mineral | light | dark | role |
| --- | --- | --- | --- |
| cobalt | `#0047AB` | `#00B0FF` | secondary / links / CTAs |
| tanzanite | `#4B0082` | `#B388FF` | **primary / brand** |
| malachite | `#004D40` | `#64FFDA` | success |
| gold | `#5D4037` | `#FFD740` | accent / rewards |
| terracotta | `#A0522D` | `#E1B07E` | warning / community |
| sodalite | `#283593` | `#3D5AFE` | AI / Shamwari surfaces |
| copper | `#BF5A36` | `#FF8A65` | commons |

`--primary`=tanzanite, `--secondary`=cobalt, `--success`=malachite. Use light hex on light surfaces, dark hex on dark.

**Two semantic tokens are deliberately NOT minerals** (corrected 2026-09-10, measured against `mzizi_get_tokens`):

- **`--accent` is the pale cobalt container** (`#E3F2FD` / `#001F3F`), a hover/selected fill — not a brand colour. The saturated, swappable brand mineral is a separate token, **`--brand-accent`** (tanzanite). This app had collapsed the two into one and assigned gold, which is neither, and that is why hover states and CTAs competed. Its live consumers are the button `outline`/`ghost` hover states.
- **`--warning` is Mzizi's semantic warning** (`#7A5C00` / `#FFD866`), not terracotta. Terracotta is a mineral that already means *community and warmth*, so warnings and community surfaces were indistinguishable. Measured as text on the card: terracotta 4.83:1 light / 10.4:1 dark; Mzizi 5.38 / 13.6 — better in both. ⚠️ The light value still does **not** clear Mzizi's own APCA floor; reported upstream rather than patched with a Mukoko-only variant.
- **`--ring` is cobalt**, deliberately not the brand hue, so a focus ring is never read as a brand fill on a primary button.

**Surfaces** — the Mzizi background scale (`mzizi_get_tokens: backgrounds`), and **every role takes the step that carries its name**: `--surface` is Mzizi `surface`, `--elevated` is `container`, `--popover` is `overlay`, and so on. Mzizi is the source of truth for the scale AND for which step a role uses; this app does not re-point one on its own reading (owner decision 2026-09-10 — see the note below).

| token | light | dark | Mzizi name |
| --- | --- | --- | --- |
| `--void` | `#F8F8F7` | `#080807` | `void` — app shell behind base |
| `--background` | `#F3F3F1` | `#0E0D0C` | `base` — matte page |
| `--surface` / `--card` | `#EEEEEC` | `#131211` | `surface` — the card |
| `--muted` | `#FAF9F5` | `#050504` | `muted` — deepest fill, inset/metadata rows |
| `--elevated` | `#E5E4E1` | `#1E1D1A` | `container` — hover rows |
| `--popover` | `#E0DFDC` | `#23221F` | `overlay` — menus, dialogs |
| `--raised` | `#D6D5D1` | `#2E2C29` | `raised` — above overlay: menus, toasts |
| `--pitch` | `#FAFAFA` | `#050505` | `pitch` — media wells, splash |
| `--scrim` | `rgba(0,0,0,.40)` | `rgba(0,0,0,.60)` | backdrop behind overlays |
| `--wash` | surface + 7% brand | surface + 12% brand | cover-colour page tint |
| `--border` | `#E7E5E0` | `#2A2927` | `border` — warm stone, not cool grey |

> **Owner decision 2026-09-10 (third and final on this token) — Mzizi is the source of truth.** Dark `--surface`/`--card` is Mzizi **`surface`** (`#131211`). It had been re-pointed at Mzizi **`void`** (`#080807`) earlier the same day to keep the card a step *darker* than the matte page — a reading of the scale this app invented and Mzizi does not make. A role now takes the step that carries its name, full stop, and `design-tokens.test.ts` asserts exactly that (`--surface`→`surface`, `--elevated`→`container`, `--popover`→`overlay`, …) in all three theme blocks. That replaces the weaker "is *a* real step in the scale" check, which only existed to accommodate the re-point: with no role diverging, a mismatch is a bug rather than a decision, and the test names which step the value should have come from. The one invariant that survives every revision of this token is the failure that started it — `--surface` must never equal `--muted` (`#050504`), or a card and the inset row inside it are one colour and the metadata well has no edge. That is still asserted separately.
>
> **Components separate by FILL, not by a drawn edge** (owner decision 2026-09-10). Every card, panel and chip carried `border border-border`, so the product looked like a high-contrast theme nobody chose — and with everything boxed, nothing read as emphasised. There is now one token: **`--outline`, transparent by default**, and every boxed component draws `border border-outline`. The border stays in the box model, so switching it on shifts no layout. `--border` keeps its colour and stays visible for **separators** (`border-b`, `border-t`, `divide-y`, the byline rule) — a line meaning "these two things are different" is a different job from a line meaning "here is an edge", which is why they are now different tokens. Two things turn outlines on: `data-outlines="on"` (the reader's own choice, from **/profile → Accessibility**, applied pre-paint by the bootstrap script in `layout.tsx`) and **`prefers-contrast: more`**, where it is not optional — a reader who asked their OS to make differences easier to see is asking for the edge, and fill alone is the subtler of the two signals. (It is **not** because the surfaces stop separating: that block keeps every Mzizi step. An earlier version replaced them all with `Canvas`, and this sentence used to cite that as the reason — see the corrected note under **Deferring to the system**.) A **control's** edge is a different job again and gets its own token, **`--control`** (always visible, aliased to `--border` so it follows into the high-contrast block): an `<input>` or `<select>` painted with the transparent `--outline` would be an undiscoverable field, and a button's `outline` variant IS its edge. There are deliberately **no file-level exemptions** in the check — exempting a file would let a future card in that same file slip through, which is how the borders got everywhere in the first place. `src/lib/__tests__/appearance.test.ts` structurally forbids a box outline drawn on `--border`/`--elevated` anywhere else. ⚠️ This **diverges from the Mzizi card spec**, which specifies "a full 1px border" (`mzizi_get_tokens: componentSpecs`) — reported upstream rather than silently forked.
>
> **Corrected 2026-09-10 (first).** `--surface`/`--card` carried `#050504` in dark — that is Mzizi's **`muted`**, the *deepest* fill, not `surface`. Because `--muted` is also `#050504`, a card and the inset row inside it were the same colour and the metadata well had no edge. Five further steps (`void`, `pitch`, `raised`, `scrim`, `wash`) were never defined, which is why menus reused the hover-row colour and the share modal hand-rolled its own backdrop. `src/app/__tests__/design-tokens.test.ts` now parses `globals.css` and asserts every value against a checked-in Mzizi snapshot — including the bare `:root` block, which carries the DARK DEFAULTS and was the block an earlier revision of that test failed to read.

**Text is set by APCA, not WCAG 2** — Mzizi's floor is **APCA 3.0 AAA**. WCAG 2 ratios systematically overstate light-text-on-dark, which is how `--text-tertiary` came to be documented as "7.0:1" while measuring **APCA Lc 38.7** on the card — barely half what a 12px string needs, and it was used for every hint line, card heading and chip. Current values, measured on the *worst* surface each lands on, all clearing both the APCA target and the AAA 7:1 floor:

| token | light | dark |
| --- | --- | --- |
| `--foreground` | `#000000` (Lc 95.9) | `#FFFFFF` (Lc 107.9) |
| `--text-secondary` | `#2E2B27` (Lc 89.0) | `#E8E8E4` (Lc 92.7) |
| `--text-tertiary` | `#474139` (Lc 83.2) | `#D4D4CF` (Lc 80.3) |

**Deferring to the system — but only where the system asked to take over** (corrected 2026-09-10). `color-scheme` is declared per theme so native controls, scrollbars and the first-paint canvas match. The two contrast queries are then **not** treated alike:

- **`@media (prefers-contrast: more)` raises contrast INSIDE the Mzizi scale.** Every surface keeps its step; outlines switch on and stop being optional; `--text-secondary`/`--text-tertiary` lift to full foreground; and `--border`/`--control` take the value `--text-tertiary` normally holds (`#474139` / `#D4D4CF`) — a measured, on-palette edge. ⚠️ This **supersedes** the earlier rule that handed every reading surface to `Canvas`/`CanvasText`. Measured on a phone with the OS "Increase Contrast" switch on, that rule collapsed all **eight** background steps into one flat system colour and outlined every card, chip and the nav pill in stark white on black: the card stopped reading as a card, because the fill separating it from the page was gone and the border was the only structure left. `prefers-contrast: more` means *make differences easier to see*, not *throw away the palette* — the Mzizi scale is not low contrast, it is eight deliberately distinct steps, and it is the thing carrying the structure.
- **`@media (forced-colors: active)` is where the palette IS handed over**, because the OS has already replaced it; focus rings are redrawn in `Highlight`, the one colour that survives.

`design-tokens.test.ts` asserts both halves: that no surface token is set to `Canvas` under `prefers-contrast: more`, and that `forced-colors` still does hand over. System colours are deliberately **not** the default: that would drop the Mzizi scale and the mineral identity on every machine, which is a brand decision rather than an accessibility one.

**Appearance is picked by looking** (`components/profile/profile-appearance.tsx`). Theme *and* outlines are one card on `/profile`, and every option renders a **miniature of the app** in that setting — a header bar, a card holding two text lines, and the page behind both. Before this, outlines were a lone switch with a paragraph explaining it and the theme was a **cycle button** elsewhere on the page showing only its current value, so a reader tapped three times to discover the options and never saw two side by side. Both are purely visual settings; the honest control is the thing itself. `appearance-preview.tsx` is the **one place a literal hex is correct** — it must draw a theme the document is *not* in, and a `bg-surface` would paint all three options in the active theme — so its values are asserted against `globals.css` by test rather than trusted.

**Typography**: **Noto Serif** (display/headings, wordmark = lowercase weight 600 — always "mukoko", never capitalised), **Noto Sans** (UI/body), **JetBrains Mono** (code/data/labels) — self-hosted via `next/font/google` in `layout.tsx`, with the CSS variables wired to the `--font-sans/serif/mono` theme tokens in `globals.css`.

**Spacing**: 12px border-radius buttons, 16px cards. WCAG AAA compliant (7:1 contrast).

**Density (Mzizi 4.x)**: `globals.css` defines the prime-scale touch targets (`--touch-*`: 47px primary CTAs, 43px inputs, 37px dense toolbars, 31px chips, 56px hero-only) and icon sizes (`--icon-*`). `comfortable` is the default density; data-dense surfaces (`/admin`, `/dashboard`) opt into `compact` with `data-density="compact"` on a wrapper — the scope overrides `--density-touch` and the card/input radii, which cascade with no per-component changes. Button sizes ride these tokens (`min-h-[var(--density-touch)]`). New interactive elements should use the touch-target minimums, not fixed heights.

**Chart marks** (`--chart-*`) reference minerals, never literals: primary→tanzanite, positive→malachite, neutral→`--neutral`, negative→**copper** (not `error` — a negative *sentiment* is not an error *state*), mixed→gold, grid→`--border`. All twelve values were previously raw Tailwind palette (`violet-500`, `teal-600`, `gray-400`, `rose-600`…) sitting in `:root` where they looked official; `--chart-negative` was orange-700 in light and rose-600 in dark, so a negative series changed hue with the theme. A test asserts none is a literal.

CSS variables in `src/app/globals.css`. Use Tailwind classes: `bg-primary`, `text-foreground`, `bg-surface`, and the mineral utilities `bg-tanzanite`, `text-cobalt`, `bg-container-sodalite`, etc. (`components.json` configures the shadcn-style component generator; the theme lives entirely in `globals.css` via `@theme inline` — there is no `tailwind.config.ts`.)

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

**Security response headers**: `src/lib/security-headers.ts` is the single source; `next.config.ts` `headers()` just returns `buildSecurityHeaders()`. Two rules partition the site — a catch-all (`/((?!embed(?:/|$)).*)`) and `/embed/:path*` — and they must never overlap, because a route matched by both would get `X-Frame-Options: DENY` **and** `frame-ancestors *`, and XFO wins in every browser: the embed product would die silently while the config read as if it allowed framing. `src/lib/__tests__/security-headers.test.ts` compiles both `source` strings with **Next's own** `path-to-regexp` and asserts the partition. **CSP ships in two pieces**: a tiny *enforcing* policy (`base-uri`/`object-src`/`form-action`/`frame-ancestors` — no `default-src`, so it cannot blank a page over a resource we failed to enumerate) plus the full policy as `Content-Security-Policy-Report-Only`, reported to `src/app/api/csp-report/route.ts`. Scripts use `'unsafe-inline'`, **not** a nonce: a nonce is baked into the rendered HTML, and nearly every route here is prerendered or ISR-cached, so a cached page would carry a stale nonce and block Next's own runtime. HSTS is **not** set here — Vercel already sends `max-age=63072000`; and `upgrade-insecure-requests` is omitted because 303 articles carry an `http://` `externalUrl` and it would break those outbound links.

**Image hosts**: `images.remotePatterns` allows **only** `https://assets.mukoko.com/i/**`. It was `hostname: '**'`, which made `/_next/image` an open proxy for any HTTPS host on the internet. An explicit publisher allowlist is not viable (340 distinct image hosts on the live corpus, 238 first seen within four weeks); instead every publisher image is proxied through the image worker by `imageProxyUrl()` in `src/lib/image.ts`. `next/image`'s host check **throws** rather than rendering a broken image, so `src/lib/__tests__/image-hosts.test.tsx` structurally asserts that every `<Image>` in the tree is a custom loader, `unoptimized`, a local asset, or an `imageProxyUrl` result.

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

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Canonical docs:** `agents.md` (task rules + data-flow boundaries), `review.md` (merge gate / review checklist), and `auth.md` (trust model) are the authoritative rule set for this repo. This file carries the full architecture detail and stays consistent with them.

## Project Overview

Mukoko News is a Pan-African digital news aggregation platform. "Mukoko" means "Beehive" in Shona — where community gathers and stores knowledge. Primary market is Zimbabwe. **Scope is all 54 African Union member states; the live count is a QUERY, not a constant** — `getLiveCoverageAction()` (`src/lib/actions/coverage.ts`) counts the countries that actually cleared the aggregation bar in the last 30 days, and `coverageFragment(n)` / `coverageClaim(n)` in `src/lib/constants.ts` are the only sanctioned wording. Every public surface interpolates them rather than writing a number, so a country that starts producing appears on its own and one that goes dark drops off on its own. `FALLBACK_LIVE_COUNTRY_CODES` is a failure floor for when the read fails — never the source of the claim. (This **supersedes** the earlier "16 are released" line and its `RELEASED_COUNTRY_CODES` / `COVERAGE_CLAIM` symbols, which no longer exist.)

## Three-Repo Architecture

This repo (`nyuchi/mukoko-news`) is the **Next.js frontend only**. It deploys to Vercel.

| Repo                          | Contents                                | Deploys to          |
| ----------------------------- | --------------------------------------- | ------------------- |
| `nyuchi/mukoko-news`          | Next.js 15 frontend                     | Vercel              |
| `nyuchi/mukoko-news-gateway`  | Cloudflare Workers API + MCP            | Cloudflare Workers  |
| `nyuchi/mukoko-news-pipeline` | Fly.io pipeline + Cloudflare processing | Fly.io + Cloudflare |

**Hard rules for this repo:**

- Frontend reads/writes directly to MongoDB Atlas via Next.js Server Actions — never through the gateway Worker
- The gateway (`news.mukoko.com/api/*`, `/mcp`) is a separate product API; the frontend does not call it except for **admin mutations** (see `src/lib/admin/gateway.ts`)
- The only external trigger is the pipeline refresh — one server action (`src/lib/actions/refresh.ts`) that pings the Fly.io worker's `/trigger/collect` endpoint
- The header's date/time + weather strip (`src/components/layout/datetime-weather.tsx`) reads the sibling weather app's PUBLIC embed endpoint `weather.mukoko.com/api/embed/current` via `src/lib/weather.ts` — **from the reader's browser only, never server-side**. The endpoint derives the location from the caller's IP, so a server-side call would hand every reader the Vercel datacenter's location (measured: `"Your location"`, 37.751/-97.822, the US centroid). It is not a gateway call, it is fail-soft (any failure renders no weather at all), and it is suppressed on `/newsbytes` and `/embed*`.
  - **IP geo is a guess, and on mobile it is often a bad one** (owner report 2026-09-11 — _"the weather is not location aware, it's pulling a random place"_). Measured on a Zimbabwean handset the strip read **"Opposite Carrier Singapore"**: a carrier-NAT egress, which is what mobile networks routinely present to IP geolocation. The endpoint was doing its job on the input it had. It also accepts `?lat=`/`?lon=` — verified live: no params returns the US centroid from a datacenter IP, `?lat=-17.8252&lon=31.0335` returns `{"name":"Harare","country":"ZW"}` — so the strip now uses the reader's real position under three rules, none optional. **(1) Never prompt on load**: on mount it asks `navigator.permissions` what would happen _if_ it asked and takes a fix silently only when the answer is already `granted`; otherwise it renders a "Use my location" control and waits to be pressed, because a news site that springs a location dialog on a first-time reader has spent trust it had not earned. **(2) Coarsen before sending**: coordinates are rounded to 2dp (~1.1 km) before leaving the device — weather does not vary at street level, and a precise fix is the reader's home address. An impossible position is _rejected_, never clamped, since clamping turns nonsense into a plausible-looking place name. **(3) Fall back to IP, never to a guess**: no permission, a denial, a timeout or a malformed fix all fall through to the param-less call. The last granted fix is remembered in `localStorage` (`mukoko-news-coords`) so a returning reader is right before any permission round-trip.

> History: the gateway and pipeline used to live in this repo. They were extracted in the v5.1.0 three-repo split (see `CHANGELOG.md`). If you find references to `backend/`, `fly-worker/`, `processing/`, etc., they are stale — those directories no longer exist here.

## Commands

**pnpm is the only package manager** (owner decision 2026-09-14). `pnpm-lock.yaml` is the only lockfile, and every consumer installs from it: **Vercel**, **CI** (`deploy.yml` — `pnpm/action-setup` then `pnpm install --frozen-lockfile`) and the **Husky pre-commit hook**. The version is pinned once, in `package.json#packageManager` (`pnpm@10.28.0` — what Vercel was already running, per its build log), and both Vercel and `pnpm/action-setup` read it; locally, `corepack enable` makes `pnpm` that exact version.

- **Never run `npm install` / `yarn` here.** They ignore `pnpm-lock.yaml` and resolve a different tree from the one that deploys. `package-lock.json` and `yarn.lock` are gitignored, and the **`Single lockfile`** CI job fails if one is committed anyway.
- **Security overrides live in `pnpm-workspace.yaml`**, not `package.json`. pnpm ≥ 11 no longer reads the `pnpm` field of `package.json` at all (pnpm 12.4.1 warns _"The following keys were ignored: pnpm.overrides"_), so overrides there would silently fall out of the deployed tree on an upgrade. pnpm 10.28.0 is verified to read them from the workspace file: remove one and `--frozen-lockfile` fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.
- **`--frozen-lockfile` is the drift guard.** A `package.json` or override change without the matching `pnpm-lock.yaml` fails every CI job — the `ERR_PNPM_OUTDATED_LOCKFILE` that once failed a Vercel deploy behind 14 green GitHub checks (PR #161).

> **Why (measured 2026-09-10, when the repo shipped both lockfiles):** CI and Husky installed from `package-lock.json`, Vercel from `pnpm-lock.yaml`, and they disagreed on **144** packages. `npm audit` reported 0 vulnerabilities while `pnpm audit` reported **4 high + 2 moderate** (`brace-expansion` 5.0.5 via `@typescript-eslint/typescript-estree` → `minimatch` 10; `ws` 8.20.0 via `jsdom` — all dev-only, `pnpm audit --prod` clean). Sharper: **Vercel's in-build ESLint had been failing** with `Cannot find package '@typescript-eslint/parser' imported from eslint.config.js` — the config imported an undeclared package that npm's flat `node_modules` hoisted into reach and pnpm's strict layout did not, and `next build` logs that and carries on. It is now a declared devDependency. A green CI run was not evidence about the tree that deployed; with one lockfile it is.

```bash
corepack enable       # once per machine: `pnpm` becomes the pinned version
pnpm install          # install from pnpm-lock.yaml
pnpm add <package>    # add a dependency (-D for dev); commit package.json + pnpm-lock.yaml
pnpm audit            # the audit that describes the deployed tree

pnpm dev              # next dev — dev server on :3000
pnpm build            # next build — production build
pnpm start            # next start — serve the build
pnpm lint             # next lint (ESLint)
pnpm lint:fix         # next lint --fix
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run (single run)
pnpm test:watch       # vitest (watch mode)
pnpm test:coverage    # vitest run --coverage (v8) — what CI runs
pnpm clean            # rm -rf .next out

# Run a single test file
pnpm vitest run src/lib/__tests__/utils.test.ts
# Run tests matching a pattern (-t = test name)
pnpm vitest run -t "formatTimeAgo"
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

|                 | docked (`lg`+)             | overlay (below `lg`)                                  |
| --------------- | -------------------------- | ----------------------------------------------------- |
| role            | `navigation` landmark      | `dialog` + `aria-modal`                               |
| page            | inset by `--sidebar-width` | **pushed aside** by `--sidebar-overlay-width`, dimmed |
| choosing a page | **stays open**             | closes                                                |
| focus / scroll  | untouched                  | trapped / locked                                      |
| Escape          | ignored                    | closes                                                |

The docked column is the point. It first shipped as a modal drawer that closed on every navigation, and owner review named that exactly right: _"what you showed us was just a menu dropdown"_. **A menu that closes on every click is a dropdown**; a sidebar is the thing you navigate _from_, repeatedly, with it still there. Below `lg` there is no room for an 18rem column beside an article, so it overlays — and the four modal behaviours belong to the overlay **only**: docked, a focus trap strands a keyboard reader inside a panel that is simply part of the page, and a scroll lock freezes a document nothing is covering.

It is **one DOM tree reshaped by responsive classes plus an `isDocked` flag**, never two subtrees behind `lg:hidden` — jsdom applies no media queries, so both would render in every test and every `getByRole` would match twice (the trap the deleted `ArticleActionBar` is the cautionary tale for — see the island note below). `isDocked` comes from `matchMedia`, because focus trapping, scroll locking and closing-on-navigation cannot be expressed in CSS, and it is kept **live** so a rotated tablet gets the right behaviour rather than the one its viewport had at mount.

**The breakpoint is 1024px in two places and must stay that way** — `SIDEBAR_DOCK_BREAKPOINT_PX` builds the `matchMedia` query, and a `@media (min-width: 1024px)` rule in `globals.css` insets the page. `sidebar.test.ts` asserts they still agree: a drift leaves a band of widths where the page is inset for a sidebar that still behaves like a modal.

**Below `lg` the page is PUSHED, not covered** (owner direction 2026-09-11, with the Claude mobile sidebar as the reference). The shell translates right by exactly the panel's width and stays on screen, dimmed, with its leading corner rounded — so it reads as the page you were on, moved aside, and it is obvious you get back by tapping it. A panel that merely covers the page leaves nothing to aim at but a scrim. **`--sidebar-overlay-width` is the panel's width AND the push distance**, one value: short and a strip of page is still covered, long and there is a band of void beside it; `sidebar.test.ts` asserts both read the same token. It is capped at `86vw` so a narrow phone never pushes the page clean off the right edge, leaving the way back invisible. The floating bottom pill moved **inside** `.app-shell` for this — left outside it would hang over the sidebar while everything beneath it slid away.

The push uses `transform`, not `margin-left`, to stay off the layout path. The cost is that a non-`none` transform makes the shell the containing block for `position: fixed` descendants — the island, chiefly — so the page's pinned furniture travels with the page, which is what you want while the sidebar is open. Closed, the transform is `none` and nothing is contained (`none` interpolates as the identity transform, so it still animates).

**The page inset is CSS keyed off `data-sidebar`, not React state**, set pre-paint by the same bootstrap that restores the theme and outlines. The panel may arrive a frame late — it slides in on a transform, so late reads as the animation — but the inset cannot: from an effect it would shift the whole document sideways one frame after paint on every load for a reader who left the sidebar open. State is persisted to `localStorage` (`mukoko-news-sidebar`); within a session the provider lives in the root layout and so already survives every in-app navigation.

**`inert` when closed is load-bearing** — a `-translate-x-full` alone leaves every link focusable off-screen, so a keyboard reader tabs into an invisible menu; and it must be `inert={!open || undefined}`, because the attribute is inert by PRESENCE and `inert={false}` renders `inert=""`. The panel carries **no theme toggle**: that would make `ThemeProvider` a hard requirement of every surface mounting it.

**The toggle is at the FAR LEFT of the header and wears `PanelLeft`.** Both were corrected on owner review. It had sat in the actions pill on the right, grouped with search and the account control — the one place a sidebar toggle never goes, and (once the sidebar docks) the opposite edge from the thing it toggles. The icon was a hamburger, which promises a menu that drops down and goes away; `PanelLeft` is the glyph readers already know from every editor and mail client, and it swaps to `PanelLeftClose` when open so it states what the next tap does. `header-sidebar-toggle.test.tsx` asserts the DOM order and the rendered glyph, because "far left" is a claim about order rather than a class name.

**The masthead is IN THE FLOW, at the left** (owner report 2026-09-11 — _"Look at the header the wordmark needs to be left not centered"_). The wordmark and the scrolled page title cross-fade in one place, and they used to do it as two `position: absolute` children of a `relative` box — which measured **zero wide**, because absolutely positioned children contribute nothing to their parent's size. A zero-width flex item between the toggle and the actions pill is placed by `justify-between` in the **middle** of the free space, and the wordmark, overflowing it, ran out from there and straight under the pill. The two layers now share one cell of a **one-cell grid** (`col-start-1 row-start-1` on both): they still stack and still cross-fade, but the container takes the width of the wider of them, so it is the first in-flow item in the row and starts at the left edge. `min-w-0` + `truncate` is the other half — with a real width the lockup takes part in shrinking, so a narrow phone ellipsises it rather than pushing the pill off the header. `header-masthead.test.tsx` asserts layout **participation** rather than an alignment class, because a future edit that reintroduces the absolute stack would re-centre the wordmark without touching a single `justify-` class.

**The header is two bands, not one centred container** (owner review 2026-09-11). The toggle belongs to the SHELL's left edge, hard against the sidebar it opens; the masthead belongs to the centred reading column. They were one `mx-auto max-w-[var(--width-wide)]` container, which on a wide screen put **~580px of empty header** between the docked sidebar and the control that closes it — _"this versus this is too far apart"_. **And the header hides its own wordmark while the sidebar is docked open**: the sidebar carries the masthead there, so the header repeating it put the same lockup on screen twice at two different heights — _"the sidebar heading sits here, it's out of context across the whole"_. The sidebar's brand row now uses the header's own icon size, wordmark size and vertical padding, so the masthead sits on one baseline straight across the top of the app. The header now genuinely requires `SidebarProvider` — that coupling is the feature, so the header's suites wrap it rather than mocking it away.

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

| Server Action                        | Backed by                   | Returns                                                       |
| ------------------------------------ | --------------------------- | ------------------------------------------------------------- |
| `getSectionedFeedAction(params)`     | articles/categories/sources | `SectionedFeed` (topStories, yourNews, byCategory, latest, …) |
| `getArticlesAction(params)`          | `getArticles`               | `{ articles: Article[], total: number }`                      |
| `getArticleAction(id)`               | `getArticleById`            | `Article \| null`                                             |
| `getNewsBytesAction(limit)`          | `getNewsByteArticles`       | `Article[]`                                                   |
| `searchArticlesAction(q, …)`         | `searchArticles`            | `{ articles, total }`                                         |
| `getSavedArticlesAction()`           | `getSavedArticles`          | `Article[]`                                                   |
| `getCategoriesAction()`              | `getCategories`             | `Category[]`                                                  |
| `getTrendingCategoriesAction(limit)` | `getTrendingCategories`     | trending categories                                           |
| `getSourcesAction()`                 | `getSources`                | `Source[]`                                                    |
| `getStatsAction()`                   | `getStats`                  | aggregate stats                                               |
| `getTrendingAuthorsAction(limit)`    | `getTrendingAuthors`        | trending authors                                              |

`mongodb/client.ts` owns the singleton `MongoClient` (reads `MONGODB_URI` / `MONGODB_DATABASE`). `mongodb/admin.ts` powers admin **reads**; admin **writes** go through the gateway (below).

> ⚠️ **Measured 2026-09-11 — why `/insights` said "No data available yet" over 65,203 articles.** `BASE_MATCH` is `{status: {$ne:'rejected'}, moderationStatus: {$ne:'removed'}}`, and **`$ne` is never index-selective**, so every pipeline opening with it is a COLLSCAN of a 1.5 GB collection. Explained on the live cluster, a two-branch `$facet` behind it took **27,529 ms** and examined all 65,203 documents with **zero index keys** — and that was the _cheapest_ of the module's seven reads. The Vercel function was killed long before it returned, `getCorpusSummary()` fell into its catch, and the fail-soft empty result rendered as a statement that the corpus is empty: **a failure presented to a reader as a fact**, which is the one thing this repo's doctrine forbids everywhere else. It also excludes **nothing**: an Atlas Search facet over `status` reports one bucket, `approved`, 65,203 of 65,203 — not one article has ever been `rejected`.
>
> Three things followed. (1) `CorpusSummary` carries **`ok`**, because every figure is zero both when the corpus is empty and when the read failed; the page now says _"We couldn't load these figures"_ for the second. (2) The reads that **can** be served by an index or by Atlas Search no longer carry the filter — `getCorpusSummary` and `getCountryCoverage` are rebuilt on `$searchMeta` facets (milliseconds, exact counts via `count: {type:'total'}`, not the default lower bound), a `$group` on `countryCode` with **no filter** (a `DISTINCT_SCAN` on `countryCode_1_feedSourceId_1`: 43 keys, **0 documents**, 90 ms — adding `BASE_MATCH` is what turns that same query into the 27-second scan), `countDocuments({aiProcessed:true})` on `aiProcessed_createdAt`, and one document off each end of `{datePublished:-1, status:1}` for the range. (3) **Every** aggregation in `insights.ts` and `analytics.ts` now carries `maxTimeMS`: unbounded, a slow read does not fail, it _hangs_, holding the function until the platform kills the request — which a reader sees as a blank page rather than a degraded one.
>
> `avgQualityScore` is now `number | null` and is **null**: there is no index on `qualityScore` and no Atlas Search mapping for it, so averaging it means reading every document. `0` would render as _"this corpus scores zero on quality"_.
>
> **The remaining five panels, 2026-09-11.** `getPublishingVolume`, `getSourceLeaderboard`, `getCategoryDistribution`, `getSentimentBreakdown` and `getTopTopics` were all still document-scanning and so rendered empty. They now read `$searchMeta` facets too, which needed a **second Atlas Search index**.
>
> **`articles_insights`** (`news.articles`) maps only what the dashboard counts: `aiSentiment`, `aiKeywords`, `engagement.interest_categories`, `engagement.tags`, `feedSourceId`, `countryCode`, `datePublished`, `status`, `aiProcessed`, `qualityScore`, `wordCount`. No bodies, no analysed text. It is **additive** — `articles_text_search` is untouched, and the reads that already work stay on it, so a rebuild or mapping change here cannot take the corpus summary and country coverage down with it. Dropping `articles_insights` degrades three panels; it does not break search.
>
> | panel       | how                                                                                             | note                                        |
> | ----------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------- |
> | volume      | `dateFacet` over the window's day edges + `feedSourceId` facet, **one** round trip              | a date bucket's `_id` is its lower boundary |
> | leaderboard | `feedSourceId` facet + two small-collection `find`s                                             | **no averages** — see below                 |
> | categories  | `engagement.interest_categories` facet, `numBuckets: 200`                                       | measured **52** distinct values, not 40     |
> | sentiment   | `aiSentiment` facet; `count: {type:'total'}` supplies the coverage denominator in the same call | 4 labels live                               |
> | topics      | `aiKeywords` facet over 7 days, over-fetched                                                    | the stopword filter runs after the counts   |
>
> **A facet counts documents per value; it cannot average a field across them.** So `SourceLeaderboardRow.avgQualityScore` / `avgWordCount` / `lastPublished` are `null`, and the table **drops those three columns** rather than rendering a permanent `—`: a column that can never hold a value is noise, and a dash in every row reads as missing data rather than as a capability we do not have. `countries` is now the source's own registered country from `feedSources` (one read on 587 rows) rather than the distinct set over its articles. They come back when `qualityScore` / `wordCount` are rolled up upstream.
>
> ⚠️ **`engagement.interest_categories` carries 52 distinct values, not the platform's 40** — a mix of that set (`fintech-mobile-money`, `ai-machine-learning`) and the 17-slug vocabulary the pipeline invented before it (`politics`, `international`, `economy`, `crime`), left behind by the enrichment rebuild. A first cut used `numBuckets: 50` on the assumption that 40 was closed, which truncated the tail **and** made `totalAssignments` the sum of a head rather than the true total every share is computed against. Cleaning that history up is pipeline work; 200 buckets means this does not under-count while it waits.

**Public Insights / open-data analytics** — `src/lib/mongodb/insights.ts` holds read-only aggregation pipelines over `news.articles` (+ `feedSources` / `newsMediaOrganizations`) for the flagship open-data dashboard: `getCorpusSummary`, `getPublishingVolume`, `getSourceLeaderboard`, `getCategoryDistribution`, `getCountryCoverage`, `getSentimentBreakdown`, `getTopTopics`. **Every function is wrapped so a failure returns an empty-but-typed result — it never throws to the page.** `src/lib/actions/insights.ts` exposes them as Server Actions (incl. the aggregate `getInsightsBundleAction`), which back the server-rendered, ISR-cached (`revalidate = 600`) `/insights` page. Metrics computed over an enriched subset (sentiment, quality) carry an explicit **coverage %** so nothing is misrepresented.

**Analytics query console (`/analytics`)** — the deep dive `/insights` links into. `src/lib/mongodb/analytics.ts` holds the corpus query engine: `runCorpusQuery` returns every panel from a single `$facet` (daily series, source/country/category/keyword/named-entity/byline breakdowns, sentiment, quality, sample articles) plus the **normalized** query it actually ran, so the UI captions results with the filters that were applied rather than the ones requested. A text term leads with Atlas Search (`articles_text_search`) and falls back to a bounded substring `$match`, flagged on the result as `usedSearchIndex` so the page can say so. `getCoverageConcentration` answers the editorial question the old page faked — sources per country, top-source share, HHI, and the countries with no coverage at all. `getQueryFacets` populates the controls. All three are wrapped fail-soft like the Insights reads. `src/lib/actions/analytics.ts` exposes them, validating **every** input through the `@/lib/safety` schemas first (Server Actions are a public RPC surface); the two query-independent reads are wrapped in `unstable_cache` (600s, tag `analytics-facets`) so the `force-dynamic` page costs one aggregation per view, not three. `src/app/api/analytics/export/route.ts` exports one query as JSON or a labelled multi-table CSV — cells are RFC-4180 quoted **and** formula-neutralised (a leading `=`/`+`/`-`/`@` is prefixed with `'`, because the file carries publisher-controlled text: source names, bylines, `aiKeywords`, `aiNamedEntities`). It is per-caller by design so it is NOT edge-cached; 10 req/min/IP instead.

**Byline pages (`/author/[...slug]`)** — `src/lib/mongodb/authors.ts` answers two reads. `getBylineDirectory()` is one aggregation over the attributed corpus, cached for an hour and shared by every author page: it folds spelling variants onto a single key (diacritics included, so "José Silva" and "Jose Silva" are one journalist), names each by its most-published spelling, and is what makes slug → byline resolution _exact_ rather than a reconstruction. `getAuthorProfile()` answers all seven panels from a single `$facet`. `src/lib/author-identity.ts` is the pure module that decides whether a byline is a **person** or a **desk** — a closed lexicon, word-boundary matched without `\b` (which is defined on `\w` and so excludes the accented letters this corpus carries). A person gets one page over the whole corpus; a desk gets one page _per newsroom_ (`/author/<newsroom>/<desk>`), because "Staff Reporter" is measurably the desk byline of ten mastheads in four countries and one page for it would assert a single writer filed all 198 articles. A desk with no resolvable newsroom renders as plain text and gets no page — there is nothing to scope it to, and plain text is a smaller loss than a false attribution. Byline matching is `$in` **equality, never regex**, so an index on `{'author.name': 1, datePublished: -1}` would serve it — and that index is now REQUIRED, not an optimisation. `src/lib/actions/authors.ts` is the Server-Action door.

> ⚠️ **Measured 2026-09-17 — why every byline page said "Byline not found" over real journalists.** This paragraph used to claim both reads "are windowed to 365 days so they ride `status_1_datePublished_-1` as a range seek". That was wrong, and so was the first correction to it. **Both were replaced by a real `explain` on the live cluster** (below); the reasoning that came before it is not kept, because a plausible mechanism stated with confidence is what made this bug invisible in the first place.
>
> **What the planner actually did, before the index.** Winning plan: `GROUP → FETCH → IXSCAN status_1_datePublished_-1`. Three things follow, and the first two contradict what was written here:
>
> 1. **It was never a COLLSCAN.** It used an index, with a genuine range seek.
> 2. **The `$ne` on `status` was not on the leading key.** ⚠️ `status_1_datePublished_-1` **is misnamed** — its actual key pattern is `{datePublished: -1, status: 1}`, so `datePublished` leads and its `$gte` bound seeks normally. (A separate `status_1_datePublished_-1_v2` **does** have `{status: 1, …}`; the planner rejected it.) Never infer a key order from an index NAME on this collection.
> 3. **The cost was the FETCH.** `author.name` and `moderationStatus` are in no index, so every key in the seek became a document read — and because the 365-day window is **wider than the corpus** (oldest articles 2026-05) the seek excluded nothing. ~65,000 documents pulled from a 1.5 GB collection, every render. `QUERY_MAX_TIME_MS` (15 s) aborted it; a direct connection did not return within 60 s.
>
> **The index that was created** (`authorName_1_datePublished_-1_covering`, live 2026-09-17): `{'author.name': 1, datePublished: -1, mediaOrganizationId: 1, status: 1, moderationStatus: 1}`. It carries every field the directory's `$match` and `$group` touch, so the read is **covered**. Re-explained: the plan is now `GROUP → IXSCAN` with **no FETCH stage**, `totalDocsExamined` **0** (from ~65,203), `totalKeysExamined` 58,660, `isMultiKey` false — `author` is an object, not an array, which is what makes coverage possible at all. It serves `getAuthorProfile` too: that read's `$in` on one to three exact spellings is an equality on the leading key, so it seeks on the `{'author.name', datePublished}` prefix.
>
> ⚠️ **It is necessary but NOT sufficient, and the remainder is not a query problem.** Four timings of the identical covered query — identical plan, identical zero documents, ~58,700 keys each:
>
> | run                             | when      | wall-clock    |
> | ------------------------------- | --------- | ------------- |
> | 1 (index just built)            | 18:00     | 16,719 ms     |
> | 2                               | 18:02     | 19,041 ms     |
> | 3                               | 18:04     | 46,641 ms     |
> | **4 (warm, credits recovered)** | **18:46** | **11,057 ms** |
>
> The first three degrade because **the measurements themselves drained the CPU credits**; the fourth, taken 45 minutes later, is the only fair one. The cluster is an **M20** (2 burstable vCPU, 4 GB RAM, AWS af-south-1) hosting a 1.5 GB hot collection, 14 classic indexes, 3 Atlas Search indexes and the platform's other ~29 databases. Removing the `$ne` pair was tested and made it **slower** (19.0 s), so the `$ne` clauses are not the cost either. Never read one timing off this cluster as a fact — take a warm one, and say which it is.
>
> **At 11.06 s the directory read now clears `QUERY_MAX_TIME_MS` (15 s) and completes rather than aborting.** But the binding constraint then moved to the Vercel function: there was no `maxDuration` anywhere in this repo and no `vercel.json`, so the platform default applied, and an 11 s query does not fit it — on a cold `unstable_cache` the request was killed by Vercel before Mongo's own bound ever fired.
>
> **`/author/[...slug]` now carries `export const maxDuration = 60`** (owner decision 2026-09-19), and **the point is the ORDERING, not the headroom.** Every failure path on that route is built on OUR bound firing: `maxTimeMS` aborts → the reader reports `ok: false` → the action answers `unavailable` → the route throws → the reader gets a 5xx instead of a claim about a named journalist. A platform timeout preempts all of it — the function is killed with no stack in it, so nothing decides anything and nothing is logged. A `maxDuration` shorter than the query bound silently reinstates the exact failure the byline fix removed. 60 s is the smallest value clearing the ~30 s worst case (a cold render does the directory read AND the profile read, each bounded at `QUERY_MAX_TIME_MS`) with room for connection setup and render, and it is at or below the cap on every Vercel plan so it cannot fail a deploy. It is a **ceiling, not a target** — a warm ISR hit still returns in milliseconds and nothing waits longer than it did; the budget only decides who gives up first. Verified in `.next/server/functions-config-manifest.json`, which is the file Vercel reads: `/author/[...slug] -> {"maxDuration": 60}`. `author-page.test.tsx` asserts the **relationship** rather than the number — it reads `QUERY_MAX_TIME_MS` out of `client.ts` and requires `maxDuration ≥ 2 ×` it, with a separate assertion that the regex still matches so the comparison cannot pass vacuously.
>
> ⚠️ **This unblocks; it does not make anything fast, and the other two options are still open.** Moving the directory build off the request path so no reader waits on it is the real fix; resizing the instance is the other — 11 s for 58,810 **covered** index keys is ~8,250 keys/sec, far slower than that work should take and unlikely to be this query's problem alone.
>
> What this repo fixed is the second failure, which is the one the doctrine actually forbids: the outage was being **published as a fact about named people**. `getBylineDirectory` returned `[]` on timeout, which is also what a corpus with no bylines looks like; the action turned that into `null`, the page turned `null` into `notFound()`, and `unstable_cache` memoised the empty list for the full hour — one 15-second timeout, sixty minutes of every journalist on the platform not existing. Both reads now carry **`ok`** (same flag, same reason as `CorpusSummary.ok`), `getAuthorPageAction` returns `'ok' | 'not-found' | 'unavailable'` instead of `AuthorPage | null`, and the route **throws** on `unavailable` so an unreadable corpus answers 5xx: a 404 tells a crawler to drop a real byline's page, and a 200 over "we couldn't load this" tells it the emptiness is the content. The cached wrapper **rejects** rather than returning a failed read, because `unstable_cache` stores a resolved value and stores nothing for a rejection. `author-directory-availability.test.ts` drives a rejecting driver through the real reader, the real cache and the real action and asserts all of it — the previous suite asserted the OPPOSITE ("404s when the directory read failed") and passed throughout the outage.

### A `loading.tsx` above a route THROWS AWAY its status code (measured 2026-09-17)

**This is the HTTP 200 in the byline report, and it was never about bylines.** `loading.tsx` is a Suspense boundary wrapped around a segment's children. Next streams the shell the moment it suspends — and **the HTTP status line goes out with that shell**, before the page's async work has resolved. Once sent it cannot be taken back, so whatever the page decides afterwards is rendered into a response that already said `200 OK`.

One file, `src/app/loading.tsx`, sat above every route in the app. Measured on a production build (`next build && next start`, Next 15.5.25), rebuilding once per row:

| route                                               | with it | without it |
| --------------------------------------------------- | ------- | ---------- |
| a page calling `notFound()`                         | **200** | 404        |
| the same page under `revalidate` or `force-dynamic` | **200** | 404        |
| a page whose whole body is `throw new Error(...)`   | **200** | 500        |
| `/author/…` over an unreachable cluster             | **200** | 500        |
| an unrouted path (never renders a page)             | 404     | 404        |

So `notFound()` **and** `throw` both answered 200 from every rendered dynamic route, while a path with no route at all 404'd correctly — which is why this read as route-specific and was not. Live on `main` at the time: `/author/abubakar-ibrahim` → `200` titled _"Byline not found"_, and `/article/000000000000000000000000` → `200` titled _"Article Not Found"_, both carrying Next's real 404 body (`NEXT_HTTP_ERROR_FALLBACK;404`). `/article/[id]` carried its **own** `loading.tsx` on top, so every dead article id was a 200 to a crawler — the exact soft-404 that page's own comment says it exists to prevent, aspirational for as long as the boundary was there.

Ruled out on the way, each by rebuilding without it: the AuthKit middleware, `revalidate` (`force-dynamic` behaves identically), MongoDB, and the author route specifically. A page with no database and no ISR reproduced it.

**Both files are deleted**, and `/article/[id]` **kept its skeleton anyway** (owner direction 2026-09-17 — _"keep the article skeleton with the in-page Suspense"_) by moving the boundary INSIDE the page, which is the general rule below applied rather than an exception to it:

```tsx
if ((await articleExists(id)) === false) notFound()   // outside: decides the status line
return (
  <Suspense fallback={<ArticlePageSkeleton />}>       // inside: streams
    <ArticleBody id={id} />
  </Suspense>
)
```

That needed the route's one read split in two. **`articleExists`** (`mongodb/articles.ts`) is a projection of `_id` alone — covered outright by `_id_`, an index scan with no document FETCH and no joins — and it is all the 404 decision needs. `getArticleById` stays behind the boundary, where its ~25 KB document and its two further round trips (`feedSources`, the publisher organisation) cost the reader a skeleton rather than a blank page. It is three-valued like every other read here: `false` is a finding about the id, **`null` is "we could not look"**, and only the first is a 404. Measured on a production build: `articleExists → false` answers **404**, a read failure answers **200** with the skeleton, `/author/…` over a dead cluster answers **500**, and an unrouted path still answers 404. `article-page-soft-404.test.ts` asserts the ordering structurally — that `getArticleById` has **not** been called when the boundary is returned — so an edit that awaits the article above the boundary fails rather than silently costing the status code again.

`/` pays nothing for its deletion: `revalidate = 180` prerenders it (`○`), so ISR serves the stale page while it regenerates and the skeleton was almost never on screen. `/discover` and `/insights` **keep** their `loading.tsx`: both prerender, both are fail-soft, and neither calls `notFound()` nor throws, so neither has a status code to lose.

`src/app/__tests__/route-status-codes.test.ts` is the guard. It is keyed on **ancestry, not on a filename** — it walks every `page.tsx`, and any that calls `notFound()` or throws must have no `loading.tsx` at any level from `src/app` down to its own segment. That is the shape of the bug: the boundary that decided `/author`'s status code was one nobody would have associated with `/author`. A second assertion names the root file specifically, so a reintroduction fails with the reason attached. Verified non-vacuous: restoring either file fails it, naming the page and the boundary.

> ⚠️ **The general rule: a route that can answer 404 or 5xx must not stream its shell early.** If such a route needs streaming, the existence check has to resolve in the page _before_ any Suspense boundary, with `<Suspense>` around the slow sub-tree _inside_ the page — never a `loading.tsx` above it.

### The loading mark (`components/ui/mukoko-spinner.tsx`)

**`MukokoSpinner` is the app's one loading indicator: the Seed of Life, turning.** It does **not** redraw the mark — inlining the seven polygons in JSX would be a second copy of the artwork, free to drift from the `public/mukoko-mark-full-{light,dark}.svg` every other surface renders, and free to break the mark doctrine (no recolouring, no reordering, no gradients, no mono reduction). It renders those files and animates the **transform of the boxes around them**, which cannot touch a fill.

Two nested elements, because both halves animate `transform` and one element cannot run two transform animations at once: the outer turns (2.4s linear), the inner breathes (1.6s ease-in-out, scale + opacity). The rotation is a full **360°, not the 60°** the six-fold geometry would allow — 60° loops seamlessly in shape but lands cobalt where gold was, so the ring would read as changing colour; a whole turn returns every mineral to its own cell.

⚠️ **It deliberately does not use `AppIcon`.** `AppIcon` picks its file with `useTheme()`, and this app's `useTheme` **throws** outside a `ThemeProvider` — so building on it would make `ThemeProvider` a hard requirement of every skeleton, empty state and test that mounts a spinner. That is the same coupling the nav sidebar's "no theme toggle in the panel" rule avoids. Both marks are rendered instead and the `.dark` class picks one in **pure CSS**, which also puts the correct mark in the first paint rather than one frame after it. `mukoko-spinner.test.tsx` renders it with **no provider in the tree**, so a rebuild on `AppIcon` fails there rather than at a call site.

It is **decorative by default** (`aria-hidden`) and announces only when given a `label`: inside `ArticlePageSkeleton`, which already carries `role="status"`, a second live region would make a screen reader say the same thing twice. Under `prefers-reduced-motion: reduce` both animations stop and the mark settles at 0.85 opacity — **present and still, not gone**, because the reader still needs to know something is loading. A test reads `globals.css` for that rule, since nothing in the DOM can prove the stylesheet honours it.

**`ArticlePageSkeleton` mirrors the article's real geometry**, which is the only thing that stops the page jumping when it resolves: same column tokens (`--width-reading`, `--page-gutter`, `--page-block-reading`), a headline at the article's own `text-3xl`→`2.75rem/1.15` rather than a flat `h-10` that was short by a third on desktop, and placeholders for the summary card, the hero-sized CTA pill and the provenance panel that the previous version omitted entirely. The spinner sits **inside the hero well** rather than above the column — that is where the eye already is, and a loading indicator stacked on top would push every bar below it down, so the skeleton would stop standing in for the article's geometry, which is its whole job.

### Data Flow (writes / mutations)

- **Engagement** (like / view / save) — Next.js **Route Handlers** under `src/app/api/articles/[id]/{like,view,save}/route.ts` (`POST`, `runtime = 'nodejs'`), rate-limited via `src/lib/rate-limit.ts` (`checkRateLimit` — **async** — and `getRequestIp`). When `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are set the limit is enforced globally via the Upstash REST API (fixed window, fails open); otherwise it's the in-memory per-instance window. Likes/saves are keyed to an **engagement subject** (`src/lib/engagement.ts`): the signed-in WorkOS user (`user:<id>` — follows the account across devices; anonymous cookie history is claimed on first signed-in interaction) or the `mukoko_session` cookie. The stored field remains `sessionId` — an opaque subject key to the gateway/pipeline. `src/app/api/health/route.ts` is the health probe.
- **Admin mutations** — `src/lib/admin/gateway.ts` proxies to the gateway Worker's WorkOS-gated `/api/admin/*` endpoints, forwarding the WorkOS access token as a Bearer header so the Worker re-verifies the same RBAC. **This is the only place the frontend touches the gateway.**
- **Own-profile reads/writes** (owner decision 2026-09-01) — **`identity.persons` is the source for user profile data, not the WorkOS session claims.** It carries strictly more: the profile picture is hosted on `profile-images.mukoko.com` (absent from the token), plus `preferredUsername` and `interests`. `src/lib/mongodb/identity.ts` reads/writes the caller's own record (matched on `workosUserId`, `$set` restricted to an explicit allowlist — `givenName`/`familyName`/`name`/`preferredUsername`/`interests`; never `bundu`, `role`, `workosUserId`, or the merge bookkeeping, and **never upserts** since the gateway webhook creates the record). `src/lib/actions/profile.ts` exposes `getMyProfileAction()`, `updateProfileAction()` and `updateInterestsAction()`; each takes **no user id** — it comes from the verified session, so a crafted request cannot retarget another account. A name write updates the DB record first (that is what the platform reads) and then **mirrors to WorkOS best-effort** so the IdP does not drift; the mirror round-trips back through the gateway's `user.updated` webhook into the same record, so a WorkOS failure must not report failure to a user whose canonical copy saved. ⚠️ `mukoko-news-gateway/CLAUDE.md` still says the gateway is the only writer of the `identity` domain — that doc needs updating to match this decision.
- **Pipeline refresh** — `src/lib/actions/refresh.ts` `triggerFeedCollection()` fire-and-forget `POST`s to `FLY_WORKER_URL/trigger/collect` with `FLY_TRIGGER_TOKEN`.
- **Open-data export** (read-only, public) — `src/app/api/insights/export/route.ts` (`GET`, `runtime = 'nodejs'`, `revalidate = 600`) returns the aggregated Insights bundle. `?format=json` (default) emits the full `InsightsBundle`; `?format=csv` emits one CSV with three labelled tables — `## media_organizations`, `## topic_distribution`, `## country_coverage` (RFC-4180 quoted). Rate-limited via `checkRateLimit`/`getRequestIp` (20 req/min/IP → `429` + `Retry-After`); edge-cached (`Cache-Control: public, s-maxage=600, stale-while-revalidate=1800`). Linked from the `/insights` page ("Download open data"). This is a plain Route Handler → MongoDB, not a gateway call.

### Publisher icons (`src/lib/publisher-icon.ts`)

Source favicons resolve from the **publisher's own record**, never from a table of names and never from anything stored on the article. `resolvePublisherIcon()` tries, in order: the organisation's `logo` → the organisation's own `url` → the feed source's own URL (`Article.source_url`, derived on read from `feedSources.sourceUrl ?? feedUrl`) → the article's `externalUrl` host → the `source-profiles.ts` brand table on an **exact** name match → coloured initials. `SourceIcon` (`components/ui/source-icon.tsx`) renders it and falls back to initials on any load failure; `sourceIconProps(article)` is the single place the preference order is expressed.

Why it exists: the old `getFaviconUrl()` only answered for the ~20 hardcoded profiles. Measured 2026-09-10 on the live cluster — **38 of 587** feed sources matched, and because the lookup falls through to a _substring_ test **11 of those 38 matched the wrong publisher** ("National Geographic" and "Amnesty International" both contain "Nation", so both were served the Daily Nation's icon). All **537** organisations carry an http(s) `url` and all 587 sources resolve to one, so a domain is now derivable for **587 of 587**. Nothing is written to `news.articles`: publisher identity — including verification — has exactly one instance, on the publisher record, and the article's `mediaOrganizationId` / `feedSourceId` is the whole link.

**Privacy**: the favicon service URL is never handed to the browser. It is wrapped in `imageProxyUrl()` so the request goes to the image worker (`assets.mukoko.com/i/*`), which fetches it server-side and caches it in R2 — so no reader IP, UA, cookie or `Referer` reaches a third party, and one fetch serves every reader. A publisher-hosted `/favicon.ico` is deliberately not tried: `image/x-icon` is not on the worker's content-type allowlist.

### API Client (`src/lib/api.ts`)

Used for client-side fetches and the embed widget, and exports the shared `Article` type. `NEXT_PUBLIC_API_URL` is empty by default (relative URLs → Next.js Route Handlers → MongoDB). Only set it to an external URL for the Cloudflare widget/resale API.

## Testing

**Vitest 4 with jsdom + React Testing Library.** `pnpm test` prints the current count;
no figure is written down here, for the same reason the README carries no coverage number —
a count in a document nothing checks is stale by the next merge. (It went stale inside a
single branch once already: this line was corrected from "~1,000 across 64", then a later
commit on the same branch added 19 tests.)

- Config: `vitest.config.ts` (globals on, `@` alias, `include: src/**/*.{test,spec}.*`)
- Setup: `src/__tests__/setup.ts`
- Coverage (v8): thresholds **75%** statements, **64%** branches, **72%** functions, **77%** lines — enforced by CI, which runs `pnpm test:coverage`. Ratchet them up as coverage rises; never down to make a build pass.
- **Mocking the MongoDB readers**: `src/lib/__tests__/helpers/mongo.ts` stubs the driver at the `getDb()` seam (`collectionStub` / `dbStub`), which is what lets a test assert on the query that was issued — the projection, the sort key, the filter. Use it rather than mocking the reader module, and follow the existing suites (`mongodb-articles`, `mongodb-catalogue`, `mongodb-analytics`, `insights`, `places`).
- **Mock pattern for pages**: always mock `@/lib/actions/feed` (NOT `@/lib/api`) — pages read via Server Actions. Match the return shapes in the table above.

**Pre-commit hook** (Husky, `.husky/pre-commit`): runs `vitest related` on staged files, then `typecheck`, then `build`. All three must pass (uses `pnpm`).

**CI** (Node 24):

- `lint / *` (`.github/workflows/lint.yml`, the org reusable gate) — actionlint, JSON validity, prettier, markdownlint, yamllint
- `deploy.yml` — `ESLint`, `Typecheck`, `Test` (`pnpm test:coverage`) and `Build`, run in parallel, each installing with `pnpm install --frozen-lockfile`; plus `Single lockfile`, which fails if an npm/yarn/bun lockfile is committed
- `dependency-review.yml` — fails a PR that introduces a high-severity advisory

There is also a `claude.yml` workflow for the Claude GitHub app.

## Deployment

Auto-deploys to Vercel on push to `main`.

## MCP Servers

`.mcp.json` registers project-scoped MCP servers that load automatically in Claude Code.

| Server        | Type / URL                           | Auth                  |
| ------------- | ------------------------------------ | --------------------- |
| `mukoko-news` | http — `https://news.mukoko.dev/mcp` | Product MCP (gateway) |
| `fly`         | stdio — `flyctl mcp server`          | Local `flyctl` auth   |

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

**Entity memberships (read-only)** — `src/lib/mongodb/entity.ts` reads the caller's **active** memberships from `entity.memberships`, joined to `entity.entities` for the org name. This exists because the WorkOS token cannot carry them: measured on the live cluster, **every currently-active membership has no `workosOrganizationId`**, while the only memberships that do carry one have already ended — so a claims-only check reports "no membership" for every active member the platform has. Resolution is two hops (`WorkOS user id → identity.persons._id → entity.memberships.personId`), because the domains key on different ids. The active filter checks **both** `isActive` and `endedAt`; neither is redundant (`endedAt` is set on more rows than `isActive: false` covers). Fail-soft: a failed read returns an empty list, so callers must treat empty as _unproven_, never as _proven absent_ — it is not a signal to grant anything. **Nothing here writes**: `entity` is owned by the gateway and its WorkOS webhook.

**Entity capabilities are not platform tiers** (owner decision 2026-09-02) — `src/lib/auth/entity-access.ts` is the _only_ consumer of memberships, and it turns one into `EntityCapability`s (`entity:read` / `entity:manage` / `entity:members`) that apply to **that one entity**. It cannot produce a `Tier`: it imports nothing from `roles.ts`, `roles.ts` reads no database, and `/admin` takes no membership input — three assertions the `entity-access` test suite enforces structurally, so a future edit that wires them together fails CI rather than silently widening access. Capabilities come from `membershipRole` through a **closed** map (an unknown role grants nothing); the row's own `permissions` array is never consulted for a decision, and `sanitizeEntityPermissions` strips the reserved namespaces (`platform:`, `mukoko:`, `nyuchi:`, `admin:`, `news:`, plus bare `admin`/`superadmin`/`moderator`/`support`/`staff`) on read. That is not theoretical: an active membership on the live cluster carries `permissions: ["platform:admin"]`, on an entity with **no** `workosOrgId` to reconcile against, and several other active memberships are of `entityType: "family"` entities — founding your own household is not staff access. Since `entity` is written by the gateway's WorkOS webhook and MongoDB's validators accept unknown fields, honouring a slug from there would make every writer to `entity` an authority on who administers this app. Every decision grants on the **presence** of a membership, so the fail-soft empty read denies rather than opens. `src/lib/actions/entity-access.ts` is the Server-Action door; `src/components/profile/profile-organizations.tsx` shows the caller their own memberships on `/profile`.

### Reader access tiers (`src/lib/access.ts` + `src/lib/metering.ts`) — NOT staff RBAC

**One map, consulted everywhere** (owner decision 2026-09-11 — _"I need to start making money from this some how"_; shape set 2026-09-19 — _"Free = public is 50 articles 5 searches, then the rest is gated but free user tier — have to be logged in. Similar to how Instagram and TikTok work. Interactions is gated by auth. Analytics and AI is gated to auth, 5 article insights then tiers by subscription kicks in."_).

**Two mechanisms, and keeping them apart is the point of the file.**

|                                                   | what it answers                                             | where        |
| ------------------------------------------------- | ----------------------------------------------------------- | ------------ |
| **gate** (`canAccess`)                            | may this plan reach the feature at all — binary             | `REQUIRES`   |
| **allowance** (`allowanceOf` / `withinAllowance`) | how much of it — a ceiling on something otherwise reachable | `ALLOWANCES` |

Collapsing the two is how an aggregator deletes itself from search. `robots.txt` here deliberately courts crawlers and **for an aggregator that indexed traffic IS the asset**, so reading and searching are **metered, never gated**: the 50-article wall is a thing a _person_ meets after real use, not a gate a crawler meets on its first request.

|                            | anonymous    | free  | pro | custom |
| -------------------------- | ------------ | ----- | --- | ------ |
| articles read              | **50**       | ∞     | ∞   | ∞      |
| searches                   | **5**        | ∞     | ∞   | ∞      |
| AI summaries               | 0 (gated)    | **5** | ∞   | ∞      |
| interactions (like/save)   | ✗            | ✓     | ✓   | ✓      |
| analytics console / export | preview only | ✓     | ✓   | ✓      |

**Plans are `anonymous` < `free` < `pro` < `custom`**, and both the map and the rank **fail closed**: an unknown feature or plan grants nothing, the same rule `entity-access.ts` applies to membership roles. `free`/`pro`/`custom` are **not invented here** — they mirror `MukokoPlan`, the cross-app subscription vocabulary the sibling apps already use (nhimbe's `src/lib/mongo/entitlements.ts`), so one subscription means the same thing in every product. `anonymous` is this app's own addition: the shared field cannot express "not signed in", because the apps that defined it require a session before anything is gated.

⚠️ **Nothing returns `pro` or `custom` yet.** `planFor(signedIn, mukokoPlan)` reads the plan from an argument its callers all pass as `null`, because the billing service that would set `identity.persons.mukoko.plan` does not exist. Checked rather than assumed (2026-09-19): the gateway's `IdentityService.ts` writes only WorkOS OIDC claim fields and **never touches `mukoko.plan`**, so the field has exactly one intended writer and that writer is not yet built. Until it is, everyone signed in reads `free`. The plan must never be read from a field another domain writes freely.

**⚠️ The meters are CONVERSION gates, not confidentiality gates.** `src/lib/metering.ts` counts in the reader's own `localStorage`, so a determined reader clears it in a keystroke. That is the deliberate trade, for the reason above: a server-side wall treats a crawler as an anonymous reader and serves it the wall. **Nothing behind a meter may be a secret**, because the payload was already delivered — if something genuinely must not leave the server it needs a session-gated action of its own. (A first draft of that note also claimed a server-side count would cost `/article/[id]` its ISR. **Measured: that route is already `ƒ` dynamic and was before any of this.** The prerendered metered surfaces are `/`, `/search`, `/discover` and `/insights`; the crawler argument is the one that carries articles.)

**Interactions are the counter-example and are gated properly, server-side** — `src/lib/auth/interaction-guard.ts`, called by `/api/articles/[id]/{like,save}`. Those are POSTs rather than indexed pages, so no crawler issues one and no page is made dynamic by reading the session; a client-side check there would be three keystrokes in a console. It **fails closed** on an auth outage, and it sits **above the article-id validation** — which is also what `access.test.ts` uses to prove it is the guard doing the denying and not something else. **`/view` is deliberately NOT gated**: views fire on every article load including a crawler's.

Three rules the enforcement follows, each recorded because the first cut got it wrong:

- **The verdict is taken on ARRIVAL, before the article is counted, then held.** Asking after spending the fiftieth says fifty is one too many, and a reader promised fifty gets forty-nine. Holding it stops a wall materialising mid-paragraph, which is indistinguishable from the page breaking. A first version derived it live from `hasCounted` and so could never wall anything at all — the effect records the current article, which makes it read as already-paid-for a frame later.
- **Something already given is never taken back.** An article or summary already counted stays readable at the limit.
- **A wall must never state a fact we did not measure.** The search results header reads _"Found N results for X"_, and with the search never issued N is 0 — so the walled branch renders instead of it, not beside it. Same failure `CorpusSummary.ok` exists to prevent.
- **Storage failing must not trap anyone.** A throwing `localStorage` reads as _zero used_ — deliberately the opposite of `withinAllowance`, which treats a broken count as exhausted. A non-finite count can only come from a miswired counter; a throwing read is a person in a private window.

**No reset window, deliberately.** Fifty articles on this device, not fifty a month — the reference was Instagram and TikTok, and those are one-way walls. A rolling window is a reasonable different product decision but it is a _pricing_ decision, and inventing a period here would be this repo's own forbidden move. Adding one later is one field and one comparison.

**This is not `roles.ts`.** That answers "is this person platform staff" from the WorkOS org claims and gates `/admin`. This answers "what has this reader signed up or paid for". `access.test.ts` asserts structurally that neither module imports the other, that no enforcing surface hardcodes an allowance (scanned in the two pure modules — on a JSX file Tailwind's `p-5` and a genuine `slice(0, 50)` make that scan pure noise, so the positive assertion that every decider reads the map carries the rest there), and that the interaction guard is present on `/like` and `/save` and absent from `/view`.

### The source trust score was WITHDRAWN, not gated (owner decision 2026-09-11)

The ask was _"source trust is really good information... make that public, good data for users and researchers, only visible if you are logged in."_ Measured against the live cluster before building on it, the score does not survive:

- `feedSources.trustScore` is `(avgQuality*0.7 + volume*0.3)*100` over a 7-day window — it ranks **recent volume and fluency**, and neither verification nor feed reliability is in it, though the panel rendering it claimed all three.
- **200 of the 201 active sources it rates ≥70 "Established" sit on a feed the platform records as broken**; exactly ONE is healthy, and all 23 genuinely healthy scored sources sit in the LOWEST band. The score is inverted against the thing a reader would take it to mean.
- `src-malawivoice-mw` — 45+ foreign-language casino-affiliate pages — scores **85.8 → "Established"**, because a fluent SEO page scores _well_ on `content_depth`. The platform was publishing "Established" over a spam farm.
- `news.sourceScoreHistory`, which `articles.ts` and this file both described as auditing every change to the score, holds **zero rows**. There has never been a trail.

So it was not gated, it was withdrawn: gating a wrong verdict publishes it to a smaller audience. `ArticleTrustPanel` is deleted. It comes back when the pipeline folds feed reliability into the score — a `nyuchi/mukoko-news-pipeline` change, not one this repo can make.

**`sourceHealth` / `consecutiveFailures` / `lastFetchError` are the second trap, and the sharper one.** They look exactly like the reliability signal a provenance panel wants. Measured the same day: of the 387 active sources sitting in `lastFetchStatus: 'error'`, **351 (91%) carry the platform's OWN MongoDB read timeout** — `…mongodb.net:27017: The read operation timed out` — as the _source's_ fetch error. Only 28 carry a real publisher-side HTTP status. The platform had marked 351 named newsrooms `critical`/`failing` because our database was slow, and that is what the directory's status dot was rendering. **`lastSuccessfulFetchAt` is used instead**: a timestamp of something that demonstrably happened, which cannot blame anyone for an outage. On the same read 138 sources had succeeded within 24h and 238 within a week — the feeds are overwhelmingly fine and the health field was simply wrong.

**What IS published** (`SourceProvenancePanel`, `components/article/source-provenance.tsx`, and the `/sources` rows) is every signal that survived: articles held, feed last successfully read, delivering since, and country **with its provenance** — `declared` / `tld` / `assumed`, shown BECAUSE `assumed` is unflattering. 217 of 414 active sources are `assumed`, the bucket where `theguardian.com` sits filed as Zimbabwean, because `newsdata_collector` registers an outlet under the country it _queried_ rather than the country it is in. A country shown bare reads as a fact; shown as unverified it reads as what it is. Every field is a count or a timestamp — nothing is a judgement — and the panel says so in as many words: _"not a rating of the newsroom."_

`access.test.ts` holds the structural guard: no reader-facing file may read `source_trust`/`trustScore` or `sourceHealth`/`consecutiveFailures`, with comments stripped first so the components explaining why they do not read them are not caught by their own reasoning. ⚠️ `src/{lib,components}/publisher/` is scoped OUT and still renders `Trust {score}` and a health dot to a verified publisher about their own source — a publisher seeing their own number is not the platform publishing a verdict about a third party, but it is the same unsound figure and wants the same treatment.

**What is deliberately public, and why it must stay so.** Article bodies, the home feed, `/search`, `/discover`, `/categories`, `/sources`, `/topic`, `/author` — these are what search engines index, and for an aggregator that traffic _is_ the asset; gating them hides the product from the people who would pay for it. And **`/insights` stays open**: it is the published open-data dashboard this project is partly known for, with a public export endpoint, and a login on it contradicts the claim.

### Open data is defended by CACHING, not by a login (owner decision 2026-09-11)

> _"Open data behind a login is not correct — that is not to gate free data, but those should not be able to be mined by bots, and have a security layer. It's public data."_

This **reverses the 2026-09-01 gate**, under which an anonymous visitor to `/insights` got the corpus summary and a _"Sign in for the full picture"_ card over everything else, `getInsightsBundleAction` and all six panel actions called `requireViewer()`, and `/api/insights/export` answered `401`. All of it is gone.

A login was the wrong instrument twice over. It contradicted the product — the page links a _"Download open data"_ button, and open data you must authenticate for is not open data. And it did not solve the problem it was there for: **a scraper can sign up.** An auth wall stops researchers, journalists and the answer engines this repo's `robots.txt` deliberately courts; it does not stop a determined miner.

**The threat to public data is not that someone reads it — that is the point — it is that reading it repeatedly costs US something.** So the defence makes it cost nothing:

| control                                                                  | what it does                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`/insights` is `revalidate = 600`**                                    | it is now a **prerendered static page** (`○` in the build manifest, 10m). A scraper is served a file from the CDN and never reaches MongoDB.                                                                                  |
| **the export sends `public, s-maxage=600, stale-while-revalidate=1800`** | a thousand scraped requests in ten minutes reach the function at most once; `stale-while-revalidate` keeps that true through the refresh, so no thundering herd.                                                              |
| **rate limit on the export** (20/min/IP)                                 | guards the **origin path** — the cache misses that do get through. Deliberately fail-open (`@/lib/rate-limit`): a limiter outage must not take a public endpoint down, and with the cache in front the blast radius is small. |
| **`robots.txt` disallows `/api/`**                                       | well-behaved crawlers never pull the export incidentally. Courtesy, not enforcement — not relied on.                                                                                                                          |
| **clamped inputs** (`@/lib/mongodb/insights`)                            | public does not mean unbounded; an unclamped `limit` is a denial-of-service parameter.                                                                                                                                        |

⚠️ **The shared cache is safe only because the response no longer varies by session.** The comment it replaced was right on its own terms — a shared cache in front of an authenticated response lets the CDN store one signed-in caller's payload and hand it to the next anonymous one, a gate that leaks being worse than no gate. That hazard is gone _with_ the gate, not in spite of it. **If any per-caller field is ever added to these responses, the cache must come off in the same commit** — the tests are ordered so the "reads no session" assertion fails first. A `429` and a `500` are `private, no-store`: a shared 429 would hand one abuser's rejection to every reader behind the same CDN node, and a cached 500 would outlive the outage that caused it.

⚠️ **No licence is asserted yet.** Published open data should carry one — CC BY 4.0 is the usual choice for aggregate datasets like this — and choosing it is an owner decision, so the export says nothing about reuse terms rather than inventing permissive ones on publishers' behalf. Worth closing.

**The test gap that let this happen for ten days is closed too.** `access.test.ts` asserted "no gate for `insights`" throughout the entire gated period and passed, because it only read `access.ts` — and the gate was never there. It was a direct `isViewerSignedIn()` in the page plus `requireViewer()` in the actions. **A test that reads only the access map cannot see a gate written any other way**, and it certified as open a surface that was closed. It now also asserts, against the four open-data surfaces themselves (page, client, actions, export route), that none of them reads a session by ANY mechanism — `isViewerSignedIn`, `requireViewer`, `withAuth`, `useAuth`, `planFor` or `canAccess` — with comments stripped first, since those files explain the withdrawn gate at length. Verified non-vacuous: all three pre-reversal files fail it.

`access.test.ts` asserts no gate exists for any of the public surfaces, so adding one is a deliberate act with a failing test in front of it.

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

## We are the vehicle, not the publisher (owner decision 2026-09-14)

> _"We are an aggregator we do not publish news. We are not a publishing house. We provide the vehicle, but we don't publish news. Everything that we have, we don't own."_

This is the position the legal pages, the first-run screen and the image credits all say in the same words, and `AGGREGATOR_STATEMENT` in **`src/lib/legal.ts`** is the one place it is written down. Stating it differently in different places is how a platform ends up having claimed, somewhere, to be the publisher of somebody else's article.

**`/terms` and `/privacy` were rewritten in full**, both leading with a boxed statement rather than a preamble. Terms is thirteen sections built out from the position: what the service does, that we own none of the content (with an explicit **Images in particular** clause at `#images`), what we DO own, that the AI outputs are ours and machine-written, that accuracy is the publisher's, a named removal route (`legal@mukoko.com`, `#removal`), conduct, API terms, availability, liability. Privacy opens with what we do **not** do, because that is the shorter and more checkable list — and because the old copy claimed _"we may also use third-party analytics services"_ when the dependency tree carries **no analytics package at all**. ⚠️ **Neither page asserts a governing law**: the jurisdiction is an owner decision and inventing one is worse than the gap. Both want a lawyer's read before they are relied on.

**Acceptance stores a VERSION, not a boolean.** `LEGAL_VERSION` is the revision date; `hasAcceptedCurrentTerms()` compares it against `localStorage['mukoko-news-terms-accepted']`. A boolean records that somebody once accepted _something_ without recording what, which makes every future material change unannounceable — every existing reader stays silently on a record of consent to text that no longer exists. Bump the version only for a material change: a typo fix that re-prompts the whole audience trains them to dismiss the screen unread, which is worse than not showing it.

### The welcome gate is a CLIENT OVERLAY, and that is the whole design

`components/legal/welcome-gate.tsx` over `contexts/legal-context.tsx`, mounted last in `layout.tsx`. The page underneath is rendered, cached and delivered exactly as before — `/terms`, `/privacy`, `/insights`, `/discover` and every article are still `○` in the build manifest — and the gate is added on top in the browser after an effect has read storage.

That ordering is the requirement, not a shortcut. `robots.txt` here deliberately courts search engines and answer engines, and **for an aggregator that indexed traffic IS the asset**; a gate rendered server-side would serve every crawler a consent dialog in place of the article and quietly delete the product from search. It also means a reader on a slow connection sees the news first and the dialog a moment later, rather than a blank page holding a modal.

Four rules hold it honest:

- **It never covers `/terms` or `/privacy`.** It asks a reader to accept two documents; covering the documents would have them agreeing to text they were physically prevented from reading. `/embed*` (our markup in somebody else's page) and `/offline` are exempt too.
- **No Escape, no backdrop dismiss, and one button.** Escape closes a dialog you may dismiss; wiring it would hand every reader a one-key bypass and make the whole screen a suggestion. There is no "Decline" because declining means not using the service, and a Decline that navigates someone off a news site they chose to open is theatre — the Terms say it in words instead.
- **Storage failing must not trap anyone.** `accept()` sets state first and writes second, so a private window or blocked site data still lets the reader through; they are simply asked again next visit.
- **The preferences onboarding modal stands down while it is up** (and while the answer is still unresolved, so it does not flash for a frame). Two modals stacked on a first visit is the failure the shared context exists to prevent — two components each reading storage could not do it, because accepting in one would not tell the other until a reload.

### Image credits name who SUPPLIED the picture, never who took it

`components/ui/image-credit.tsx`, rendered at every surface that shows a publisher photograph at size: the article hero (a `<figcaption>` linking `/terms#images`), the hero card, the feed card, both story-cluster heroes, NewsBytes and the embed hero + card.

**Measured on the live cluster 2026-09-14**, over the 20,000 most recent articles: every one stores its image as the schema.org array shape and the sub-document has exactly **two** keys, `@type` and `url`. A scan for `imageCredit` / `imageCaption` / `mediaCredit` / `copyrightHolder` across the same window returns **zero**. Neither collector writes one and the enrichment write surface does not include one. So the platform does not know who took the picture — it knows one thing exactly, that **the publisher handed us this image with this article**, and that is all the credit says. Hence `Image via <Publisher>` and never `Photo: <Publisher>`: the second asserts authorship, which for a wire picture is simply false, and a false credit printed under somebody's copyrighted work is worse than none.

**The image host was measured and rejected as a credit.** 5,005 of 12,267 recent articles serve the image from a different host than the article (41%), and the top of that list is `i0.wp.com`, `blogger.googleusercontent.com`, `cdn.punchng.com`, `assets.citizen.digital`, `s.france24.com` — the publisher's own CDN subdomain or a generic proxy. Printing it would credit Automattic and Google for African newsrooms' photography. It is infrastructure, not provenance.

With neither a masthead nor a feed name the component renders **nothing**: `via Unknown` over a real photographer's work is the invented verdict the rest of this codebase refuses everywhere else.

**The promise is machine-checked.** `/terms` now tells publishers that images "are displayed with a credit identifying where they came from", and that is kept by seven separate call sites — exactly the shape that drifts. `components/__tests__/image-credit.test.tsx` holds an **inventory**: every file in the tree that calls `imageProxyUrl`/`mukokoImageLoader` must appear in it marked `credited`, `thumbnail` or `not-a-photograph`, and a new image surface fails the suite until someone adds it with a decision — the same pattern `navigation.test.ts` uses for routes, with no silent exemption. A threshold on the fetched image width was tried first and rejected: `{width: 600}` is the DPR-oversampled fetch, not the rendered size, so the embed's 80px list thumbnail and its 280px hero both ask for 600 and the number cannot tell them apart. `thumbnail` is a recorded decision, not a skip — below roughly 128px a credit chip is unreadable or wider than the picture, and in every one of those cases the surface's own source badge sits immediately beside the image. The card path is additionally covered **end to end** in `article-card.test.tsx`, because the credit reaches a card through the brand component's `imageCredit` slot and a source-text check would keep passing if that slot stopped rendering.

## Design System (Mukoko "Swarm" — doctrine v4.1.0)

**Mark**: the **Seed of Life** — one centre cell ringed by six, the first ring of the honeycomb, rendered in the 7 minerals with **tanzanite at the core**. **The full-palette mark is the only icon, at every size.** Bare mark on a transparent ground: `public/mukoko-mark-full-{light,dark}.svg` (used by `AppIcon`). Mark on the deep-tanzanite (`#1A0033`) rounded ground: `public/mukoko-appicon.png` — the app icon, and the source the favicons are downscaled from, so the browser tab, the installed app and every other surface carry identical artwork. (Owner correction 2026-09-01 — this **supersedes** the earlier "mono-tanzanite favicon below 32px" rule. The mono variant made the tab icon a solid purple blob that looked like a different product; `favicon.svg`, `favicon-{16,32,48}.png`, `favicon-180.png`, `apple-touch-icon.png` and `favicon.ico` are now the full-palette mark, and `mukoko-appicon-mono-tanzanite.png` was deleted so it cannot be wired up again. `favicon.svg` carries its own ground, so one file serves both browser themes and there is no `favicon-dark.svg`.) Never add gradients/shadows, recolour petals, reorder the ring, or substitute a mono/single-colour reduction.

**The minerals stripe** (`.minerals-stripe` / `.minerals-stripe-horizontal`, mounted once in `layout.tsx`) is the band down the page's left edge. It is **theme-aware**, and it was not (owner report 2026-09-11 — _"the mineral strip is not theme aware"_): every stop was a hard-coded **light** mineral hex (`#0047AB`, `#4B0082`, `#004D40`, `#5D4037`, `#A0522D`), so in dark mode the one piece of chrome whose whole job is to carry the brand rendered as deep, muddy bands against a near-black page — at exactly the moment the palette has light steps that would sing there. It was also **five** minerals, not seven: sodalite and copper were missing from the one surface that claims to show the whole palette. Both orientations now read **one shared `--stripe-stops` list** built from `var(--color-<mineral>)` at `100/7` per band, because two copies had already drifted and a mineral added to one and not the other is a stripe that disagrees with itself depending on which way round it is drawn.

**It runs down the PAGE's left border at 3px**, and getting there took two corrections whose lesson is the same one. The first complaint was _"it needs to be on the page border not the site border; right now it's left of the sidebar"_ — answered by moving it to the right edge at 8px, which **dodged** the sidebar rather than answering the objection, and was reversed an hour later (_"3px should be on the left not right hand side"_). The side was never the point: the stripe was running down the SHELL's edge, so docked it sat outside the panel with the page it belongs to two columns away. It now rides **inside `.app-shell`** and is offset by `--sidebar-width` when the sidebar docks, through the same `data-sidebar` rule the shell inset and the island use — so it tracks the page's edge at every width. Below `lg` the shell translates and the stripe is carried with it, because a `position: fixed` child of a transformed ancestor is contained by that ancestor; that containment is also what keeps it off the overlay panel, which at `z-index: 100` against the panel's 60 it would otherwise paint straight across. `--color-*` rather than the bare aliases is deliberate: `--tanzanite` / `--cobalt` / `--gold` exist, the other four do not, and reaching for an undefined `var(--malachite)` is precisely what silently killed two chart marks (see **Chart marks**). `design-tokens.test.ts` asserts the rule carries no literal colour and names all seven minerals.

**Palette** — 7 **African Minerals**, each with light/dark + container/on-container values (full set in `src/app/globals.css`, theme-aware via the `.light`/`.dark` classes). **The source of truth is the Mzizi MCP** (`mzizi_get_tokens` — 21 colour families: 7 minerals, 7 heritage, 7 experimental), not a file in this repo. Verified 2026-09-05: all 7 minerals and all 14 container values here match Mzizi exactly. (An earlier version of this line claimed a brand kit at `tokens/minerals.json`; **no such file has ever existed** in this repo — query the MCP instead.)

| mineral    | light     | dark      | role                     |
| ---------- | --------- | --------- | ------------------------ |
| cobalt     | `#0047AB` | `#00B0FF` | secondary / links / CTAs |
| tanzanite  | `#4B0082` | `#B388FF` | **primary / brand**      |
| malachite  | `#004D40` | `#64FFDA` | success                  |
| gold       | `#5D4037` | `#FFD740` | accent / rewards         |
| terracotta | `#A0522D` | `#E1B07E` | warning / community      |
| sodalite   | `#283593` | `#3D5AFE` | AI / Shamwari surfaces   |
| copper     | `#BF5A36` | `#FF8A65` | commons                  |

`--primary`=tanzanite, `--secondary`=cobalt, `--success`=malachite. Use light hex on light surfaces, dark hex on dark.

**Two semantic tokens are deliberately NOT minerals** (corrected 2026-09-10, measured against `mzizi_get_tokens`):

- **`--accent` is the pale cobalt container** (`#E3F2FD` / `#001F3F`), a hover/selected fill — not a brand colour. The saturated, swappable brand mineral is a separate token, **`--brand-accent`** (tanzanite). This app had collapsed the two into one and assigned gold, which is neither, and that is why hover states and CTAs competed. Its live consumers are the button `outline`/`ghost` hover states.
- **`--warning` is Mzizi's semantic warning** (`#7A5C00` / `#FFD866`), not terracotta. Terracotta is a mineral that already means _community and warmth_, so warnings and community surfaces were indistinguishable. Measured as text on the card: terracotta 4.83:1 light / 10.4:1 dark; Mzizi 5.38 / 13.6 — better in both. ⚠️ The light value still does **not** clear Mzizi's own APCA floor; reported upstream rather than patched with a Mukoko-only variant.
- **`--ring` is cobalt**, deliberately not the brand hue, so a focus ring is never read as a brand fill on a primary button.

**Surfaces** — the Mzizi background scale (`mzizi_get_tokens: backgrounds`), and **every role takes the step that carries its name**: `--surface` is Mzizi `surface`, `--elevated` is `container`, `--popover` is `overlay`, and so on. Mzizi is the source of truth for the scale AND for which step a role uses; this app does not re-point one on its own reading (owner decision 2026-09-10 — see the note below).

| token                  | light              | dark                | Mzizi name                                                   |
| ---------------------- | ------------------ | ------------------- | ------------------------------------------------------------ |
| `--void`               | `#F8F8F7`          | `#080807`           | `void` — app shell behind base                               |
| `--background`         | `#F3F3F1`          | `#0E0D0C`           | `base` — matte page                                          |
| `--surface` / `--card` | `#EEEEEC`          | `#131211`           | `surface` — the card                                         |
| `--muted`              | `#FAF9F5`          | `#050504`           | `muted` — deepest fill, inset/metadata rows                  |
| `--elevated`           | `#E5E4E1`          | `#1E1D1A`           | `container` — hover rows                                     |
| `--popover`            | `#E0DFDC`          | `#23221F`           | `overlay` — menus, dialogs                                   |
| `--raised`             | `#D6D5D1`          | `#2E2C29`           | `raised` — above overlay: menus, toasts, **floating chrome** |
| `--pitch`              | `#FAFAFA`          | `#050505`           | `pitch` — media wells, splash                                |
| `--scrim`              | `rgba(0,0,0,.40)`  | `rgba(0,0,0,.60)`   | backdrop behind overlays                                     |
| `--wash`               | surface + 7% brand | surface + 12% brand | cover-colour page tint                                       |
| `--border`             | `#E7E5E0`          | `#2A2927`           | `border` — warm stone, not cool grey                         |

> **Matte black is the BACKGROUND, not an elevated surface colour** (owner report 2026-09-11). Three pieces of floating chrome painted themselves `bg-background/NN` — the bottom island, the sticky header once scrolled, and the home feed's sticky filter bar — that is, a translucent wash of the very surface they float over. On a near-black dark page that leaves an element with no fill of its own, whose only definition is its border, which is exactly why the island read as a wireframe pill rather than as something lifted off the page. All three now take **`--raised`** (Mzizi `raised` — _"raised elements above overlay — menus, toasts"_; a floating pill is a toast in every way that matters), keeping their translucency and blur. `appearance.test.ts` walks every `className` value in the tree and fails on a `fixed`/`sticky` element filled with `--background`. **One element is exempt by owner decision (2026-09-14): the home feed's category strip, which that same 2026-09-11 report had put on `--raised` alongside the other two.** The island and the scrolled header float _over_ the page and need a fill that lifts them off it; the strip does not float over anything — it sticks flush beneath the header as the bottom of the page's own header stack, and the chips inside it carry their own `--surface` fill. A lighter fill made it read as a third band of chrome between the header and the article list; on the page colour the header and the strip read as one continuous surface and only the chips stand out, which is the point of the row. It is **opaque**, not `/80` — a translucent wash is tinted by the feed scrolling underneath, so it would match the page background only while the page was at the top — and `backdrop-blur-xl` went with it, since behind an opaque fill it blurs nothing and still costs a compositing layer. The carve-out is keyed on the **exact class list**, not the file: a file exemption would let a future sticky element in `home-client.tsx` inherit it silently (the same trap the outline check avoids by having none at all), and pinning the whole string means any edit to that bar has to come back and re-justify itself. Two further tests hold it honest — one fails if the sanctioned class list no longer exists in the file, so a dead carve-out cannot sit there looking live; the other asserts a variant of the same bar is still caught. The check reads the element's **own** class list, so a `bg-background/10` tint on a button _inside_ sticky chrome is not caught — that is a wash over another fill, not a missing one — and `inset-0` is exempt on principle rather than as a file carve-out: an element pinned to all four edges **is** the page ground.
>
> **Owner decision 2026-09-10 (third and final on this token) — Mzizi is the source of truth.** Dark `--surface`/`--card` is Mzizi **`surface`** (`#131211`). It had been re-pointed at Mzizi **`void`** (`#080807`) earlier the same day to keep the card a step _darker_ than the matte page — a reading of the scale this app invented and Mzizi does not make. A role now takes the step that carries its name, full stop, and `design-tokens.test.ts` asserts exactly that (`--surface`→`surface`, `--elevated`→`container`, `--popover`→`overlay`, …) in all three theme blocks. That replaces the weaker "is _a_ real step in the scale" check, which only existed to accommodate the re-point: with no role diverging, a mismatch is a bug rather than a decision, and the test names which step the value should have come from. The one invariant that survives every revision of this token is the failure that started it — `--surface` must never equal `--muted` (`#050504`), or a card and the inset row inside it are one colour and the metadata well has no edge. That is still asserted separately.
>
> **Components separate by FILL, not by a drawn edge** (owner decision 2026-09-10). Every card, panel and chip carried `border border-border`, so the product looked like a high-contrast theme nobody chose — and with everything boxed, nothing read as emphasised. There is now one token: **`--outline`, transparent by default**, and every boxed component draws `border border-outline`. **Switched on it takes `--raised`, not `--border`** (corrected 2026-09-11 — owner report: _"the contrast component doesn't work, I see no visual changes"_). `--border` is `#2A2927` in dark and `#E7E5E0` in light against a card of `#131211` / `#EEEEEC` — a step of roughly 2% in lightness, real in a colour picker and invisible on a phone, so the control did exactly what it claimed and the reader could not tell, which is indistinguishable from a control that does nothing. `--raised` (`#2E2C29` / `#D6D5D1`) is the next step the scale actually provides, plainly visible in both themes and still on palette; `--border` keeps its own job, separators, where the line divides two things already adjacent and needs to be quiet. The border stays in the box model, so switching it on shifts no layout. `--border` keeps its colour and stays visible for **separators** (`border-b`, `border-t`, `divide-y`, the byline rule) — a line meaning "these two things are different" is a different job from a line meaning "here is an edge", which is why they are now different tokens. **Contrast is one setting with three values — `off` | `on` | `system` — RESOLVED IN JS and stamped as one attribute** (owner direction 2026-09-11, superseding both earlier arrangements). `src/lib/appearance.ts` combines the reader's choice with `matchMedia('(prefers-contrast: more)')` and writes `data-contrast="more"` on `<html>` (or removes it), exactly as the theme resolves `system` to a `light`/`dark` class; the stylesheet then has **one rule**, `:root[data-contrast='more']`, and **no `@media (prefers-contrast: more)` block at all**. `design-tokens.test.ts` asserts that absence structurally.

That is the fix, not an omission. As a media query it could not be switched off from the site — _a preference that is not in the cascade cannot override a query that is_. It first shipped unconditional, so a reader with the OS _Increase Contrast_ switch on got the treatment whatever the control said: measured on the owner's phone, every card, panel, chip and the nav pill outlined while the Appearance card read **"Off"** — _"the contrast is still appearing in dark mode even though it's off"_. A first correction made the query a third **choice**, but only for the edge tokens; the text lift stayed unconditional, so `off` still was not off — _"like the theme it needs to disable it on the site or have it on"_. The whole treatment (outlines, `--border`/`--control`, and the two dim text roles) is now behind the one control, and `off` means off on any device.

The default is **`off`**, not `system`: a reader who has never opened the control has not asked for the treatment, and inheriting it from an OS switch set for unrelated reasons is the complaint this answers; `system` is one tap away. The rule names `[data-contrast='more']` **positively** and nothing keys off the attribute's absence, so a reader whose bootstrap never ran (JS off, blocked storage, a throw) gets the standard palette rather than a treatment they cannot switch off. `system` follows the device **live** via a `matchMedia` listener in `ThemeProvider`, so toggling the OS switch takes effect without a reload. (The treatment raises contrast **inside** the Mzizi scale and keeps every surface step. An earlier version replaced them all with `Canvas` — see the corrected note under **Deferring to the system**.) A **control's** edge is a different job again and gets its own token, **`--control`** (always visible, aliased to `--border` so it follows into the high-contrast block): an `<input>` or `<select>` painted with the transparent `--outline` would be an undiscoverable field, and a button's `outline` variant IS its edge. There are deliberately **no file-level exemptions** in the check — exempting a file would let a future card in that same file slip through, which is how the borders got everywhere in the first place. `src/lib/__tests__/appearance.test.ts` structurally forbids a box outline drawn on `--border`/`--elevated` anywhere else. ⚠️ This **diverges from the Mzizi card spec**, which specifies "a full 1px border" (`mzizi_get_tokens: componentSpecs`) — reported upstream rather than silently forked.

> **Corrected 2026-09-10 (first).** `--surface`/`--card` carried `#050504` in dark — that is Mzizi's **`muted`**, the _deepest_ fill, not `surface`. Because `--muted` is also `#050504`, a card and the inset row inside it were the same colour and the metadata well had no edge. Five further steps (`void`, `pitch`, `raised`, `scrim`, `wash`) were never defined, which is why menus reused the hover-row colour and the share modal hand-rolled its own backdrop. `src/app/__tests__/design-tokens.test.ts` now parses `globals.css` and asserts every value against a checked-in Mzizi snapshot — including the bare `:root` block, which carries the DARK DEFAULTS and was the block an earlier revision of that test failed to read.

**Text is set by APCA, not WCAG 2** — Mzizi's floor is **APCA 3.0 AAA**. WCAG 2 ratios systematically overstate light-text-on-dark, which is how `--text-tertiary` came to be documented as "7.0:1" while measuring **APCA Lc 38.7** on the card — barely half what a 12px string needs, and it was used for every hint line, card heading and chip. Current values, measured on the _worst_ surface each lands on, all clearing both the APCA target and the AAA 7:1 floor:

| token              | light               | dark                 |
| ------------------ | ------------------- | -------------------- |
| `--foreground`     | `#000000` (Lc 95.9) | `#FFFFFF` (Lc 107.9) |
| `--text-secondary` | `#2E2B27` (Lc 89.0) | `#E8E8E4` (Lc 92.7)  |
| `--text-tertiary`  | `#474139` (Lc 83.2) | `#D4D4CF` (Lc 80.3)  |

**Deferring to the system — but only where the system asked to take over** (corrected 2026-09-10). `color-scheme` is declared per theme so native controls, scrollbars and the first-paint canvas match. The two contrast queries are then **not** treated alike:

- **The contrast treatment raises contrast INSIDE the Mzizi scale**, and it is **not a media query** — it is `:root[data-contrast='more']`, resolved in JS from the reader's `off`/`on`/`system` choice (see the contrast note above). Every surface keeps its step; outlines switch on, and `--border`/`--control` and the two dim text roles take the value `--text-tertiary` normally holds (`#474139` / `#D4D4CF`), a measured, on-palette edge. ⚠️ This **supersedes** the earlier rule that handed every reading surface to `Canvas`/`CanvasText`. Measured on a phone with the OS "Increase Contrast" switch on, that rule collapsed all **eight** background steps into one flat system colour and outlined every card, chip and the nav pill in stark white on black: the card stopped reading as a card, because the fill separating it from the page was gone and the border was the only structure left. `prefers-contrast: more` means _make differences easier to see_, not _throw away the palette_ — the Mzizi scale is not low contrast, it is eight deliberately distinct steps, and it is the thing carrying the structure.
- **`@media (forced-colors: active)` is where the palette IS handed over**, because the OS has already replaced it; focus rings are redrawn in `Highlight`, the one colour that survives.

`design-tokens.test.ts` asserts both halves: that no surface token is set to `Canvas` under `prefers-contrast: more`, and that `forced-colors` still does hand over. System colours are deliberately **not** the default: that would drop the Mzizi scale and the mineral identity on every machine, which is a brand decision rather than an accessibility one.

**Contrast is part of the THEME** (owner direction 2026-09-11 — _"the contrast switcher is part of the theme"_). `ThemeProvider` (`components/theme-provider.tsx`) owns it: `useTheme()` returns `{ theme, resolvedTheme, setTheme, cycleTheme, contrast, resolvedContrast, setContrast }` — `contrast` is the reader's `off`/`on`/`system` choice and `resolvedContrast` is what the document is actually rendering — and the provider is the only runtime writer of the storage key and the `data-contrast` attribute. It used to be a separate preference that the one card rendering it read, stored and applied itself, so nothing else in the app could ask what it was set to or react to it. `src/lib/appearance.ts` stays as the pure parse/store/apply module, because the pre-paint bootstrap in `layout.tsx` repeats its key and attribute as string literals and cannot import anything — a test asserts the two still agree.

**Appearance is picked by looking** (`components/profile/profile-appearance.tsx`). Theme _and_ outlines are one card on `/profile`, **three options each**, and every option renders a **miniature of the app** in that setting — a header bar, a card holding two text lines, and the page behind both. The contrast row's **System** draws both halves of the same theme, plain beside treated (`AppearancePreview`'s `outlined="split"`, one axis over from the theme row's light/dark split), because it depends on the device; the theme previews draw the **resolved** value, so they show what the reader is actually getting rather than a guess. Before this, outlines were a lone switch with a paragraph explaining it and the theme was a **cycle button** elsewhere on the page showing only its current value, so a reader tapped three times to discover the options and never saw two side by side. Both are purely visual settings; the honest control is the thing itself. `appearance-preview.tsx` is the **one place a literal hex is correct** — it must draw a theme the document is _not_ in, and a `bg-surface` would paint all three options in the active theme — so its values are asserted against `globals.css` by test rather than trusted.

**Typography**: **Noto Serif** (display/headings, wordmark = lowercase weight 600 — always "mukoko", never capitalised), **Noto Sans** (UI/body), **JetBrains Mono** (code/data/labels) — self-hosted via `next/font/google` in `layout.tsx`, with the CSS variables wired to the `--font-sans/serif/mono` theme tokens in `globals.css`.

**Spacing**: 12px border-radius buttons, 16px cards. WCAG AAA compliant (7:1 contrast).

**One page column, and one vertical rhythm** (`components/layout/page-container.tsx`). The three widths (`--width-wide` / `--width-reading` / `--width-form`) and the two gutters (`--page-gutter*`) were already tokens, and by 2026-09-11 every page column was reading them — but the **space above and below** was not, and 26 call sites had picked `py-6`, `py-8`, `py-12` and `py-16` independently. Owner report: _"not all pages follow the same width layout, each page seems to run its own, no global option."_ The widths had in fact converged; what a reader saw moving between pages was the space above the first line. There are now two more tokens — **`--page-block`** (2rem, index and chrome columns) and **`--page-block-reading`** (3rem, one column of running text, which wants more air) — chosen by what the column _holds_ rather than per page, so there is one decision per kind of column instead of one per page. `PageContainer` applies them from `width` and takes `pad={false}` for chrome that owns its own padding. `page-container.test.tsx` walks the tree and fails on any `max-w-[var(--width-…)]` column carrying a literal `py-N`.

**Density (Mzizi 4.x)**: `globals.css` defines the prime-scale touch targets (`--touch-*`: 47px primary CTAs, 43px inputs, 37px dense toolbars, 31px chips, 56px hero-only) and icon sizes (`--icon-*`). `comfortable` is the default density; data-dense surfaces (`/admin`, `/dashboard`) opt into `compact` with `data-density="compact"` on a wrapper — the scope overrides `--density-touch` and the card/input radii, which cascade with no per-component changes. Button sizes ride these tokens (`min-h-[var(--density-touch)]`). New interactive elements should use the touch-target minimums, not fixed heights.

**Chart marks** (`--chart-*`) reference minerals, never literals: primary→tanzanite, positive→malachite, neutral→`--neutral`, negative→**copper** (not `error` — a negative _sentiment_ is not an error _state_), mixed→gold, grid→`--border`. All twelve values were previously raw Tailwind palette (`violet-500`, `teal-600`, `gray-400`, `rose-600`…) sitting in `:root` where they looked official; `--chart-negative` was orange-700 in light and rose-600 in dark, so a negative series changed hue with the theme. A test asserts none is a literal. ⚠️ **Two of them then pointed at nothing** (found 2026-09-11): `--chart-positive: var(--malachite)` and `--chart-negative: var(--copper)` shipped in all three theme blocks, and neither `--malachite` nor `--copper` has ever been defined — the mineral values live on `--color-malachite` / `--color-copper`, the shape Tailwind's `@theme inline` consumes. A `var()` with no fallback pointing at an undefined property is **invalid at computed-value time**: the declaration is discarded and so is every declaration reading it, silently. So the positive and negative sentiment marks had no colour at all, in every theme, while the stylesheet read as though they were carefully assigned — and the "no literal" test passed happily, because a dangling `var()` is not a literal. Every chart mark now reads `--color-*`, and `design-tokens.test.ts` fails on **any** dangling `var()` reference anywhere in the stylesheet (comments stripped first, since the prose above quotes the broken form).

CSS variables in `src/app/globals.css`. Use Tailwind classes: `bg-primary`, `text-foreground`, `bg-surface`, and the mineral utilities `bg-tanzanite`, `text-cobalt`, `bg-container-sodalite`, etc. (`components.json` configures the shadcn-style component generator; the theme lives entirely in `globals.css` via `@theme inline` — there is no `tailwind.config.ts`.)

## Code Conventions

Prettier config is **`.prettierrc`**, copied from `nyuchi/.github` with the org-wide lint gate: `printWidth: 80`, `tabWidth: 2`, `trailingComma: "all"`, `endOfLine: "lf"`, `proseWrap: "preserve"`, and prettier's own defaults for everything else — so **double quotes and semicolons**. (Corrected 2026-09-14: this line used to name a `.prettierrc.json` with single quotes and a 100 print width. No such file has ever existed here, and `prettier --check 'src/**/*.{ts,tsx}'` reports **294** files that do not match the real config — src has never been formatted to it and the org gate does not cover it. Format NEW files with `npx prettier --write`; do not reformat an existing one in passing, since that buries a real change under a whole-file diff.)

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

**Security response headers**: `src/lib/security-headers.ts` is the single source; `next.config.ts` `headers()` just returns `buildSecurityHeaders()`. Two rules partition the site — a catch-all (`/((?!embed(?:/|$)).*)`) and `/embed/:path*` — and they must never overlap, because a route matched by both would get `X-Frame-Options: DENY` **and** `frame-ancestors *`, and XFO wins in every browser: the embed product would die silently while the config read as if it allowed framing. `src/lib/__tests__/security-headers.test.ts` compiles both `source` strings with **Next's own** `path-to-regexp` and asserts the partition. **CSP ships in two pieces**: a tiny _enforcing_ policy (`base-uri`/`object-src`/`form-action`/`frame-ancestors` — no `default-src`, so it cannot blank a page over a resource we failed to enumerate) plus the full policy as `Content-Security-Policy-Report-Only`, reported to `src/app/api/csp-report/route.ts`. Scripts use `'unsafe-inline'`, **not** a nonce: a nonce is baked into the rendered HTML, and nearly every route here is prerendered or ISR-cached, so a cached page would carry a stale nonce and block Next's own runtime. HSTS is **not** set here — Vercel already sends `max-age=63072000`; and `upgrade-insecure-requests` is omitted because 303 articles carry an `http://` `externalUrl` and it would break those outbound links. **`connect-src` names `weather.mukoko.com`** (`ALLOWED_WEATHER_HOST`): the header strip fetches the sibling weather app from the READER'S browser by design, and the host was missing — production report-only logged _"would block the loading of a resource (connect-src) at `https://weather.mukoko.com/api/embed/current`"_. Nothing broke, because the full policy only reports; but the policy was making a false statement about this app's own architecture, and promoting it to enforcing would have killed the strip **silently**, since the weather read is fail-soft and renders nothing on failure. The host is a second literal rather than an import from `@/lib/weather`, for the same reason `ALLOWED_IMAGE_HOST` is not imported from `@/lib/image` — this module is pulled into `next.config.ts` and evaluated by bare Node — and `security-headers.test.ts` asserts the two name the same host. ⚠️ **Vercel Live's feedback widget (`vercel.live`) is also reported** — scripts, fonts and its iframe. It is not in the policy on purpose: widening `script-src`/`frame-src`/`font-src` to a third-party host for a preview tool is a real weakening, and the right fix is to turn the Vercel Toolbar off for production, which is an owner action in the Vercel project settings.

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

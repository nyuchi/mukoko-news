# agents.md — mukoko-news

**Canonical rule set for running tasks in this repo.** Any agent (Claude Code or otherwise) working here must follow this document. `CLAUDE.md` is the Claude-Code entry point and carries the full architecture detail; this file is the task rules + boundaries, `review.md` is the merge gate, and `auth.md` is the trust model.

## What this repo is

The **Next.js 15 frontend only** for Mukoko News, deployed to Vercel. It reads MongoDB Atlas directly via Server Actions and renders the public news experience plus an RBAC-gated admin app. The Cloudflare Workers API/MCP (`mukoko-news-gateway`) and the data pipeline (`mukoko-news-pipeline`) are separate repos.

## 🛑 Rule 1 — Data-flow boundaries (single source of truth)

The platform runs one MongoDB Atlas cluster with many **domain-separated databases**, each the single source of truth for its domain. From the frontend:

- **Reads** go through Server Actions (`src/lib/actions/feed.ts` → `src/lib/mongodb/*.ts`) to the **`news`** database. Never read through the gateway Worker.
- **Engagement writes** (like/view/save) go through Route Handlers under `src/app/api/articles/[id]/*` — rate-limited.
- **Admin mutations** are the **only** frontend→gateway calls (`src/lib/admin/gateway.ts`), forwarding the WorkOS token so the Worker re-verifies RBAC.
- **Never silo another domain's records** into an article or a new collection. Category/tag data the feed reads lives under the article's `engagement.{interest_categories,tags}` (a denormalised cache the pipeline writes); the frontend **reads** it — it does not invent new article sub-objects for places, entities, or other domains.

## Rule 2 — Keep both lockfiles in sync

The repo ships **both** `package-lock.json` and `pnpm-lock.yaml`. CI and the Husky hook use **npm**; the docs use pnpm. If you change dependencies, update **both** lockfiles or CI's `npm ci` will drift from local installs.

## Rule 3 — The pre-commit gate is real

Husky `.husky/pre-commit` runs `vitest related` on staged files → `typecheck` → `build`, and **all three must pass**. Don't bypass it. CI (`deploy.yml`) additionally runs the lint matrix + `test` → `typecheck` → `lint` → `build` on Node 20.

## Rule 4 — Test the way the app reads

Pages read via Server Actions, so in tests **mock `@/lib/actions/feed`** (NOT `@/lib/api`) and match the documented return shapes (see `CLAUDE.md` → Data Flow). ~460 tests across 21 files; coverage thresholds 60% statements/functions/lines, 50% branches.

## Rule 5 — Follow the security & component patterns

- Structured data only via `safeJsonLdStringify()` (`src/components/ui/json-ld.tsx`).
- Validate image URLs with `isValidImageUrl()` and CSS `url()` values with `safeCssUrl()` (`src/lib/utils.ts`) — never interpolate raw URLs into styles.
- Engagement Route Handlers use `checkRateLimit()` + `getRequestIp()` (`src/lib/rate-limit.ts`).
- Error boundaries + skeleton loaders on every data-fetching page; Radix primitives + Tailwind (no inline styles); stable unique list keys (never array indices).

## Rule 6 — Git workflow

- Feature branch; never push to `main` outside the designated task branch.
- Conventional commits; PRs open as **draft**.
- Merge to `main` auto-deploys to Vercel — keep `main` releasable.

## Running a task — checklist

1. Confirm the read path (Server Action → `news` DB) or write path (Route Handler / admin gateway) — Rule 1.
2. Make the change on a feature branch; follow the component + security patterns (Rule 5).
3. If deps changed, update **both** lockfiles (Rule 2).
4. Run `npm run test && npm run typecheck && npm run lint && npm run build` (the pre-commit + CI gate).
5. Commit (conventional), push, open a **draft** PR.

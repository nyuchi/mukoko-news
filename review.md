# review.md — mukoko-news

The merge gate and review checklist for the frontend. A change is mergeable only when every applicable box is satisfied. See `agents.md` for the rule set and `auth.md` for the trust model.

## Automated gate (must pass before merge)

```bash
npm run test        # vitest run (~460 tests)
npm run typecheck   # tsc --noEmit
npm run lint        # next lint (ESLint)
npm run build       # next build
```

The Husky pre-commit hook runs `vitest related` → `typecheck` → `build` on staged files; CI (`deploy.yml`) runs the lint matrix + `test` → `typecheck` → `lint` → `build` on Node 20. Never merge red. Merge to `main` auto-deploys to Vercel.

## Review checklist

### 1. Data-flow boundaries (see `agents.md` Rule 1)

- [ ] Reads go through Server Actions → `news` DB, not the gateway Worker.
- [ ] The only frontend→gateway calls are admin mutations via `src/lib/admin/gateway.ts` (WorkOS token forwarded).
- [ ] No new article sub-object siloing another domain's data; the feed only **reads** `engagement.*` category/tag fields the pipeline writes.

### 2. Auth & RBAC (see `auth.md`)

- [ ] `/admin` access is gated by the authoritative server-side check in `src/app/admin/layout.tsx` (`withAuth()` + `resolveTier`), not by middleware/cookie presence.
- [ ] RBAC grants are honored only inside the platform-team org (`WORKOS_PLATFORM_ORG_ID`); no unscoped role/permission check.
- [ ] No secret (`WORKOS_API_KEY`, `MONGODB_URI`, `FLY_TRIGGER_TOKEN`) reaches a client component or is logged.

### 3. Correctness & UX

- [ ] Data-fetching pages have an error boundary and a skeleton/loading state.
- [ ] Lists use stable unique keys (not array indices).
- [ ] No layout shift introduced (dynamic offsets measured, not hardcoded); images use `next/image` with sizing.
- [ ] Client/server boundary correct (`'use client'` only where needed; secrets stay server-side).

### 4. Security patterns (see `agents.md` Rule 5)

- [ ] JSON-LD via `safeJsonLdStringify()`; image URLs via `isValidImageUrl()`; CSS `url()` via `safeCssUrl()`.
- [ ] Engagement Route Handlers rate-limited (`checkRateLimit` + `getRequestIp`).
- [ ] No inline styles; Radix + Tailwind; no raw URL interpolation into markup or styles.

### 5. Tests & hygiene

- [ ] New/changed pages mock `@/lib/actions/feed` (not `@/lib/api`) and match the documented return shapes.
- [ ] Coverage stays above thresholds (60% statements/functions/lines, 50% branches).
- [ ] Dependency changes update **both** `package-lock.json` and `pnpm-lock.yaml`.
- [ ] Conventional-commit message; PR opened as **draft**.

## Reviewing an automated PR (claude[bot] / CI autofix)

- Verify each claimed finding against the actual code first.
- Confirm the fix doesn't move a read off the Server Action path, weaken the admin gate, or drop a security helper.
- Re-run `test` + `typecheck` + `lint` + `build` before merging.

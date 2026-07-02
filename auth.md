# auth.md — mukoko-news

The trust model for the frontend. Authentication is **WorkOS AuthKit**; authorization is the RBAC tiers in `src/lib/auth/roles.ts`. The authoritative gate is **server-side**, not middleware.

## Sign-in: WorkOS-hosted AuthKit page

Web users sign in via the **WorkOS-hosted AuthKit page** (`identity.nyuchi.com`): server code calls `getSignInUrl()` from `@workos-inc/authkit-nextjs` and `redirect()`s to it; users return through `/auth/callback` and land on the `returnTo` path.

> **Doctrine change (owner decision, 2026-07-02).** The frontend previously used an embedded inline Magic Auth form (`src/components/auth/inline-sign-in.tsx`, now deleted) and the rule was "never redirect to the hosted page". That is reversed: the hosted page is WorkOS-maintained UI (branding, new auth methods, security fixes land for free) and it removes the custom auth surface (the bespoke Magic Auth Server Actions) we had to own. The gateway MCP/API already used the hosted issuer — entry points are now consistent.

- `src/app/sign-in/page.tsx` — the sign-in entry point: validates `returnTo` (root-relative only), then redirects to `getSignInUrl({ returnTo })`. Signed-in users skip straight to `returnTo`.
- `src/app/layout.tsx` — wraps the app in `AuthKitProvider`.
- `src/app/auth/callback/route.ts` — WorkOS OAuth callback (`handleAuth()`).
- `src/lib/auth/actions.ts` — `signOutAction()` (AuthKit `signOut()`, clears the session cookie, returns on-site).
- `src/middleware.ts` — AuthKit **session-refresh only**. `middlewareAuth` is still **NOT** enabled — not because hosted redirects are forbidden anymore, but because nearly every route (home, articles, discover, search, embed, health, engagement APIs) must stay publicly readable; a middleware-wide gate would need an allowlist of the whole site to protect only `/admin`. The page-level gates do that job. The matcher excludes `_next/*`, `favicon.ico`, `embed`, `robots.txt`, `sitemap.xml`.

`WORKOS_REDIRECT_URI` (`https://news.mukoko.com/auth/callback`) must stay registered in the WorkOS dashboard — the hosted flow depends on it.

## The admin gate is the server component, not middleware

**`/admin` is NOT gated in middleware** — cookie presence is spoofable. The authoritative gate is `src/app/admin/layout.tsx`:

1. `withAuth()` (server-side) returns verified WorkOS claims.
2. `resolveTier({ organizationId, role, permissions })` computes the tier.
3. Unauthenticated → redirect to the hosted sign-in (`getSignInUrl({ returnTo: '/admin' })`). `!canAccessAdmin(tier)` → render "Access denied". Otherwise render the admin app.

Any new admin/privileged surface must perform its own server-side `withAuth()` + tier check. Never rely on the client or on middleware for authorization.

## RBAC tiers (`src/lib/auth/roles.ts`)

`resolveTier(claims)` → `'none' | 'moderator' | 'admin' | 'superadmin'`:

| Tier | Condition |
|---|---|
| `superadmin` | WorkOS role `admin` **within** the platform-team org |
| `admin` (staff) | any member of the platform-team org |
| `moderator` | within platform-team org, role `moderator`/`support` **or** the `mukoko:news-moderator` permission |
| `none` | everyone else |

`canAccessAdmin(tier)` allows moderator and above.

**Org scoping is mandatory.** All grants are honored **only inside the platform-team org** (`WORKOS_PLATFORM_ORG_ID`). WorkOS permission slugs are environment-wide, so an unscoped check would leak access across orgs. Never add a role/permission check that isn't gated by the platform org.

## Using auth in server components

```tsx
import { withAuth } from '@workos-inc/authkit-nextjs'
const { user } = await withAuth()
```

## Secrets & boundaries

- WorkOS env vars: `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_REDIRECT_URI`, `WORKOS_COOKIE_PASSWORD` (32+ chars), `WORKOS_PLATFORM_ORG_ID`.
- Other server secrets: `MONGODB_URI`, `FLY_TRIGGER_TOKEN`, `GATEWAY_API_URL`.
- **None of these may reach a client component or the browser bundle.** Keep `withAuth()`, Server Actions, and Route Handlers server-side; pass only non-sensitive, resolved data to client components.
- Admin mutations forward the user's WorkOS **access token** as a Bearer header to the gateway, which re-verifies the same RBAC — the frontend never trusts its own tier check alone for a mutation.

## Engagement & rate limiting

Engagement Route Handlers (`src/app/api/articles/[id]/{like,view,save}/route.ts`, `runtime = 'nodejs'`) are rate-limited via `checkRateLimit()` + `getRequestIp()` (`src/lib/rate-limit.ts`). The limiter is in-memory per Vercel instance, so limits are enforced per-instance rather than globally — a shared store is the durable upgrade. Keep new public write endpoints behind the same rate-limit guard.

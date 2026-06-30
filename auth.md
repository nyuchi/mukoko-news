# auth.md — mukoko-news

The trust model for the frontend. Authentication is **WorkOS AuthKit**; authorization is the RBAC tiers in `src/lib/auth/roles.ts`. The authoritative gate is **server-side**, not middleware.

## Sign-in: inline AuthKit (no hosted redirect)

Web users sign in via the **embedded inline AuthKit form** on `news.mukoko.com` (`src/components/auth/inline-sign-in.tsx`). They are **never** redirected to the hosted `identity.nyuchi.com` page.

> Contrast with the gateway: the `mukoko-news-gateway` MCP/API uses the **hosted** WorkOS issuer (`identity.nyuchi.com`) for OAuth. Same WorkOS environment, different entry points — don't "fix" the frontend to redirect to the hosted page.

- `src/app/layout.tsx` — wraps the app in `AuthKitProvider`.
- `src/app/auth/callback/route.ts` — WorkOS OAuth callback (`handleAuth()`).
- `src/middleware.ts` — AuthKit **session-refresh only**. `middlewareAuth` is intentionally **NOT** enabled (it would force a hosted redirect). The matcher excludes `_next/*`, `favicon.ico`, `embed`, `robots.txt`, `sitemap.xml`.

## The admin gate is the server component, not middleware

**`/admin` is NOT gated in middleware** — cookie presence is spoofable. The authoritative gate is `src/app/admin/layout.tsx`:

1. `withAuth()` (server-side) returns verified WorkOS claims.
2. `resolveTier({ organizationId, role, permissions })` computes the tier.
3. Unauthenticated → render inline sign-in. `!canAccessAdmin(tier)` → render "Access denied". Otherwise render the admin app.

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

Engagement Route Handlers (`src/app/api/articles/[id]/{like,view,save}/route.ts`, `runtime = 'nodejs'`) are rate-limited via `checkRateLimit()` + `getRequestIp()` (`src/lib/rate-limit.ts`). Keep new public write endpoints behind the same rate-limit guard.

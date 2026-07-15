# auth.md — mukoko-news

The trust model for the frontend. Authentication is **WorkOS AuthKit**; authorization is the RBAC tiers in `src/lib/auth/roles.ts`. The authoritative gate is **server-side**, not middleware.

## Sign-in: WorkOS-hosted AuthKit (`identity.nyuchi.com`)

Web users sign in via the **WorkOS-hosted AuthKit page**. Every sign-in entry point funnels through **`/sign-in`**, which validates `returnTo` and redirects to **`/auth/login`** — the Route Handler that calls `getSignInUrl({ returnTo })` and 307s to the hosted page; users return through `/auth/callback`. (`getSignInUrl()` writes the PKCE/state cookie, and Next.js only allows cookie writes in a Server Action or Route Handler — calling it during a page render **throws**. Never call it from a Server Component.) The hosted page owns the **entire** flow — Magic Auth (passwordless email code), passwords, passkeys, and crucially the **MFA step-up** (both enrolment and challenge), which the WorkOS environment has set to **Required**.

**Why hosted (owner correction 2026-07-09 — supersedes the 2026-07-02 inline-form doctrine):**

1. **MFA.** The environment enforces `MFA = Required`, so every sign-in hits the step-up. The inline (bring-your-own-UI) Magic Auth form hand-rolled the TOTP challenge/enrolment against `workos.multiFactorAuth`, and that custom step-up is what kept breaking sign-in. The hosted page handles MFA natively.
2. **Continuous sign-in across apps.** All Mukoko/Nyuchi apps (Mukoko News, Mukoko Weather, Nyuchi Console, …) are AuthKit applications in the **same WorkOS environment**, so the hosted page maintains **one shared session on the auth domain** — a user signed in on one app is silently re-authenticated when another app redirects to the hosted page. The inline flow authenticated via the User Management API and **never created that shared session**, which is why sign-in did not carry across apps.

> **Doctrine history.** PR #137 first moved sign-in to the hosted page; the owner correction of 2026-07-02 reversed that to an inline-form-primary doctrine; the owner correction of **2026-07-09** reverses it back — **the hosted AuthKit page is the primary and only sign-in surface** (the inline form and its Magic Auth/MFA Server Actions were removed). Off-site navigation during sign-in is accepted as the cost of working MFA and cross-app session continuity.

- `src/app/sign-in/page.tsx` — the single sign-in entry point: `dynamic = 'force-dynamic'`; validates `returnTo` (root-relative only); signed-in users skip straight to `returnTo`; otherwise redirects to `/auth/login?returnTo=…`. When a callback failure returns the user with `?error=…`, it renders a branded **error card with a manual "Try again" link** (→ `/auth/login`) instead of auto-redirecting — an automatic bounce would loop on a persistent failure.
- `src/app/auth/login/route.ts` — the **AuthKit initiate-login endpoint** (the WorkOS application's `initiateLoginUri` points at `https://news.mukoko.com/auth/login`) and the **only** `getSignInUrl()` call site (Route Handler — see the cookie constraint above): 307s into a fresh hosted sign-in; also used by IdP-initiated flows and hosted-page restarts. On failure it redirects to `/sign-in?error=login_unavailable` (the manual-retry card).
- `src/app/admin/layout.tsx` — the unauthenticated branch redirects to `/sign-in?returnTo=/admin`. The RBAC tier gate for authenticated users is unchanged.
- `src/app/dashboard/page.tsx` — signed-out redirects to `/sign-in?returnTo=/dashboard`.
- `src/app/profile/page.tsx` — the signed-out "Sign in or create account" button links to `/sign-in?returnTo=/profile`.
- `src/app/layout.tsx` — wraps the app in `AuthKitProvider`.
- `src/app/auth/callback/route.ts` — WorkOS OAuth callback. Built on `handleAuth({ returnPathname, onError })` and hardened: it short-circuits a WorkOS `error` param or a missing `code`, and any code-exchange failure redirects to `/sign-in?error=…` instead of throwing an HTTP 500. Required env: `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_REDIRECT_URI`, `WORKOS_COOKIE_PASSWORD`.
- `src/lib/auth/actions.ts` — `isSignedIn()` and `signOutAction()` (AuthKit `signOut()`, clears the session cookie, returns on-site). The former inline Magic Auth / MFA actions are gone.
- `src/middleware.ts` — AuthKit **session-refresh only**. `middlewareAuth` is **NOT** enabled — nearly every route (home, articles, discover, search, embed, health, engagement APIs) must stay publicly readable; a middleware-wide gate would need an allowlist of the whole site to protect only `/admin`. The page-level gates do that job. The matcher excludes `_next/*`, `favicon.ico`, `embed`, `robots.txt`, `sitemap.xml`.

`WORKOS_REDIRECT_URI` (`https://news.mukoko.com/auth/callback`) must stay registered in the WorkOS dashboard for the active `WORKOS_CLIENT_ID`, and the application's `initiateLoginUri` must stay `https://news.mukoko.com/auth/login` — the hosted flow depends on the client/redirect config being correct.

## The admin gate is the server component, not middleware

**`/admin` is NOT gated in middleware** — cookie presence is spoofable. The authoritative gate is `src/app/admin/layout.tsx`:

1. `withAuth()` (server-side) returns verified WorkOS claims.
2. `resolveTier({ organizationId, role, permissions })` computes the tier.
3. Unauthenticated → redirect to `/sign-in?returnTo=/admin` (the hosted AuthKit flow). `!canAccessAdmin(tier)` → render "Access denied". Otherwise render the admin app.

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

## Engagement identity

Likes/saves are keyed to an **engagement subject** (`src/lib/engagement.ts`): the signed-in WorkOS user (`user:<workos-user-id>`, resolved server-side via `withAuth()` — never trusted from the client) or the anonymous `mukoko_session` cookie. On the first signed-in interaction the cookie history is claimed for the user (user doc wins on overlap). `withAuth()` failures degrade to anonymous — auth must never break public engagement.

## Engagement & rate limiting

Engagement Route Handlers (`src/app/api/articles/[id]/{like,view,save}/route.ts`, `runtime = 'nodejs'`) are rate-limited via `checkRateLimit()` + `getRequestIp()` (`src/lib/rate-limit.ts`). The limiter is in-memory per Vercel instance, so limits are enforced per-instance rather than globally — a shared store is the durable upgrade. Keep new public write endpoints behind the same rate-limit guard.

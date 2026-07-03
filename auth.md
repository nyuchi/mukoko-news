# auth.md — mukoko-news

The trust model for the frontend. Authentication is **WorkOS AuthKit**; authorization is the RBAC tiers in `src/lib/auth/roles.ts`. The authoritative gate is **server-side**, not middleware.

## Sign-in: embedded (inline) AuthKit on news.mukoko.com

Web users sign in via the **embedded inline AuthKit form** on `news.mukoko.com` — they are **never** redirected off-site by default. The form (`src/components/auth/inline-sign-in.tsx`) drives WorkOS **Magic Auth** (passwordless email code) through Server Actions (`requestEmailCode` / `verifyEmailCode` in `src/lib/auth/actions.ts`), which call the WorkOS User Management API server-side and persist the session with `saveSession`. The user stays on the page the whole time.

**MFA step-up (on-site).** When an account has MFA enabled, a correct Magic Auth code returns a WorkOS `mfa_challenge` / `mfa_enrollment` step-up rather than a session. `verifyEmailCode` resolves it (`mfa_challenge` → challenge the enrolled TOTP factor via `workos.multiFactorAuth`; `mfa_enrollment` → enrol a fresh TOTP factor and return its QR) and hands the client an `MfaState` (short-lived `pendingToken` + `challengeId`). The form then shows a second authenticator-code step; `verifyMfaCode()` completes it with `authenticateWithTotp` + `saveSession` — still entirely on-site, no hosted redirect. Both the emailed code and the authenticator code use the same segmented 6-box OTP input.

The **WorkOS-hosted AuthKit page** (`identity.nyuchi.com` / `*.authkit.app`) is a **BACKUP/fallback only** — exposed as a subtle "Trouble signing in? Use our secure page" link under the form (`getSignInUrl()` still available for that link and for the `/auth/callback` return path). It is **not** the default path.

> **Doctrine correction (owner, 2026-07-02) — supersedes the earlier hosted-redirect decision.** A prior change (PR #137) switched sign-in to a hosted `getSignInUrl()` redirect and deleted the inline form. That reversed the owner's actual doctrine and is itself reversed here: **auth is hosted on our own site; users never leave news.mukoko.com; the inline form is primary and the hosted authkit page is an explicit fallback only.**

- `src/app/sign-in/page.tsx` — the sign-in entry point: `dynamic = 'force-dynamic'`; validates `returnTo` (root-relative only); renders a compact brand header (`AppIcon` + lowercase "mukoko" wordmark) above a surface card containing `<InlineSignIn>`. Signed-in users skip straight to `returnTo`. `withAuth()` and `getSignInUrl()` are wrapped in try/catch so a WorkOS misconfig shows the form (or hides only the fallback link) rather than a blank shell.
- `src/app/admin/layout.tsx` — the unauthenticated branch renders `<InlineSignIn redirectTo="/admin">` (with the hosted fallback link), not a hosted redirect. The RBAC tier gate for authenticated users is unchanged.
- `src/app/profile/page.tsx` — the "Sign In / Create Account" buttons toggle the inline `<InlineSignIn>` on-page (no navigation off-site).
- `src/app/layout.tsx` — wraps the app in `AuthKitProvider`.
- `src/app/auth/callback/route.ts` — WorkOS OAuth callback. Built on `handleAuth({ returnPathname, onError })` and hardened: it short-circuits a WorkOS `error` param or a missing `code`, and any code-exchange failure redirects to `/sign-in?error=…` instead of throwing an HTTP 500. Required env: `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_REDIRECT_URI`, `WORKOS_COOKIE_PASSWORD`.
- `src/lib/auth/actions.ts` — `requestEmailCode()` / `verifyEmailCode()` (inline Magic Auth, with MFA step-up detection) / `verifyMfaCode()` (TOTP second factor), `isSignedIn()`, and `signOutAction()` (AuthKit `signOut()`, clears the session cookie, returns on-site).
- `src/middleware.ts` — AuthKit **session-refresh only**. `middlewareAuth` is **NOT** enabled — nearly every route (home, articles, discover, search, embed, health, engagement APIs) must stay publicly readable; a middleware-wide gate would need an allowlist of the whole site to protect only `/admin`. The page-level gates do that job. The matcher excludes `_next/*`, `favicon.ico`, `embed`, `robots.txt`, `sitemap.xml`.

`WORKOS_REDIRECT_URI` (`https://news.mukoko.com/auth/callback`) must stay registered in the WorkOS dashboard for the active `WORKOS_CLIENT_ID` — both the inline `saveSession` flow's session cookie and the hosted-fallback return path depend on the client/redirect config being correct.

## The admin gate is the server component, not middleware

**`/admin` is NOT gated in middleware** — cookie presence is spoofable. The authoritative gate is `src/app/admin/layout.tsx`:

1. `withAuth()` (server-side) returns verified WorkOS claims.
2. `resolveTier({ organizationId, role, permissions })` computes the tier.
3. Unauthenticated → render the inline `<InlineSignIn redirectTo="/admin">` form on-page (with a hosted-page fallback link). `!canAccessAdmin(tier)` → render "Access denied". Otherwise render the admin app.

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

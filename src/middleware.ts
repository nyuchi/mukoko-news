import { authkitMiddleware } from '@workos-inc/authkit-nextjs'

// WorkOS AuthKit middleware — session refresh only.
//
// Web users sign in via the EMBEDDED inline AuthKit form on news.mukoko.com
// (src/components/auth/inline-sign-in.tsx) — never redirected to the hosted
// identity.nyuchi.com page. `middlewareAuth` is intentionally NOT enabled
// (it would force a hosted redirect); this just keeps the session cookie fresh.
//
// /admin is NOT gated here. Cookie *presence* is spoofable, so it is not a real
// auth check — the authoritative, verified gate is the /admin server layout
// (src/app/admin/layout.tsx) which calls withAuth() and enforces RBAC via
// src/lib/auth/roles.ts, rendering the inline sign-in for unauthenticated users.
export default authkitMiddleware({
  redirectUri: 'https://news.mukoko.com/auth/callback',
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|embed|robots.txt|sitemap.xml).*)',
  ],
}

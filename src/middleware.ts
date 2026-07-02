import { authkitMiddleware } from '@workos-inc/authkit-nextjs'

// WorkOS AuthKit middleware — session refresh only.
//
// Sign-in uses the WorkOS-HOSTED AuthKit page: /sign-in and the /admin layout
// redirect unauthenticated users via getSignInUrl(), and users return through
// /auth/callback. `middlewareAuth` is still NOT enabled here — deliberately:
// almost every route (/, /article/*, /discover, /search, /embed/*, /api/health,
// the engagement APIs) must stay publicly readable, so a middleware-wide auth
// gate would need an exhaustive unauthenticatedPaths allowlist for the whole
// site to protect only /admin. The page-level gates already do that job.
//
// /admin is NOT gated here. Cookie *presence* is spoofable, so it is not a real
// auth check — the authoritative, verified gate is the /admin server layout
// (src/app/admin/layout.tsx) which calls withAuth() and enforces RBAC via
// src/lib/auth/roles.ts, redirecting unauthenticated users to the hosted
// sign-in page.
export default authkitMiddleware({
  redirectUri: 'https://news.mukoko.com/auth/callback',
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|embed|robots.txt|sitemap.xml).*)',
  ],
}

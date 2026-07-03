import { authkitMiddleware } from '@workos-inc/authkit-nextjs'
import { NextRequest, NextResponse, type NextFetchEvent } from 'next/server'

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
const authkit = authkitMiddleware({
  redirectUri: 'https://news.mukoko.com/auth/callback',
})

// Markdown for Agents: an agent that sends `Accept: text/markdown` gets a clean
// markdown representation of `/` and `/article/[id]`, while browsers keep the
// HTML page. We rewrite to the /api/agent-md responder (which sets
// Content-Type: text/markdown). Runs BEFORE AuthKit so these responses stay
// cookie-free and cacheable.
const MARKDOWN_PATHS = /^\/(?:article\/[^/]+\/?)?$/

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (req.method === 'GET') {
    const accept = req.headers.get('accept') || ''
    // Prefer markdown only when it's explicitly acceptable and HTML isn't (a
    // browser sends `text/html,...`; an agent sends `text/markdown`).
    if (/text\/markdown/i.test(accept) && !/text\/html/i.test(accept)) {
      const { pathname } = req.nextUrl
      if (MARKDOWN_PATHS.test(pathname)) {
        const url = req.nextUrl.clone()
        url.pathname = '/api/agent-md'
        url.search = ''
        url.searchParams.set('path', pathname)
        return NextResponse.rewrite(url)
      }
    }
  }
  return authkit(req, event)
}

export const config = {
  matcher: [
    // Static assets + the public agent-discovery documents are excluded: they
    // carry no session and must stay cookie-free / cacheable for agents
    // (.well-known/* = MCP server card + OAuth metadata; auth.md = auth guide).
    '/((?!_next/static|_next/image|favicon.ico|embed|robots.txt|sitemap.xml|sw.js|manifest.json|\\.well-known|auth\\.md).*)',
  ],
}

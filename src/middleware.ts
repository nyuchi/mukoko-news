import { authkitMiddleware } from '@workos-inc/authkit-nextjs'
import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server'

// WorkOS AuthKit middleware.
//
// Web users sign in via the EMBEDDED inline AuthKit form on news.mukoko.com
// (src/components/auth/inline-sign-in.tsx) — they are never redirected to the
// hosted identity.nyuchi.com page. So `middlewareAuth` is intentionally NOT
// enabled (it would force a hosted redirect): the middleware just keeps the
// session cookie fresh.
//
// Public routes (news feed, /analytics, article pages, etc.) stay public.
// Only /admin is gated here: unauthenticated visitors are bounced to the inline
// /sign-in page. Fine-grained RBAC (moderator/admin/superadmin) is enforced in
// the /admin server layout via src/lib/auth/roles.ts.
const authkit = authkitMiddleware({
  redirectUri: 'https://news.mukoko.com/auth/callback',
})

export default async function middleware(request: NextRequest, event: NextFetchEvent) {
  const response = await authkit(request, event)

  if (request.nextUrl.pathname.startsWith('/admin')) {
    // The WorkOS session cookie is set by AuthKit; if it's missing, send the
    // visitor to the inline sign-in with a returnTo back to where they were.
    const cookieName = process.env.WORKOS_COOKIE_NAME || 'wos-session'
    const hasSession = request.cookies.has(cookieName)
    if (!hasSession) {
      const signInUrl = new URL('/sign-in', request.url)
      signInUrl.searchParams.set('returnTo', request.nextUrl.pathname)
      return NextResponse.redirect(signInUrl)
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|embed|robots.txt|sitemap.xml).*)',
  ],
}

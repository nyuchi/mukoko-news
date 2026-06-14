import { authkitMiddleware } from '@workos-inc/authkit-nextjs'

// WorkOS AuthKit middleware — session refresh only.
//
// Web users sign in via EMBEDDED AuthKit components on news.mukoko.com — they
// are never redirected to the hosted identity.nyuchi.com page. (Only MCP clients
// use the hosted OAuth flow at identity.nyuchi.com.)
//
// `middlewareAuth` is intentionally NOT enabled: that would force a redirect to
// the hosted sign-in page. Instead the middleware just keeps the session cookie
// fresh, and protected pages render the embedded sign-in component when there is
// no authenticated user.
export default authkitMiddleware({
  redirectUri: 'https://news.mukoko.com/auth/callback',
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|embed|robots.txt|sitemap.xml).*)',
  ],
}

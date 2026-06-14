import { authkitMiddleware } from '@workos-inc/authkit-nextjs'

// WorkOS AuthKit middleware using identity.nyuchi.com custom auth domain.
// Public routes (news, articles, analytics) pass through unauthenticated.
// Private routes (/profile, /saved) redirect to sign-in when unauthenticated.
export default authkitMiddleware({
  signUpPaths: ['/profile', '/saved'],
  redirectUri: 'https://news.mukoko.com/auth/callback',
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|embed|robots.txt|sitemap.xml).*)',
  ],
}

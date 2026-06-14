import { authkitMiddleware } from '@workos-inc/authkit-nextjs'

// WorkOS AuthKit middleware — session refresh only.
// Public routes (news, articles, analytics) pass through unauthenticated.
// Private routes (/profile, /saved) redirect to sign-in when unauthenticated.
export default authkitMiddleware({
  // Routes that require authentication
  signUpPaths: ['/profile', '/saved'],
  redirectUri: `${process.env.NEXT_PUBLIC_BASE_URL ?? 'https://news.mukoko.com'}/auth/callback`,
})

export const config = {
  matcher: [
    // Skip Next.js internals and static assets
    '/((?!_next/static|_next/image|favicon.ico|embed|robots.txt|sitemap.xml).*)',
  ],
}

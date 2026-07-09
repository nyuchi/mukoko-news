import { getSignInUrl } from '@workos-inc/authkit-nextjs'
import { NextResponse, type NextRequest } from 'next/server'

// AuthKit initiate-login endpoint. The WorkOS application config points
// `initiateLoginUri` at https://news.mukoko.com/auth/login — AuthKit sends
// users here when IT needs the app to (re)start a login (IdP-initiated flows,
// an expired hosted-flow state, a bare visit to the hosted page). Redirect
// straight into a fresh hosted sign-in.

export const dynamic = 'force-dynamic'

/** Validate a return path to a safe same-origin relative path. */
function safeReturnTo(value: string | null): string {
  if (value && /^\/(?!\/)/.test(value)) return value
  return '/'
}

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams
  const returnTo = safeReturnTo(params.get('return_to') ?? params.get('returnTo'))
  try {
    return NextResponse.redirect(await getSignInUrl({ returnTo }))
  } catch (err) {
    console.error('[AUTH] /auth/login getSignInUrl() failed', err)
    // /sign-in?error=… renders the manual-retry error card (never a loop).
    const fallback = new URL('/sign-in', request.nextUrl.origin)
    fallback.searchParams.set('error', 'login_unavailable')
    return NextResponse.redirect(fallback)
  }
}

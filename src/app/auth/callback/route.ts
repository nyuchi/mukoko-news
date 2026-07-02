import { handleAuth } from '@workos-inc/authkit-nextjs'
import { NextResponse, type NextRequest } from 'next/server'

// WorkOS OAuth callback — exchanges the `code` for a session cookie and returns
// the user to the app. This is the handler that returns HTTP 500 in production
// when it is not robust; the failure is almost always one of:
//
//   Required env vars (a misconfig in any of these breaks the exchange):
//     - WORKOS_CLIENT_ID       — the WorkOS client/project the redirect URI is
//                                registered under; MUST match the client used to
//                                start sign-in (getSignInUrl / Magic Auth).
//     - WORKOS_API_KEY         — server API key used for the code exchange.
//     - WORKOS_REDIRECT_URI    — https://news.mukoko.com/auth/callback; MUST be
//                                registered in the WorkOS dashboard for that client.
//     - WORKOS_COOKIE_PASSWORD — 32+ char secret used to seal the session cookie.
//
// Plain `handleAuth()` (no onError) THROWS on any failure — a missing/expired
// code, a redirect-URI/client mismatch, or a WorkOS-returned OAuth error — which
// Next renders as a 500. We (1) short-circuit obvious bad requests (WorkOS error
// param, or no `code`) and (2) pass `onError` so exchange failures redirect back
// to /sign-in with a friendly message instead of 500-ing.

export const dynamic = 'force-dynamic'

/** Send the user back to the inline sign-in form with an error marker. */
function redirectToSignIn(request: NextRequest, reason: string): NextResponse {
  const url = new URL('/sign-in', request.nextUrl.origin)
  url.searchParams.set('error', reason)
  return NextResponse.redirect(url)
}

const authHandler = handleAuth({
  // Where verified users land if WorkOS did not carry a returnPathname.
  returnPathname: '/',
  onError: ({ error, request }) => {
    console.error('[AUTH] /auth/callback code exchange failed', error)
    return redirectToSignIn(request, 'exchange_failed')
  },
})

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams

  // WorkOS handed back an OAuth error (user cancelled, config problem, …) —
  // there is no code to exchange, so don't hand it to handleAuth.
  const oauthError = params.get('error')
  if (oauthError) {
    console.error(
      '[AUTH] /auth/callback OAuth error',
      oauthError,
      params.get('error_description')
    )
    return redirectToSignIn(request, oauthError)
  }

  // No authorization code → nothing to exchange (stray/replayed callback hit).
  if (!params.get('code')) {
    console.error('[AUTH] /auth/callback missing code param')
    return redirectToSignIn(request, 'missing_code')
  }

  return authHandler(request)
}

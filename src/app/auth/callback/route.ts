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

/**
 * Reduce a WorkOS/OAuth error param to a short safe slug for the sign-in URL —
 * never reflect the raw request-controlled value into a response or a log.
 */
function sanitizeErrorCode(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40)
  return slug || 'oauth_error'
}

/** Send the user back to the inline sign-in form with an error marker. */
function redirectToSignIn(request: NextRequest, reason: string): NextResponse {
  const url = new URL('/sign-in', request.nextUrl.origin)
  url.searchParams.set('error', reason)
  return NextResponse.redirect(url)
}

const authHandler = handleAuth({
  // Where verified users land if WorkOS did not carry a returnPathname.
  returnPathname: '/',
  onError: ({ request }) => {
    // Do NOT log the error object — WorkOS exchange errors can carry the
    // authorization code / token material (clear-text-logging risk). The
    // failure reason is surfaced to the user via the /sign-in?error marker.
    console.error('[AUTH] /auth/callback code exchange failed')
    return redirectToSignIn(request, 'exchange_failed')
  },
})

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams

  // WorkOS handed back an OAuth error (user cancelled, config problem, …) —
  // there is no code to exchange, so don't hand it to handleAuth.
  const oauthError = params.get('error')
  if (oauthError) {
    // Log only a static message — the `error`/`error_description` params are
    // request-controlled and may carry sensitive detail (clear-text-logging
    // risk). The specific code is passed to /sign-in via a sanitized marker.
    console.error('[AUTH] /auth/callback received an OAuth error response')
    return redirectToSignIn(request, sanitizeErrorCode(oauthError))
  }

  // No authorization code → nothing to exchange (stray/replayed callback hit).
  if (!params.get('code')) {
    console.error('[AUTH] /auth/callback missing code param')
    return redirectToSignIn(request, 'missing_code')
  }

  return authHandler(request)
}

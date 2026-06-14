import { redirect } from 'next/navigation'
import { type NextRequest } from 'next/server'
import { getSignInUrl, getSignUpUrl } from '@workos-inc/authkit-nextjs'

// Initiates the WorkOS AuthKit flow (PKCE, email-code / Magic Auth).
// Registered as the "Sign-in endpoint" for the web app in the WorkOS dashboard,
// so externally-initiated logins (expired session, invitations) land here.
//
// Sign-up and sign-in share the same passwordless flow — `?screen=sign-up`
// only changes the wording on the AuthKit screen.
export async function GET(request: NextRequest) {
  const screen = request.nextUrl.searchParams.get('screen')
  const url = screen === 'sign-up' ? await getSignUpUrl() : await getSignInUrl()
  redirect(url)
}

import { redirect } from 'next/navigation'
import { getSignInUrl } from '@workos-inc/authkit-nextjs'

// Initiates the WorkOS AuthKit sign-in flow (PKCE).
// Registered as the "Sign-in endpoint" for the web app in the WorkOS dashboard,
// so externally-initiated logins (expired session, etc.) land here.
export async function GET() {
  const signInUrl = await getSignInUrl()
  redirect(signInUrl)
}

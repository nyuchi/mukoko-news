import { signOut } from '@workos-inc/authkit-nextjs'

// Clears the AuthKit session and redirects to the configured sign-out URL
// (App homepage / Sign-out redirect set in the WorkOS dashboard).
export async function GET() {
  await signOut({ returnTo: 'https://news.mukoko.com' })
}

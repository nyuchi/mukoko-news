import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { withAuth, getSignInUrl } from '@workos-inc/authkit-nextjs'

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in to Mukoko News to save articles and personalize your feed.',
  robots: { index: false, follow: false },
}

interface SignInPageProps {
  searchParams: Promise<{ returnTo?: string }>
}

/** Validate a returnTo value to a safe same-origin relative path. */
function safeReturnTo(value: string | undefined): string | undefined {
  if (!value) return undefined
  // Only allow root-relative single-slash paths (block protocol-relative //evil).
  if (/^\/(?!\/)/.test(value)) return value
  return undefined
}

/**
 * Sign-in entry point — redirects to the WorkOS-hosted AuthKit page.
 * (Owner decision 2026-07-02: hosted AuthKit replaces the old inline form.)
 * Users return via /auth/callback, then land on `returnTo`.
 */
export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { returnTo } = await searchParams
  const dest = safeReturnTo(returnTo) ?? '/profile'

  // Already signed in? Skip the hosted page.
  const { user } = await withAuth()
  if (user) redirect(dest)

  redirect(await getSignInUrl({ returnTo: dest }))
}

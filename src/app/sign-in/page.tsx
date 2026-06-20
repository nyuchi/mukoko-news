import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { withAuth } from '@workos-inc/authkit-nextjs'
import { InlineSignIn } from '@/components/auth/inline-sign-in'

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

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { returnTo } = await searchParams
  const dest = safeReturnTo(returnTo) ?? '/profile'

  // Already signed in? Skip the form.
  const { user } = await withAuth()
  if (user) redirect(dest)

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-elevated bg-surface p-8">
        <InlineSignIn redirectTo={dest} />
      </div>
    </div>
  )
}

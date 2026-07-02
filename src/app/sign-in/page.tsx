import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { withAuth, getSignInUrl } from '@workos-inc/authkit-nextjs'
import { AppIcon } from '@/components/ui/app-icon'
import { InlineSignIn } from '@/components/auth/inline-sign-in'

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in to mukoko to save articles and personalize your feed.',
  robots: { index: false, follow: false },
}

// Auth reads a request-scoped session, and the hosted fallback URL is generated
// per-request — never statically prerender this page (a blank prerender is one
// way the page can render as an empty shell).
export const dynamic = 'force-dynamic'

interface SignInPageProps {
  searchParams: Promise<{ returnTo?: string; error?: string }>
}

/** Validate a returnTo value to a safe same-origin relative path. */
function safeReturnTo(value: string | undefined): string | undefined {
  if (!value) return undefined
  // Only allow root-relative single-slash paths (block protocol-relative //evil).
  if (/^\/(?!\/)/.test(value)) return value
  return undefined
}

const CALLBACK_ERROR =
  'We could not complete that sign-in. Please try again with your email below.'

/**
 * Sign-in entry point — renders the INLINE (embedded) AuthKit form so users stay
 * on news.mukoko.com (owner doctrine 2026-07-02, superseding the earlier
 * hosted-redirect decision). The WorkOS-hosted authkit page is offered only as a
 * subtle fallback link. Already-signed-in users skip straight to `returnTo`.
 */
export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { returnTo, error } = await searchParams
  const dest = safeReturnTo(returnTo) ?? '/profile'

  // Already signed in? Skip the form. `withAuth()` is wrapped so a WorkOS
  // misconfig surfaces the form (below) rather than a blank 500 shell.
  let user: unknown = null
  try {
    ;({ user } = await withAuth())
  } catch (err) {
    console.error('[AUTH] /sign-in withAuth() failed; rendering form', err)
  }
  if (user) redirect(dest)

  // The hosted page is a BACKUP only. Best-effort — never let a failure here
  // blank the page; just omit the fallback link.
  let fallbackUrl: string | undefined
  try {
    fallbackUrl = await getSignInUrl({ returnTo: dest })
  } catch (err) {
    console.error('[AUTH] getSignInUrl() failed; hiding hosted fallback link', err)
  }

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center px-6 py-12">
      {/* Compact brand header */}
      <div className="flex flex-col items-center text-center mb-8">
        <AppIcon size={48} className="mb-3" />
        <span className="font-serif text-2xl font-semibold lowercase text-foreground">
          mukoko
        </span>
        <p className="mt-1 text-sm text-text-secondary">Pan-African news, in one place</p>
      </div>

      {/* Auth card */}
      <div className="w-full max-w-sm rounded-[var(--radius-card)] bg-surface ring-1 ring-foreground/10 p-8">
        <InlineSignIn
          redirectTo={dest}
          fallbackUrl={fallbackUrl}
          initialError={error ? CALLBACK_ERROR : null}
        />
      </div>

      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-foreground transition-colors focus-visible:outline-none focus-visible:underline"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        Back to news
      </Link>
    </div>
  )
}

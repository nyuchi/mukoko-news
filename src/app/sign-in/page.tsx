import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { withAuth, getSignInUrl } from '@workos-inc/authkit-nextjs'
import { AppIcon } from '@/components/ui/app-icon'

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in to mukoko to save articles and personalize your feed.',
  robots: { index: false, follow: false },
}

// Auth reads a request-scoped session and the hosted AuthKit URL is generated
// per-request — never statically prerender this page.
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

/**
 * Sign-in entry point — redirects to the WORKOS-HOSTED AuthKit page (owner
 * doctrine 2026-07-09, superseding the 2026-07-02 inline-form doctrine). The
 * hosted page owns the whole flow — Magic Auth, passwords, passkeys, and the
 * environment-required MFA step — and establishes the shared AuthKit session on
 * identity.nyuchi.com, which is what gives continuous sign-in across the Mukoko
 * and Nyuchi apps. Already-signed-in users skip straight to `returnTo`.
 *
 * When a callback failure sends the user back here with ?error=…, we render an
 * error card with a manual "try again" link instead of auto-redirecting — an
 * automatic bounce back to the hosted page would loop on a persistent failure.
 */
export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { returnTo, error } = await searchParams
  const dest = safeReturnTo(returnTo) ?? '/profile'

  // Already signed in? Skip the hosted page. `withAuth()` is wrapped so a WorkOS
  // misconfig degrades to the sign-in flow rather than a blank 500 shell.
  let user: unknown = null
  try {
    ;({ user } = await withAuth())
  } catch (err) {
    console.error('[AUTH] /sign-in withAuth() failed; continuing to hosted sign-in', err)
  }
  if (user) redirect(dest)

  // Best-effort — a failure here falls through to the error card below rather
  // than a blank page. redirect() throws NEXT_REDIRECT, so it stays OUTSIDE the
  // try/catch.
  let hostedUrl: string | undefined
  try {
    hostedUrl = await getSignInUrl({ returnTo: dest })
  } catch (err) {
    console.error('[AUTH] getSignInUrl() failed; rendering sign-in error card', err)
  }

  if (!error && hostedUrl) redirect(hostedUrl)

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

      {/* Error card — a failed callback exchange or a WorkOS misconfig. */}
      <div className="w-full max-w-sm rounded-[var(--radius-card)] bg-surface ring-1 ring-foreground/10 p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-container-tanzanite flex items-center justify-center mx-auto mb-4">
          <ShieldAlert className="w-6 h-6 text-on-container-tanzanite" aria-hidden="true" />
        </div>
        <h1 className="font-serif text-2xl font-semibold mb-2 text-foreground">
          {hostedUrl ? 'Sign-in interrupted' : 'Sign-in unavailable'}
        </h1>
        <p className="text-sm text-text-secondary mb-6" role="alert">
          {hostedUrl
            ? 'We could not complete that sign-in. Please try again.'
            : 'Sign-in is temporarily unavailable. Please try again in a few minutes.'}
        </p>
        {hostedUrl && (
          <a
            href={hostedUrl}
            className="inline-block w-full px-6 py-3 bg-primary text-on-primary font-medium rounded-xl hover:opacity-90 transition-opacity"
          >
            Try again
          </a>
        )}
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

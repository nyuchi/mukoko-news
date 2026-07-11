import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { withAuth } from '@workos-inc/authkit-nextjs'
import { AppIcon } from '@/components/ui/app-icon'

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in to mukoko to save articles and personalize your feed.',
  robots: { index: false, follow: false },
}

// Auth reads a request-scoped session — never statically prerender this page.
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
 * Sign-in entry point — sends the user into the WORKOS-HOSTED AuthKit flow
 * (owner doctrine 2026-07-09, superseding the 2026-07-02 inline-form doctrine).
 * The hosted page owns the whole flow — Magic Auth, passwords, passkeys, and the
 * environment-required MFA step — and establishes the shared AuthKit session
 * that gives continuous sign-in across the Mukoko and Nyuchi apps.
 *
 * The actual redirect to WorkOS happens in the /auth/login Route Handler, NOT
 * here: getSignInUrl() writes the PKCE/state cookie, and Next.js only allows
 * cookie writes in a Server Action or Route Handler — calling it during a page
 * render throws. This page only decides between "already signed in → returnTo",
 * "start a sign-in → /auth/login", and the error card.
 *
 * When a callback failure sends the user back here with ?error=…, we render an
 * error card with a manual "Try again" link instead of auto-redirecting — an
 * automatic bounce back into the flow would loop on a persistent failure.
 */
export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { returnTo, error } = await searchParams
  const dest = safeReturnTo(returnTo) ?? '/profile'
  const loginUrl = `/auth/login?returnTo=${encodeURIComponent(dest)}`

  // Already signed in? Skip the hosted flow. `withAuth()` is wrapped so a WorkOS
  // misconfig degrades to the sign-in flow rather than a blank 500 shell.
  let user: unknown = null
  try {
    ;({ user } = await withAuth())
  } catch (err) {
    console.error('[AUTH] /sign-in withAuth() failed; continuing to hosted sign-in', err)
  }
  if (user) redirect(dest)

  if (!error) redirect(loginUrl)

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
          Sign-in interrupted
        </h1>
        <p className="text-sm text-text-secondary mb-6" role="alert">
          We could not complete that sign-in. Please try again.
        </p>
        <a
          href={loginUrl}
          className="inline-block w-full px-6 py-3 bg-primary text-on-primary font-medium rounded-xl hover:opacity-90 transition-opacity"
        >
          Try again
        </a>
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

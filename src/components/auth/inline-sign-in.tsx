'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Mail, KeyRound, Loader2, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { requestEmailCode, verifyEmailCode } from '@/lib/auth/actions'

interface InlineSignInProps {
  /** Where to send the user after a successful sign-in. Defaults to a refresh. */
  redirectTo?: string
  /** Optional heading override. */
  title?: string
  subtitle?: string
  /**
   * WorkOS-hosted AuthKit URL. When provided, a subtle fallback link is shown
   * under the form ("Trouble signing in? Use our secure page"). The hosted page
   * is a BACKUP only (owner doctrine 2026-07-02) — never the default path.
   */
  fallbackUrl?: string
  /** Seed an error message (e.g. surfaced from an /auth/callback failure). */
  initialError?: string | null
}

type Step = 'email' | 'code'

/**
 * Embedded, on-site AuthKit sign-in — the PRIMARY sign-in surface. Uses WorkOS
 * Magic Auth (passwordless email code) via Server Actions, so the user never
 * leaves news.mukoko.com and is never redirected to the hosted authkit page.
 * Styled with the Mukoko "Swarm" design tokens; renders the card *contents* —
 * the caller wraps it in a surface card.
 */
export function InlineSignIn({
  redirectTo,
  title,
  subtitle,
  fallbackUrl,
  initialError = null,
}: InlineSignInProps) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(initialError)
  const [isPending, startTransition] = useTransition()

  const emailRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  // Autofocus the active step's first field.
  useEffect(() => {
    if (step === 'email') emailRef.current?.focus()
    else codeRef.current?.focus()
  }, [step])

  const sendCode = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await requestEmailCode(email)
      if (res.ok) {
        setStep('code')
      } else {
        setError(res.error ?? 'Something went wrong.')
      }
    })
  }

  const confirmCode = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await verifyEmailCode(email, code)
      if (res.ok) {
        if (redirectTo) router.push(redirectTo)
        router.refresh()
      } else {
        setError(res.error ?? 'Something went wrong.')
      }
    })
  }

  const inputClasses =
    'w-full h-12 rounded-[var(--radius-input)] border border-elevated bg-background px-4 text-foreground placeholder:text-text-tertiary focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors'

  return (
    <div className="w-full">
      <div className="text-center mb-6">
        <div className="w-12 h-12 rounded-full bg-container-tanzanite flex items-center justify-center mx-auto mb-4">
          {step === 'email' ? (
            <Mail className="w-6 h-6 text-on-container-tanzanite" aria-hidden="true" />
          ) : (
            <KeyRound className="w-6 h-6 text-on-container-tanzanite" aria-hidden="true" />
          )}
        </div>
        <h1 className="font-serif text-2xl font-semibold mb-1 text-foreground">
          {title ?? 'Sign in to mukoko'}
        </h1>
        <p className="text-text-secondary text-sm" aria-live="polite">
          {step === 'email'
            ? (subtitle ?? 'Enter your email and we will send you a one-time code.')
            : `We sent a 6-digit code to ${email}.`}
        </p>
      </div>

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-4 rounded-[var(--radius-input)] border border-status-error/40 bg-status-error/10 px-4 py-3 text-sm text-status-error"
        >
          {error}
        </div>
      )}

      {step === 'email' ? (
        <form onSubmit={sendCode} className="space-y-4" noValidate>
          <div>
            <label
              htmlFor="signin-email"
              className="block mb-1.5 text-sm font-medium text-foreground"
            >
              Email address
            </label>
            <input
              id="signin-email"
              ref={emailRef}
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={inputClasses}
            />
          </div>
          <Button type="submit" disabled={isPending} className="w-full h-12 text-base">
            {isPending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            Send code
          </Button>
        </form>
      ) : (
        <form onSubmit={confirmCode} className="space-y-4" noValidate>
          <div>
            <label
              htmlFor="signin-code"
              className="block mb-1.5 text-sm font-medium text-foreground"
            >
              One-time code
            </label>
            <input
              id="signin-code"
              ref={codeRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className={`${inputClasses} text-center font-mono text-lg tracking-[0.4em] placeholder:tracking-normal`}
            />
          </div>
          <Button type="submit" disabled={isPending} className="w-full h-12 text-base">
            {isPending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            Verify &amp; sign in
          </Button>
          <button
            type="button"
            onClick={() => {
              setStep('email')
              setCode('')
              setError(null)
            }}
            className="flex w-full items-center justify-center gap-2 text-sm text-text-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:underline"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Use a different email
          </button>
        </form>
      )}

      {fallbackUrl && (
        <p className="mt-6 text-center text-xs text-text-tertiary">
          Trouble signing in?{' '}
          <a
            href={fallbackUrl}
            className="underline hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
          >
            Use our secure page
          </a>
          .
        </p>
      )}

      <p className="mt-4 text-center text-xs text-text-tertiary">
        By continuing you agree to our{' '}
        <a href="/terms" className="underline hover:text-foreground">
          Terms
        </a>{' '}
        and{' '}
        <a href="/privacy" className="underline hover:text-foreground">
          Privacy Policy
        </a>
        .
      </p>
    </div>
  )
}

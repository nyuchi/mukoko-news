'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Mail, KeyRound, Loader2, ArrowLeft } from 'lucide-react'
import { requestEmailCode, verifyEmailCode } from '@/lib/auth/actions'

interface InlineSignInProps {
  /** Where to send the user after a successful sign-in. Defaults to a refresh. */
  redirectTo?: string
  /** Optional heading override. */
  title?: string
  subtitle?: string
}

type Step = 'email' | 'code'

/**
 * Embedded, on-site AuthKit sign-in. Uses WorkOS Magic Auth (passwordless email
 * code) via Server Actions — the user never leaves news.mukoko.com. No redirect
 * to the hosted identity.nyuchi.com screen.
 */
export function InlineSignIn({ redirectTo, title, subtitle }: InlineSignInProps) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

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

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-gradient-to-br from-primary to-secondary rounded-full flex items-center justify-center mx-auto mb-4">
          {step === 'email' ? (
            <Mail className="w-8 h-8 text-white" />
          ) : (
            <KeyRound className="w-8 h-8 text-white" />
          )}
        </div>
        <h1 className="font-serif text-2xl font-bold mb-1">
          {title ?? 'Sign in to Mukoko'}
        </h1>
        <p className="text-text-secondary text-sm">
          {step === 'email'
            ? subtitle ?? 'Enter your email and we will send you a one-time code.'
            : `We sent a 6-digit code to ${email}.`}
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
        >
          {error}
        </div>
      )}

      {step === 'email' ? (
        <form onSubmit={sendCode} className="space-y-4">
          <div>
            <label htmlFor="signin-email" className="sr-only">
              Email address
            </label>
            <input
              id="signin-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border border-elevated bg-background px-4 py-3 text-foreground placeholder:text-text-tertiary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Send code
          </button>
        </form>
      ) : (
        <form onSubmit={confirmCode} className="space-y-4">
          <div>
            <label htmlFor="signin-code" className="sr-only">
              One-time code
            </label>
            <input
              id="signin-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="w-full rounded-xl border border-elevated bg-background px-4 py-3 text-center text-lg tracking-[0.3em] text-foreground placeholder:tracking-normal placeholder:text-text-tertiary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Verify &amp; sign in
          </button>
          <button
            type="button"
            onClick={() => {
              setStep('email')
              setCode('')
              setError(null)
            }}
            className="flex w-full items-center justify-center gap-2 text-sm text-text-secondary transition-colors hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            Use a different email
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-xs text-text-tertiary">
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

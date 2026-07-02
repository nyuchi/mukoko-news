'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Mail, KeyRound, ShieldCheck, Loader2, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  requestEmailCode,
  verifyEmailCode,
  verifyMfaCode,
  type MfaState,
} from '@/lib/auth/actions'

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

type Step = 'email' | 'code' | 'mfa'

const CODE_LENGTH = 6

/**
 * Segmented one-time-code input — six individual boxes with auto-advance, paste,
 * and backspace handling. Shared by the emailed Magic Auth code and the
 * authenticator (MFA) code so both steps look and behave identically.
 */
function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  autoFocus,
  ariaLabel,
}: {
  value: string
  onChange: (next: string) => void
  onComplete?: (code: string) => void
  disabled?: boolean
  autoFocus?: boolean
  ariaLabel: string
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const digits = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? '')

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus()
  }, [autoFocus])

  const setDigit = (index: number, raw: string) => {
    const clean = raw.replace(/\D/g, '')
    if (!clean) return
    const next = (value.slice(0, index) + clean + value.slice(index + 1)).slice(0, CODE_LENGTH)
    onChange(next)
    refs.current[Math.min(index + clean.length, CODE_LENGTH - 1)]?.focus()
    if (next.length === CODE_LENGTH) onComplete?.(next)
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (digits[index]) {
        onChange(value.slice(0, index) + value.slice(index + 1))
      } else if (index > 0) {
        onChange(value.slice(0, index - 1) + value.slice(index))
        refs.current[index - 1]?.focus()
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      refs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowRight' && index < CODE_LENGTH - 1) {
      refs.current[index + 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH)
    if (!pasted) return
    onChange(pasted)
    refs.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus()
    if (pasted.length === CODE_LENGTH) onComplete?.(pasted)
  }

  return (
    <div className="flex justify-center gap-2" role="group" aria-label={ariaLabel}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={digit}
          disabled={disabled}
          aria-label={`${ariaLabel} digit ${i + 1}`}
          onChange={(e) => setDigit(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className="h-14 w-11 rounded-[var(--radius-input)] border border-elevated bg-background text-center font-mono text-2xl text-foreground transition-colors focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
        />
      ))}
    </div>
  )
}

/**
 * Embedded, on-site AuthKit sign-in — the PRIMARY sign-in surface. Uses WorkOS
 * Magic Auth (passwordless email code) via Server Actions, so the user never
 * leaves news.mukoko.com and is never redirected to the hosted authkit page.
 * When the account has MFA enabled, a second authenticator-code step completes
 * on-site too. Styled with the Mukoko "Swarm" design tokens; renders the card
 * *contents* — the caller wraps it in a surface card.
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
  const [mfaCode, setMfaCode] = useState('')
  const [mfa, setMfa] = useState<MfaState | null>(null)
  const [error, setError] = useState<string | null>(initialError)
  const [isPending, startTransition] = useTransition()

  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step === 'email') emailRef.current?.focus()
  }, [step])

  const onSignedIn = useCallback(() => {
    if (redirectTo) router.push(redirectTo)
    router.refresh()
  }, [redirectTo, router])

  const sendCode = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await requestEmailCode(email)
      if (res.ok) {
        setCode('')
        setStep('code')
      } else {
        setError(res.error ?? 'Something went wrong.')
      }
    })
  }

  const confirmCode = useCallback(
    (submitted?: string) => {
      const value = submitted ?? code
      if (value.length !== CODE_LENGTH) return
      setError(null)
      startTransition(async () => {
        const res = await verifyEmailCode(email, value)
        if (res.ok) {
          onSignedIn()
        } else if (res.mfa) {
          setMfa(res.mfa)
          setMfaCode('')
          setStep('mfa')
        } else {
          setCode('')
          setError(res.error ?? 'Something went wrong.')
        }
      })
    },
    [code, email, onSignedIn]
  )

  const confirmMfa = useCallback(
    (submitted?: string) => {
      const value = submitted ?? mfaCode
      if (!mfa || value.length !== CODE_LENGTH) return
      setError(null)
      startTransition(async () => {
        const res = await verifyMfaCode(mfa.pendingToken, mfa.challengeId, value)
        if (res.ok) {
          onSignedIn()
        } else {
          setMfaCode('')
          setError(res.error ?? 'Something went wrong.')
        }
      })
    },
    [mfa, mfaCode, onSignedIn]
  )

  const resend = () => {
    setError(null)
    setCode('')
    startTransition(async () => {
      const res = await requestEmailCode(email)
      if (!res.ok) setError(res.error ?? 'Could not resend the code.')
    })
  }

  const inputClasses =
    'w-full h-12 rounded-[var(--radius-input)] border border-elevated bg-background px-4 text-foreground placeholder:text-text-tertiary focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors'

  const StepIcon = step === 'email' ? Mail : step === 'code' ? KeyRound : ShieldCheck
  const heading =
    step === 'mfa' ? 'Two-factor authentication' : (title ?? 'Sign in to mukoko')
  const description =
    step === 'email'
      ? (subtitle ?? 'Enter your email and we will send you a one-time code.')
      : step === 'code'
        ? `We sent a 6-digit code to ${email}.`
        : mfa?.mode === 'enrollment'
          ? 'Scan the QR code with your authenticator app, then enter the 6-digit code it shows.'
          : 'Enter the 6-digit code from your authenticator app.'

  return (
    <div className="w-full">
      <div className="text-center mb-6">
        <div className="w-12 h-12 rounded-full bg-container-tanzanite flex items-center justify-center mx-auto mb-4">
          <StepIcon className="w-6 h-6 text-on-container-tanzanite" aria-hidden="true" />
        </div>
        <h1 className="font-serif text-2xl font-semibold mb-1 text-foreground">{heading}</h1>
        <p className="text-text-secondary text-sm" aria-live="polite">
          {description}
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

      {step === 'email' && (
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
      )}

      {step === 'code' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            confirmCode()
          }}
          className="space-y-5"
          noValidate
        >
          <OtpInput
            value={code}
            onChange={setCode}
            onComplete={(c) => confirmCode(c)}
            disabled={isPending}
            autoFocus
            ariaLabel="One-time code"
          />
          <Button
            type="submit"
            disabled={isPending || code.length !== CODE_LENGTH}
            className="w-full h-12 text-base"
          >
            {isPending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            Verify &amp; sign in
          </Button>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => {
                setStep('email')
                setCode('')
                setError(null)
              }}
              className="inline-flex items-center gap-1 text-text-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:underline"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Change email
            </button>
            <button
              type="button"
              onClick={resend}
              disabled={isPending}
              className="text-secondary hover:underline focus-visible:outline-none focus-visible:underline disabled:opacity-60"
            >
              Resend code
            </button>
          </div>
        </form>
      )}

      {step === 'mfa' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            confirmMfa()
          }}
          className="space-y-5"
          noValidate
        >
          {mfa?.mode === 'enrollment' && mfa.qrCode && (
            <div className="flex flex-col items-center gap-3">
              {/* WorkOS returns a data-URL QR image for the enrolment secret. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mfa.qrCode}
                alt="Authenticator setup QR code"
                width={160}
                height={160}
                className="rounded-[var(--radius-input)] border border-elevated bg-white p-2"
              />
              {mfa.secret && (
                <p className="text-center text-xs text-text-tertiary">
                  Can&apos;t scan? Enter this key:{' '}
                  <code className="font-mono text-text-secondary break-all">{mfa.secret}</code>
                </p>
              )}
            </div>
          )}
          <OtpInput
            value={mfaCode}
            onChange={setMfaCode}
            onComplete={(c) => confirmMfa(c)}
            disabled={isPending}
            autoFocus
            ariaLabel="Authenticator code"
          />
          <Button
            type="submit"
            disabled={isPending || mfaCode.length !== CODE_LENGTH}
            className="w-full h-12 text-base"
          >
            {isPending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            Verify &amp; sign in
          </Button>
          <button
            type="button"
            onClick={() => {
              setStep('email')
              setMfa(null)
              setMfaCode('')
              setCode('')
              setError(null)
            }}
            className="flex w-full items-center justify-center gap-2 text-sm text-text-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:underline"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Start over
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

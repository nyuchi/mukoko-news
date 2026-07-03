'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { BadgeCheck, CheckCircle2, Loader2 } from 'lucide-react'
import { useAuth } from '@workos-inc/authkit-nextjs/components'
import { InlineSignIn } from '@/components/auth/inline-sign-in'
import { submitPublisherClaim, type PublisherClaimInput } from '@/lib/publisher/actions'

const ROLES = [
  { value: 'publisher', label: 'Publisher / Owner' },
  { value: 'editor', label: 'Editor' },
  { value: 'manager', label: 'Manager' },
  { value: 'representative', label: 'Authorized representative' },
] as const

/**
 * Tier-2 publisher claim form. A signed-in user asserts they represent a
 * publication; the submission is a Server Action that proxies to the gateway
 * (which resolves the claimant's identity and writes the `submitted` claim).
 * Staff then review it in /admin/publishers.
 */
export function PublisherClaimForm() {
  const { user, loading } = useAuth()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <Loader2 className="w-7 h-7 text-primary animate-spin" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="rounded-[var(--radius-card)] bg-surface ring-1 ring-foreground/10 p-8">
        <p className="mb-6 text-center text-text-secondary">
          Sign in to claim and verify your publication.
        </p>
        <InlineSignIn redirectTo="/publishers/claim" />
      </div>
    )
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-success/40 bg-success/10 p-8 text-center">
        <CheckCircle2 className="w-12 h-12 text-success mx-auto mb-4" />
        <h2 className="font-serif text-xl font-bold mb-2">Claim submitted</h2>
        <p className="text-text-secondary mb-6">
          Our team will review your claim and verify your publication. You&apos;ll keep access to
          your account in the meantime.
        </p>
        <Link
          href="/profile"
          className="inline-block px-5 py-2.5 bg-primary text-on-primary font-medium rounded-xl hover:opacity-90 transition-opacity"
        >
          Back to profile
        </Link>
      </div>
    )
  }

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const form = new FormData(e.currentTarget)
    const input: PublisherClaimInput = {
      claimedRole: String(form.get('claimedRole') || 'publisher') as PublisherClaimInput['claimedRole'],
      proposedOrgName: String(form.get('proposedOrgName') || '').trim() || undefined,
      proposedOrgUrl: String(form.get('proposedOrgUrl') || '').trim() || undefined,
      evidenceUrl: String(form.get('evidenceUrl') || '').trim() || undefined,
      evidenceNotes: String(form.get('evidenceNotes') || '').trim() || undefined,
    }
    startTransition(async () => {
      const res = await submitPublisherClaim(input)
      if (res.ok) setDone(true)
      else setError(res.error ?? 'Could not submit your claim. Please try again.')
    })
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-elevated bg-surface p-6 space-y-5">
      {error && (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Field label="Publication name" htmlFor="proposedOrgName" required>
        <input
          id="proposedOrgName"
          name="proposedOrgName"
          type="text"
          required
          maxLength={200}
          placeholder="e.g. Harare Post"
          className="input"
        />
      </Field>

      <Field label="Your role" htmlFor="claimedRole" required>
        <select id="claimedRole" name="claimedRole" className="input" defaultValue="publisher">
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Publication website" htmlFor="proposedOrgUrl">
        <input
          id="proposedOrgUrl"
          name="proposedOrgUrl"
          type="url"
          maxLength={500}
          placeholder="https://…"
          className="input"
        />
      </Field>

      <Field
        label="Evidence link"
        htmlFor="evidenceUrl"
        hint="A staff/masthead page, or a profile that shows your role."
      >
        <input
          id="evidenceUrl"
          name="evidenceUrl"
          type="url"
          maxLength={500}
          placeholder="https://…/about"
          className="input"
        />
      </Field>

      <Field label="Anything else for the reviewer?" htmlFor="evidenceNotes">
        <textarea
          id="evidenceNotes"
          name="evidenceNotes"
          rows={3}
          maxLength={2000}
          className="input resize-y"
          placeholder="Optional context to help us verify your claim."
        />
      </Field>

      <button
        type="submit"
        disabled={pending}
        className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary text-on-primary font-medium rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />}
        Submit claim
      </button>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid var(--color-elevated, rgba(0, 0, 0, 0.1));
          background: var(--color-background, transparent);
          padding: 0.625rem 0.75rem;
          font-size: 0.875rem;
        }
        :global(.input:focus-visible) {
          outline: none;
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 40%, transparent);
        }
      `}</style>
    </form>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  required,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium mb-1.5">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-text-tertiary">{hint}</p>}
    </div>
  )
}

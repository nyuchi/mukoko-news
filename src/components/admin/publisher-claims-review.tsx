'use client'

import { useState } from 'react'
import { Check, X, ExternalLink, Loader2, BadgeCheck, FileText } from 'lucide-react'
import type { AdminPublisherClaim } from '@/lib/mongodb/admin'
import { approvePublisherClaim, rejectPublisherClaim } from '@/lib/admin/gateway'

interface PublisherClaimsReviewProps {
  initialClaims: AdminPublisherClaim[]
}

/**
 * Tier-2 publisher-verification review queue. Reads are server-rendered
 * (getPublisherClaims); approve/reject are gateway mutations — the gateway
 * verifies the org, stacks the trust boosts, and audits the change. On success a
 * claim leaves the queue optimistically.
 */
export function PublisherClaimsReview({ initialClaims }: PublisherClaimsReviewProps) {
  const [claims, setClaims] = useState(initialClaims)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const drop = (id: string) => setClaims((prev) => prev.filter((c) => c.id !== id))

  const approve = (id: string) => {
    setBusyId(id)
    setNotice(null)
    approvePublisherClaim(id)
      .then((res) => {
        if (res.ok) drop(id)
        else setNotice(res.error ?? 'Could not approve the claim.')
      })
      .finally(() => setBusyId(null))
  }

  const confirmReject = (id: string) => {
    if (!reason.trim()) {
      setNotice('Enter a reason before rejecting.')
      return
    }
    setBusyId(id)
    setNotice(null)
    rejectPublisherClaim(id, reason.trim())
      .then((res) => {
        if (res.ok) {
          drop(id)
          setRejectingId(null)
          setReason('')
        } else {
          setNotice(res.error ?? 'Could not reject the claim.')
        }
      })
      .finally(() => setBusyId(null))
  }

  return (
    <div>
      {notice && (
        <div className="mb-4 rounded-xl border border-elevated bg-surface px-4 py-3 text-sm text-foreground">
          {notice}
        </div>
      )}

      <div className="space-y-3">
        {claims.map((c) => (
          <div key={c.id} className="rounded-xl border border-elevated bg-surface p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <BadgeCheck className="w-4 h-4 text-secondary shrink-0" />
                  <h3 className="font-medium text-foreground truncate">
                    {c.organizationName ?? 'Unnamed publication'}
                  </h3>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
                  {c.claimedRole && (
                    <span className="rounded-full bg-elevated px-2 py-0.5 capitalize">
                      {c.claimedRole}
                    </span>
                  )}
                  <span className="rounded-full bg-elevated px-2 py-0.5 capitalize">{c.status}</span>
                  {c.mediaOrganizationId ? (
                    <span>linked org</span>
                  ) : (
                    <span>new org (proposed)</span>
                  )}
                  {c.proposedOrgUrl && /^https?:\/\//i.test(c.proposedOrgUrl) && (
                    <a
                      href={c.proposedOrgUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:text-primary"
                    >
                      site <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {c.evidenceUrl && /^https?:\/\//i.test(c.evidenceUrl) && (
                    <a
                      href={c.evidenceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:text-primary"
                    >
                      evidence <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                {c.evidenceNotes && (
                  <p className="mt-2 flex items-start gap-1.5 text-sm text-text-secondary">
                    <FileText className="w-4 h-4 mt-0.5 shrink-0 text-text-tertiary" />
                    <span className="line-clamp-3">{c.evidenceNotes}</span>
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => approve(c.id)}
                  disabled={busyId === c.id}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-success/10 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/20 transition-colors disabled:opacity-60"
                >
                  {busyId === c.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Check className="w-3 h-3" />
                  )}
                  Approve
                </button>
                <button
                  onClick={() => setRejectingId(rejectingId === c.id ? null : c.id)}
                  disabled={busyId === c.id}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-60"
                >
                  <X className="w-3 h-3" />
                  Reject
                </button>
              </div>
            </div>

            {rejectingId === c.id && (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason for rejection (required)"
                  className="flex-1 rounded-lg border border-elevated bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                />
                <button
                  onClick={() => confirmReject(c.id)}
                  disabled={busyId === c.id}
                  className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-on-primary hover:opacity-90 transition-opacity disabled:opacity-60"
                >
                  Confirm reject
                </button>
              </div>
            )}
          </div>
        ))}

        {claims.length === 0 && (
          <div className="rounded-xl border border-elevated bg-surface px-4 py-12 text-center text-text-tertiary">
            No publisher claims awaiting review.
          </div>
        )}
      </div>
    </div>
  )
}

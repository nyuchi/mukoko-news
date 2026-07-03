'use server'

import { withAuth } from '@workos-inc/authkit-nextjs'
import { z } from 'zod'

// Claimant-facing publisher-verification submission. A signed-in user claims to
// represent a publication; the gateway (POST /api/user/publisher-claims, under
// its requireAuth guard) resolves the claimant's identity.persons id and writes
// the `submitted` claim to news.publisherVerifications. The frontend never
// resolves personId or writes the claim itself — that crosses the identity
// domain boundary the gateway owns (see auth.md / the gateway's agents.md).

const GATEWAY_BASE = process.env.GATEWAY_API_URL || 'https://news.mukoko.dev'

export interface SubmitClaimResult {
  ok: boolean
  status: number
  claimId?: string
  error?: string
}

const CLAIMED_ROLES = ['publisher', 'editor', 'owner', 'manager', 'representative'] as const

/** A trimmed, optional string field bounded to `max` chars (empty stays ''). */
const optionalText = (max: number) => z.string().trim().max(max).optional()

const claimInputSchema = z
  .object({
    claimedRole: z.enum(CLAIMED_ROLES),
    mediaOrganizationId: optionalText(128),
    proposedOrgName: optionalText(200),
    proposedOrgUrl: optionalText(500),
    proposedOrgDescription: optionalText(2000),
    claimedRoleDetail: optionalText(500),
    evidenceUrl: optionalText(500),
    evidenceNotes: optionalText(2000),
  })
  .refine((v) => !!v.mediaOrganizationId || !!v.proposedOrgName, {
    message: 'Name the publication you represent.',
  })

export type PublisherClaimInput = z.input<typeof claimInputSchema>

export async function submitPublisherClaim(input: PublisherClaimInput): Promise<SubmitClaimResult> {
  const parsed = claimInputSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? 'Please check the form and try again.'
    return { ok: false, status: 400, error: first }
  }

  const { accessToken } = await withAuth()
  if (!accessToken) {
    return { ok: false, status: 401, error: 'Please sign in to claim a publication.' }
  }

  try {
    const res = await fetch(`${GATEWAY_BASE}/api/user/publisher-claims`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    })

    const text = await res.text()
    const data = text ? (JSON.parse(text) as { claimId?: string; error?: string }) : {}
    if (!res.ok) {
      return { ok: false, status: res.status, error: data.error ?? `Gateway returned ${res.status}` }
    }
    return { ok: true, status: res.status, claimId: data.claimId }
  } catch (err) {
    console.error('[PUBLISHER] claim submission failed', err)
    return { ok: false, status: 0, error: 'Could not reach the gateway. Please try again.' }
  }
}

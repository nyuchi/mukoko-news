import { AlertCircle } from 'lucide-react'
import { getPublisherClaims, type AdminPublisherClaim } from '@/lib/mongodb/admin'
import { PublisherClaimsReview } from '@/components/admin/publisher-claims-review'

export const metadata = { title: 'Publishers' }
export const dynamic = 'force-dynamic'

// Server Component: reads the Tier-2 publisher-verification review queue from
// MongoDB. Approve/reject route through the gateway Worker, which verifies the
// org and stacks the trust boosts on the source's score.
export default async function AdminPublishersPage() {
  let claims: AdminPublisherClaim[] = []
  let dbError = false
  try {
    claims = await getPublisherClaims()
  } catch (err) {
    console.error('[ADMIN] publisher claims read failed', err)
    dbError = true
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground mb-1">Publisher verification</h1>
        <p className="text-text-secondary">
          Tier-2 review: confirm a claimant genuinely represents a publication. Approving
          verifies the organization and boosts the trust score of its sources (stacking the
          entity-domain boost when the org is domain-verified).
        </p>
      </div>

      {dbError ? (
        <div className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertCircle className="w-5 h-5 shrink-0" />
          Could not load publisher claims from the database.
        </div>
      ) : (
        <PublisherClaimsReview initialClaims={claims} />
      )}
    </div>
  )
}

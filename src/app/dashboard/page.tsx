import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BadgeCheck, Clock, AlertCircle } from 'lucide-react'
import { withAuth } from '@workos-inc/authkit-nextjs'
import { getPublisherDashboard } from '@/lib/publisher/dashboard'
import { PublisherDashboard } from '@/components/publisher/dashboard/publisher-dashboard'

export const metadata: Metadata = {
  title: 'Publisher dashboard',
  description: 'Manage your publication, feeds, verification and analytics on Mukoko News.',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

// Verified-publisher dashboard. Signed-out → the hosted AuthKit flow via
// /sign-in. Signed-in but not a verified publisher → a claim/pending state (the
// feature is gated to approved media houses). Verified → the full dashboard.
export default async function DashboardPage() {
  const { user } = await withAuth()

  if (!user) {
    redirect(`/sign-in?returnTo=${encodeURIComponent('/dashboard')}`)
  }

  const context = await getPublisherDashboard()

  if (!context) {
    return (
      <Centered>
        <AlertCircle className="w-10 h-10 text-warning mx-auto mb-4" />
        <h1 className="font-serif text-xl font-bold mb-2">Dashboard unavailable</h1>
        <p className="text-text-secondary">We couldn&apos;t load your publisher dashboard. Please try again shortly.</p>
      </Centered>
    )
  }

  if (!context.isPublisher) {
    const pending = context.pendingClaims.find(
      (c) => c.status === 'submitted' || c.status === 'in_review'
    )
    return (
      <Centered>
        <div className="w-16 h-16 bg-container-sodalite rounded-full flex items-center justify-center mx-auto mb-4">
          {pending ? (
            <Clock className="w-8 h-8 text-on-container-sodalite" />
          ) : (
            <BadgeCheck className="w-8 h-8 text-on-container-sodalite" />
          )}
        </div>
        {pending ? (
          <>
            <h1 className="font-serif text-2xl font-bold mb-2">Your claim is under review</h1>
            <p className="text-text-secondary mb-6">
              We&apos;re verifying your claim for{' '}
              <span className="font-medium text-foreground">
                {pending.organizationName ?? 'your publication'}
              </span>
              . The dashboard unlocks as soon as our team approves it.
            </p>
            <Link
              href="/profile"
              className="inline-block px-5 py-2.5 bg-surface border border-elevated rounded-xl font-medium hover:bg-elevated transition-colors"
            >
              Back to profile
            </Link>
          </>
        ) : (
          <>
            <h1 className="font-serif text-2xl font-bold mb-2">Claim your publication</h1>
            <p className="text-text-secondary mb-6">
              The publisher dashboard is for verified media houses. Claim your publication and, once
              our team verifies it, you&apos;ll manage your feeds, trust score and analytics here.
            </p>
            <Link
              href="/publishers/claim"
              className="inline-block px-5 py-2.5 bg-primary text-on-primary rounded-xl font-medium hover:opacity-90 transition-opacity"
            >
              Claim your publication
            </Link>
          </>
        )}
      </Centered>
    )
  }

  return <PublisherDashboard context={context} />
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[600px] mx-auto px-6 py-16 text-center">{children}</div>
  )
}

import type { Metadata } from 'next'
import { BadgeCheck } from 'lucide-react'
import { PublisherClaimForm } from '@/components/publisher/publisher-claim-form'

export const metadata: Metadata = {
  title: 'Claim your publication',
  description:
    'Verify that you represent a news source on Mukoko News. Verified publishers earn a trust boost on their sources.',
}

export default function PublisherClaimPage() {
  return (
    <div className="max-w-[600px] mx-auto px-6 py-12">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-container-sodalite rounded-full flex items-center justify-center mx-auto mb-4">
          <BadgeCheck className="w-8 h-8 text-on-container-sodalite" />
        </div>
        <h1 className="font-serif text-2xl font-bold mb-2">Claim your publication</h1>
        <p className="text-text-secondary">
          Tell us which news source you represent. Our team reviews every claim; once verified,
          your organization is marked verified and its sources earn a trust boost.
        </p>
      </div>
      <PublisherClaimForm />
    </div>
  )
}

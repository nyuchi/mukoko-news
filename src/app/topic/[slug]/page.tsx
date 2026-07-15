import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Newspaper } from 'lucide-react'
import { getTopicTimelineAction } from '@/lib/actions/feed'
import { TopicTimeline } from '@/components/topic-timeline'

// Developing-story surface: everything published on a topic in the last 30
// days, on the Mzizi date-railed timeline (nyuchi-timeline). Reached from
// article tags and trending topics. ISR keeps it fresh without per-hit reads.
export const revalidate = 300

interface TopicPageProps {
  params: Promise<{ slug: string }>
}

function topicTitle(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export async function generateMetadata({ params }: TopicPageProps): Promise<Metadata> {
  const { slug } = await params
  const title = topicTitle(decodeURIComponent(slug))
  return {
    title: `${title} — Ongoing coverage`,
    description: `Follow the ${title} story as it develops: every report, day by day, from newsrooms across Africa.`,
  }
}

export default async function TopicPage({ params }: TopicPageProps) {
  const { slug } = await params
  const { topic, articles, total } = await getTopicTimelineAction(decodeURIComponent(slug))
  const title = topicTitle(topic || decodeURIComponent(slug))

  return (
    <div className="max-w-[840px] mx-auto px-4 sm:px-6 py-8">
      <Link
        href="/discover"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-foreground transition-colors focus-visible:outline-none focus-visible:underline"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        Discover
      </Link>

      <header className="mb-8">
        <p className="font-mono text-[13px] uppercase tracking-wide text-text-tertiary mb-1">
          Ongoing coverage
        </p>
        <h1 className="font-serif text-3xl sm:text-4xl font-bold text-foreground">{title}</h1>
        {total > 0 && (
          <p className="mt-2 text-sm text-text-secondary">
            {total} {total === 1 ? 'report' : 'reports'} in the last 30 days
          </p>
        )}
      </header>

      {articles.length > 0 ? (
        <TopicTimeline articles={articles} />
      ) : (
        <div className="text-center py-20">
          <div className="w-20 h-20 bg-surface rounded-full flex items-center justify-center mx-auto mb-6">
            <Newspaper className="w-10 h-10 text-text-tertiary" aria-hidden="true" />
          </div>
          <h2 className="font-serif text-xl font-bold mb-2">No recent coverage</h2>
          <p className="text-text-secondary mb-6 max-w-md mx-auto">
            Nothing has been published on this topic in the last 30 days. It may pick up again —
            check back later.
          </p>
          <Link
            href="/discover"
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-on-primary font-medium rounded-xl hover:opacity-90 transition-opacity"
          >
            Explore other topics
          </Link>
        </div>
      )}
    </div>
  )
}

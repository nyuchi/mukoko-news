import Link from 'next/link'
import Image from 'next/image'
import { isValidImageUrl } from '@/lib/utils'
import { imageProxyUrl } from '@/lib/image'
import type { Article } from '@/lib/api'

// Mzizi `nyuchi-timeline` (4.2.0 signature): a date-railed discovery list.
// Each day is a left rail (weekday, big day numeral, month) beside a stack of
// tight horizontal rows — time, title, source · category, right-edge thumbnail.
// Quiet rows, full 1px borders, muted small metadata. Server component.

// Dates render in Central Africa Time (the primary market) so the server and
// client always agree — no per-viewer timezone hydration drift.
const TZ = 'Africa/Harare'

const dayKeyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const weekdayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short' })
const dayNumFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric' })
const monthFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: 'short' })
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export interface TimelineDay {
  /** Stable YYYY-MM-DD key in the display timezone. */
  key: string
  weekday: string
  dayNumber: string
  month: string
  articles: Article[]
}

/** Group articles (assumed newest-first) into display days. Pure — unit tested. */
export function groupArticlesByDay(articles: Article[]): TimelineDay[] {
  const days: TimelineDay[] = []
  let current: TimelineDay | null = null
  for (const article of articles) {
    const published = new Date(article.published_at)
    if (Number.isNaN(published.getTime())) continue
    const key = dayKeyFmt.format(published)
    if (!current || current.key !== key) {
      current = {
        key,
        weekday: weekdayFmt.format(published),
        dayNumber: dayNumFmt.format(published),
        month: monthFmt.format(published),
        articles: [],
      }
      days.push(current)
    }
    current.articles.push(article)
  }
  return days
}

export function TopicTimeline({ articles }: { articles: Article[] }) {
  const days = groupArticlesByDay(articles)

  return (
    <div>
      {days.map((day) => (
        <section key={day.key} className="flex gap-4 sm:gap-6">
          {/* Date rail */}
          <div className="w-14 sm:w-20 shrink-0 pt-4 text-center" aria-hidden="true">
            <div className="font-mono text-[13px] uppercase tracking-wide text-text-tertiary">
              {day.weekday}
            </div>
            <div className="font-serif text-3xl sm:text-4xl font-semibold leading-tight text-foreground">
              {day.dayNumber}
            </div>
            <div className="font-mono text-[13px] uppercase tracking-wide text-text-tertiary">
              {day.month}
            </div>
          </div>

          {/* Day rows */}
          <div className="min-w-0 flex-1">
            {day.articles.map((article) => {
              const image =
                article.image_url && isValidImageUrl(article.image_url)
                  ? imageProxyUrl(article.image_url, { width: 128 })
                  : null
              return (
                <Link
                  key={article.id}
                  href={`/article/${article.id}`}
                  className="flex items-center gap-3 border-t border-elevated py-3 transition-colors hover:bg-elevated/50 focus-visible:outline-none focus-visible:bg-elevated/50"
                >
                  <time
                    dateTime={article.published_at}
                    className="w-12 shrink-0 font-mono text-[13px] text-text-tertiary"
                  >
                    {timeFmt.format(new Date(article.published_at))}
                  </time>
                  <div className="min-w-0 flex-1">
                    <h3 className="line-clamp-2 text-sm font-medium text-foreground">
                      {article.title}
                    </h3>
                    <p className="mt-0.5 truncate text-[13px] text-text-tertiary">
                      {article.source}
                      {article.category ? ` · ${article.category}` : ''}
                    </p>
                  </div>
                  {image && (
                    <Image
                      src={image}
                      alt=""
                      width={64}
                      height={64}
                      className="h-16 w-16 shrink-0 rounded-[var(--radius-inner)] object-cover"
                      unoptimized
                    />
                  )}
                </Link>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

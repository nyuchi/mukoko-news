'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  BadgeCheck,
  TrendingUp,
  Rss,
  Eye,
  Heart,
  Bookmark,
  FileText,
  Plus,
  Pencil,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react'
import type {
  PublisherContext,
  DashboardOrganization,
  DashboardSource,
  TrustFactor,
} from '@/lib/publisher/dashboard'
import { updatePublisherOrg, submitDirectFeed } from '@/lib/publisher/dashboard'

export function PublisherDashboard({ context }: { context: PublisherContext }) {
  const [activeId, setActiveId] = useState(context.organizations[0]?.id)
  const org = context.organizations.find((o) => o.id === activeId) ?? context.organizations[0]
  if (!org) return null

  return (
    <div className="max-w-[900px] mx-auto px-4 sm:px-6 py-8">
      <header className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="font-serif text-2xl font-bold">{org.name}</h1>
          {org.isVerified && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-container-sodalite px-2 py-0.5 text-xs font-medium text-on-container-sodalite"
              title={`Verified publisher · tier ${org.verificationTier}`}
            >
              <BadgeCheck className="w-3.5 h-3.5" />
              Verified
            </span>
          )}
        </div>
        <p className="text-text-secondary">Your publisher dashboard</p>

        {context.organizations.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {context.organizations.map((o) => (
              <button
                key={o.id}
                onClick={() => setActiveId(o.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  o.id === org.id
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface border border-elevated text-text-secondary hover:bg-elevated'
                }`}
              >
                {o.name}
              </button>
            ))}
          </div>
        )}
      </header>

      <StatRow org={org} />
      <TrustCard org={org} />
      <FeedsCard org={org} />
      <ProfileCard org={org} />
    </div>
  )
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-2xl border border-elevated bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-elevated">
        <h2 className="text-sm font-bold uppercase tracking-wider text-text-tertiary">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

function StatRow({ org }: { org: DashboardOrganization }) {
  const a = org.analytics
  const stats = [
    { label: 'Articles', value: a.totalArticles.toLocaleString(), icon: FileText },
    { label: 'Last 30 days', value: a.articlesLast30Days.toLocaleString(), icon: TrendingUp },
    { label: 'Views', value: a.totalViews.toLocaleString(), icon: Eye },
    { label: 'Avg. trust', value: `${org.trust.averageTrustScore}`, icon: BadgeCheck },
  ]
  return (
    <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map((s) => (
        <div key={s.label} className="rounded-2xl border border-elevated bg-surface p-4">
          <s.icon className="w-4 h-4 text-text-tertiary mb-2" />
          <div className="font-serif text-2xl font-bold">{s.value}</div>
          <div className="text-xs text-text-tertiary">{s.label}</div>
        </div>
      ))}
      <div className="col-span-2 sm:col-span-4 grid grid-cols-3 gap-3">
        <MiniStat label="Likes" value={a.totalLikes} icon={Heart} />
        <MiniStat label="Saves" value={a.totalSaves} icon={Bookmark} />
        <MiniStat label="With image" value={`${a.withImagePct}%`} icon={CheckCircle2} />
      </div>
    </div>
  )
}

function MiniStat({ label, value, icon: Icon }: { label: string; value: number | string; icon: typeof Eye }) {
  return (
    <div className="rounded-xl border border-elevated bg-surface px-4 py-3 flex items-center gap-3">
      <Icon className="w-4 h-4 text-text-tertiary shrink-0" />
      <div>
        <div className="font-semibold">{typeof value === 'number' ? value.toLocaleString() : value}</div>
        <div className="text-xs text-text-tertiary">{label}</div>
      </div>
    </div>
  )
}

function TrustCard({ org }: { org: DashboardOrganization }) {
  return (
    <Card title="Trust score">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="font-serif text-3xl font-bold">{org.trust.averageTrustScore}</span>
        <span className="text-text-tertiary text-sm">/ 100 average across your feeds</span>
      </div>
      <p className="text-sm text-text-secondary mb-5">
        Based on {org.trust.articlesAnalyzed.toLocaleString()} of your articles. Improve these to raise
        your score and how prominently your stories appear.
      </p>
      <div className="space-y-4">
        {org.trust.factors.map((f) => (
          <TrustFactorRow key={f.key} factor={f} />
        ))}
      </div>
    </Card>
  )
}

function TrustFactorRow({ factor }: { factor: TrustFactor }) {
  const barColor = factor.needsAttention ? 'bg-warning' : 'bg-success'
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1.5">
        <span className="font-medium flex items-center gap-1.5">
          {factor.needsAttention ? (
            <AlertTriangle className="w-3.5 h-3.5 text-warning" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-success" />
          )}
          {factor.label}
        </span>
        <span className="tabular-nums text-text-secondary">{factor.coveragePct}%</span>
      </div>
      <div className="h-2 rounded-full bg-elevated overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${factor.coveragePct}%` }} />
      </div>
      {factor.needsAttention && <p className="mt-1.5 text-xs text-text-tertiary">{factor.hint}</p>}
    </div>
  )
}

function FeedsCard({ org }: { org: DashboardOrganization }) {
  const [showForm, setShowForm] = useState(false)
  return (
    <Card
      title="Your feeds"
      action={
        <button
          onClick={() => setShowForm((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Submit a feed
        </button>
      }
    >
      {showForm && <DirectFeedForm orgId={org.id} onDone={() => setShowForm(false)} />}

      <div className="space-y-3">
        {org.sources.map((s) => (
          <FeedRow key={s.id} source={s} />
        ))}
        {org.sources.length === 0 && (
          <p className="text-sm text-text-tertiary py-4 text-center">
            No feeds yet. Submit your feed directly so we ingest your full articles automatically.
          </p>
        )}
      </div>
    </Card>
  )
}

function FeedRow({ source }: { source: DashboardSource }) {
  const health = source.pendingReview
    ? { label: 'Pending review', cls: 'bg-container-gold text-on-container-gold' }
    : source.sourceHealth === 'healthy'
      ? { label: 'Healthy', cls: 'bg-container-malachite text-on-container-malachite' }
      : source.consecutiveFailures > 0
        ? { label: 'Failing', cls: 'bg-container-terracotta text-on-container-terracotta' }
        : { label: source.isActive ? 'Active' : 'Inactive', cls: 'bg-elevated text-text-secondary' }

  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-elevated p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Rss className="w-4 h-4 text-text-tertiary shrink-0" />
          <span className="font-medium truncate">{source.name}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
          <span className={`rounded-full px-2 py-0.5 ${health.cls}`}>{health.label}</span>
          <span>Trust {source.trustScore}</span>
          <span>· {source.articleCount.toLocaleString()} articles</span>
          {source.feedUrl && (
            <a
              href={source.feedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-primary truncate max-w-[200px]"
            >
              feed <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
        {source.lastFetchError && !source.pendingReview && (
          <p className="mt-1 text-xs text-warning line-clamp-1">{source.lastFetchError}</p>
        )}
      </div>
    </div>
  )
}

function DirectFeedForm({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const form = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await submitDirectFeed({
        organizationId: orgId,
        feedUrl: String(form.get('feedUrl') || '').trim(),
        feedType: String(form.get('feedType') || 'rss'),
        fullContent: form.get('fullContent') === 'on',
      })
      if (res.ok) {
        setOk(true)
        router.refresh()
        setTimeout(onDone, 1200)
      } else {
        setError(res.error ?? 'Could not submit the feed.')
      }
    })
  }

  if (ok) {
    return (
      <div className="mb-4 rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm text-success flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4" />
        Feed submitted — our team will review and activate it.
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="mb-5 rounded-xl border border-elevated bg-background/40 p-4 space-y-3">
      <p className="text-sm text-text-secondary">
        Give us a direct feed and we ingest your full articles automatically — no scraping. Staff review
        it before it goes live.
      </p>
      {error && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <input
        name="feedUrl"
        type="url"
        required
        placeholder="https://yoursite.com/full-content-feed.xml"
        className="w-full rounded-lg border border-elevated bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      />
      <div className="flex flex-wrap items-center gap-3">
        <select
          name="feedType"
          defaultValue="rss"
          className="rounded-lg border border-elevated bg-background px-3 py-2 text-sm"
        >
          <option value="rss">RSS</option>
          <option value="atom">Atom</option>
          <option value="json">JSON Feed</option>
          <option value="sitemap">Sitemap</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" name="fullContent" className="accent-[var(--color-primary)]" />
          This feed carries full article content
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Submit feed
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-elevated px-4 py-2 text-sm font-medium hover:bg-elevated transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function ProfileCard({ org }: { org: DashboardOrganization }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const form = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await updatePublisherOrg(org.id, {
        name: String(form.get('name') || '').trim(),
        url: String(form.get('url') || '').trim() || null,
        description: String(form.get('description') || '').trim() || null,
      })
      if (res.ok) {
        setEditing(false)
        router.refresh()
      } else {
        setError(res.error ?? 'Could not save your changes.')
      }
    })
  }

  return (
    <Card
      title="Organization profile"
      action={
        !editing && (
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-surface border border-elevated px-3 py-1.5 text-xs font-medium hover:bg-elevated transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
        )
      }
    >
      {editing ? (
        <form onSubmit={onSubmit} className="space-y-3">
          {error && (
            <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <LabeledInput name="name" label="Name" defaultValue={org.name} required maxLength={200} />
          <LabeledInput name="url" label="Website" type="url" defaultValue={org.url ?? ''} maxLength={500} />
          <div>
            <label htmlFor="description" className="block text-sm font-medium mb-1.5">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={3}
              maxLength={2000}
              defaultValue={org.description ?? ''}
              className="w-full rounded-lg border border-elevated bg-background px-3 py-2 text-sm resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {pending && <Loader2 className="w-4 h-4 animate-spin" />}
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg border border-elevated px-4 py-2 text-sm font-medium hover:bg-elevated transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <dl className="space-y-3 text-sm">
          <Row label="Name" value={org.name} />
          <Row
            label="Website"
            value={
              org.url ? (
                <a href={org.url} target="_blank" rel="noopener noreferrer" className="text-secondary hover:underline inline-flex items-center gap-1">
                  {org.url} <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <span className="text-text-tertiary">Not set</span>
              )
            }
          />
          <Row label="Description" value={org.description || <span className="text-text-tertiary">Not set</span>} />
          <Row label="Verification" value={`Tier ${org.verificationTier} · ${org.publisherTier ?? 'verified'}`} />
        </dl>
      )}
    </Card>
  )
}

function LabeledInput({
  name,
  label,
  defaultValue,
  type = 'text',
  required,
  maxLength,
}: {
  name: string
  label: string
  defaultValue?: string
  type?: string
  required?: boolean
  maxLength?: number
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium mb-1.5">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        maxLength={maxLength}
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-elevated bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      />
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-4">
      <dt className="w-32 shrink-0 text-text-tertiary">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  )
}

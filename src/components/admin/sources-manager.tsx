'use client'

import { useState } from 'react'
import { ExternalLink, Loader2, Check, X } from 'lucide-react'
import type { AdminSource } from '@/lib/mongodb/admin'
import { setSourceActive } from '@/lib/admin/gateway'
import { COUNTRIES } from '@/lib/constants'

const countryName = (code: string) =>
  COUNTRIES.find((c) => c.code === code)?.name ?? code

interface SourcesManagerProps {
  initialSources: AdminSource[]
}

export function SourcesManager({ initialSources }: SourcesManagerProps) {
  const [sources, setSources] = useState(initialSources)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const toggle = (source: AdminSource) => {
    setBusyId(source.id)
    setNotice(null)
    const next = !source.isActive
    // Optimistic update.
    setSources((prev) =>
      prev.map((s) => (s.id === source.id ? { ...s, isActive: next } : s)),
    )

    setSourceActive(source.id, next)
      .then((res) => {
        if (!res.ok) {
          // Roll back on failure.
          setSources((prev) =>
            prev.map((s) => (s.id === source.id ? { ...s, isActive: !next } : s)),
          )
          setNotice(res.error ?? 'Could not update the source.')
        }
      })
      .finally(() => setBusyId(null))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-secondary">{sources.length} sources</p>
      </div>

      {notice && (
        <div className="mb-4 rounded-xl border border-elevated bg-surface px-4 py-3 text-sm text-foreground">
          {notice}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-elevated">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-elevated/40 text-left text-text-tertiary">
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Country</th>
              <th className="px-4 py-3 font-medium text-right">Articles</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} className="border-t border-elevated">
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{s.name}</div>
                  {s.url && /^https?:\/\//i.test(s.url) ? (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-text-tertiary hover:text-primary"
                    >
                      {s.url}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <span className="text-xs text-text-tertiary">{s.url}</span>
                  )}
                  {s.lastFetchError && (
                    <div className="text-xs text-warning mt-1">{s.lastFetchError}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-text-secondary">{countryName(s.countryCode)}</td>
                <td className="px-4 py-3 text-right text-text-secondary">
                  {s.articleCount.toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                      s.isActive
                        ? 'bg-success/10 text-success'
                        : 'bg-text-tertiary/10 text-text-tertiary'
                    }`}
                  >
                    {s.isActive ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    {s.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => toggle(s)}
                    disabled={busyId === s.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-elevated px-3 py-1.5 text-xs font-medium text-foreground hover:bg-elevated transition-colors disabled:opacity-60"
                  >
                    {busyId === s.id && <Loader2 className="w-3 h-3 animate-spin" />}
                    {s.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
            {sources.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-tertiary">
                  No sources found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

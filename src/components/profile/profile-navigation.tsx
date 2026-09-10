import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

import { DESTINATIONS, NAV_GROUPS } from '@/lib/navigation'

/**
 * Every page in the app, on the page a reader already treats as "settings".
 *
 * ## Why it is here rather than only in the footer
 *
 * On a phone, `/profile` is what the fifth slot of the bottom bar opens, which
 * makes it the deepest a reader can get in one tap — and the app had nothing at
 * that destination that led anywhere else. The bottom bar shows five of sixteen
 * destinations; the footer carries the rest but sits below the whole page and
 * is suppressed on the immersive feed. So this is the canonical "where can I
 * go" surface: one tap from anywhere, and complete.
 *
 * Both are generated from the same `DESTINATIONS` list, so they cannot disagree
 * with each other or fall behind the routes that exist.
 *
 * `needsAccount` destinations are listed for everyone. Hiding them would mean a
 * signed-out reader could not discover the feature exists; the page itself
 * sends them to sign-in, and the note here says so first rather than letting
 * the redirect be a surprise.
 */
export function ProfileNavigation({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <nav aria-label="All pages" className="mb-6">
      {NAV_GROUPS.map((group) => {
        const items = DESTINATIONS.filter((d) => d.group === group.id)
        if (items.length === 0) return null

        return (
          <div
            key={group.id}
            className="mb-4 overflow-hidden rounded-2xl border border-outline bg-surface last:mb-0"
          >
            <h2 className="border-b border-elevated px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary">
              {group.label}
            </h2>
            <ul>
              {items.map((d) => {
                const Icon = d.icon
                return (
                  <li key={d.href} className="border-b border-elevated last:border-b-0">
                    <Link
                      href={d.href}
                      className="flex items-center justify-between gap-3 px-4 py-4 transition-colors hover:bg-elevated"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <Icon className="h-5 w-5 shrink-0 text-secondary" aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block font-medium">{d.label}</span>
                          <span className="block text-xs text-text-tertiary">
                            {d.needsAccount && !signedIn ? 'Sign in to use — ' : ''}
                            {d.description}
                          </span>
                        </span>
                      </span>
                      <ChevronRight
                        className="h-4 w-4 shrink-0 text-text-tertiary"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}

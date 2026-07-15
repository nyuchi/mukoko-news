import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ShieldAlert, LayoutDashboard, Radio, Newspaper, BadgeCheck } from 'lucide-react'
import { withAuth } from '@workos-inc/authkit-nextjs'
import { resolveTier, canAccessAdmin, TIER_LABELS } from '@/lib/auth/roles'
import { AdminSignOut } from '@/components/admin/admin-sign-out'

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s | Mukoko Admin' },
  robots: { index: false, follow: false },
}

const ADMIN_NAV = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/sources', label: 'Sources', icon: Radio },
  { href: '/admin/articles', label: 'Moderation', icon: Newspaper },
  { href: '/admin/publishers', label: 'Publishers', icon: BadgeCheck },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, organizationId, role, permissions } = await withAuth()

  // Not signed in → the hosted AuthKit flow via /sign-in (owner doctrine
  // 2026-07-09: hosted sign-in is primary; it owns MFA and the shared session).
  if (!user) {
    redirect(`/sign-in?returnTo=${encodeURIComponent('/admin')}`)
  }

  const tier = resolveTier({ organizationId, role, permissions })

  // Signed in but not a moderator/admin → access denied.
  if (!canAccessAdmin(tier)) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md rounded-2xl border border-elevated bg-surface p-8 text-center">
          <div className="w-16 h-16 bg-warning/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-8 h-8 text-warning" />
          </div>
          <h1 className="font-serif text-2xl font-bold mb-2">Access denied</h1>
          <p className="text-text-secondary mb-6">
            You are signed in as{' '}
            <span className="font-medium text-foreground">{user.email}</span>, but this
            account does not have admin access. Contact a platform administrator if you
            believe this is a mistake.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              href="/"
              className="px-5 py-2.5 bg-surface border border-elevated text-foreground font-medium rounded-xl hover:bg-elevated transition-colors"
            >
              Back to news
            </Link>
            <AdminSignOut />
          </div>
        </div>
      </div>
    )
  }

  return (
    // Mzizi density: admin is a data-dense surface — compact opt-in.
    <div data-density="compact" className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6">
      {/* Admin top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 pb-4 border-b border-elevated">
        <nav className="flex items-center gap-1">
          {ADMIN_NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-foreground hover:bg-elevated transition-colors"
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-text-tertiary">
            {user.email} ·{' '}
            <span className="font-medium text-primary">{TIER_LABELS[tier]}</span>
          </span>
          <AdminSignOut />
        </div>
      </div>

      {children}
    </div>
  )
}

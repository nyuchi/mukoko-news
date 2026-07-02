import Link from 'next/link'
import { ArrowLeft, Users } from 'lucide-react'

export const metadata = { title: 'Users' }

// Server Component — there is no user directory wired up yet, so this page
// shows an honest empty state instead of fabricated users. RBAC gating lives
// in src/app/admin/layout.tsx and is unchanged.
export default function AdminUsersPage() {
  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/admin"
          className="w-10 h-10 flex items-center justify-center rounded-full bg-surface hover:bg-elevated transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Users</h1>
          <p className="text-text-secondary">Platform user management</p>
        </div>
      </div>

      {/* Honest empty state — no user data source is wired up yet */}
      <div className="bg-surface rounded-xl border border-elevated p-12 flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Users className="w-7 h-7 text-primary" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">Coming soon</h2>
        <p className="text-sm text-text-secondary max-w-md">
          User management arrives with the WorkOS directory sync — coming soon. Until then, roles
          and org membership are managed directly in the WorkOS dashboard.
        </p>
      </div>
    </div>
  )
}

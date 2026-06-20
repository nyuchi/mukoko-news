'use client'

import { useTransition } from 'react'
import { LogOut, Loader2 } from 'lucide-react'
import { signOutInline } from '@/lib/auth/actions'

/** Inline sign-out button — clears the AuthKit session cookie server-side. */
export function AdminSignOut() {
  const [isPending, startTransition] = useTransition()

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(() => signOutInline())}
      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface border border-elevated text-foreground text-sm font-medium hover:bg-elevated transition-colors disabled:opacity-60"
    >
      {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
      Sign out
    </button>
  )
}

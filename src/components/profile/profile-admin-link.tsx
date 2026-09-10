'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, ChevronRight } from 'lucide-react';
import { getMyAdminAccessAction, type AdminAccess } from '@/lib/actions/admin-access';

/**
 * The staff entry point to `/admin`, shown on `/profile`.
 *
 * WHY THIS RATHER THAN AN "ADMIN" SECTION IN SETTINGS
 * ---------------------------------------------------
 * There is already a separate admin app at `/admin` — seven pages with their own
 * layout, their own nav, and `noindex` metadata, gated by
 * `src/app/admin/layout.tsx`. Duplicating any of it as a subsection of `/profile`
 * would mean two places that grant staff powers, and the settings page is a
 * client component while the gate is deliberately server-side. So the gap was
 * never a missing section: it was that **nothing in the app linked to `/admin`
 * at all**. A staff member had to know the URL.
 *
 * Renders nothing for everyone else — including when the read fails, since the
 * action is fail-soft. That is the same rule the organizations card follows: an
 * unproven answer must not be rendered as a proven one, and here the safe
 * direction is to omit the link.
 *
 * The link is not access. `/admin` re-derives the tier from the verified session
 * on every request, so hiding or showing this changes what a person *sees*, never
 * what they can *reach*.
 */
export function ProfileAdminLink() {
  const [access, setAccess] = useState<AdminAccess | null>(null);

  useEffect(() => {
    let active = true;
    getMyAdminAccessAction()
      .then((result) => {
        if (active) setAccess(result);
      })
      .catch(() => {
        if (active) setAccess(null);
      });
    return () => {
      active = false;
    };
  }, []);

  // No skeleton: this is chrome for a small minority of accounts, and a
  // placeholder that resolves to nothing for most readers is a layout shift on
  // every profile load.
  if (!access?.canAccessAdmin) return null;

  return (
    <div className="bg-surface border border-outline rounded-2xl overflow-hidden mb-6">
      <Link
        href="/admin"
        className="flex items-center gap-3 px-4 py-4 hover:bg-elevated transition-colors"
      >
        <div className="w-9 h-9 shrink-0 bg-container-sodalite rounded-full flex items-center justify-center">
          <ShieldCheck className="w-4 h-4 text-on-container-sodalite" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="font-medium block">Admin console</span>
          <span className="text-xs text-text-secondary">
            Signed in with {access.tierLabel} access
          </span>
        </div>
        <ChevronRight className="w-5 h-5 text-text-tertiary shrink-0" aria-hidden="true" />
      </Link>
    </div>
  );
}

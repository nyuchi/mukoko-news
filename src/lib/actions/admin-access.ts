'use server';

import { withAuth } from '@workos-inc/authkit-nextjs';
import { resolveTier, canAccessAdmin, TIER_LABELS, type Tier } from '@/lib/auth/roles';

/**
 * Does the signed-in caller have staff access, and at what tier.
 *
 * WHY A SERVER ACTION
 * -------------------
 * `/profile` is a client component, and the tier is derived from the *verified*
 * WorkOS session claims — `organizationId`, `role`, `permissions` — which
 * `useAuth()` does not expose to the client. Deriving it client-side would mean
 * shipping those claims and trusting the browser's reading of them.
 *
 * THIS IS NOT A GATE
 * ------------------
 * It decides whether to render a *link*. `/admin` is gated by
 * `src/app/admin/layout.tsx`, which performs its own `withAuth()` +
 * `resolveTier()` on every request — so a caller who forges a `true` here
 * gains a link to a page that still refuses them. The two must stay
 * independent: if this ever became the gate, an XSS or a patched client would
 * be an admin escalation.
 *
 * Fail-soft to `none`, matching the entity-membership reader: an unproven tier
 * hides the link rather than showing one that would 403.
 */
export interface AdminAccess {
  canAccessAdmin: boolean;
  tier: Tier;
  tierLabel: string;
}

const DENIED: AdminAccess = {
  canAccessAdmin: false,
  tier: 'none',
  tierLabel: TIER_LABELS.none,
};

export async function getMyAdminAccessAction(): Promise<AdminAccess> {
  try {
    const { user, organizationId, role, permissions } = await withAuth();
    if (!user) return DENIED;

    const tier = resolveTier({ organizationId, role, permissions });
    return {
      canAccessAdmin: canAccessAdmin(tier),
      tier,
      tierLabel: TIER_LABELS[tier],
    };
  } catch {
    return DENIED;
  }
}

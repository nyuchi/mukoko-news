'use server';

import { resolveTier, canAccessAdmin } from '@/lib/auth/roles';
import { idSchema } from '@/lib/safety';
import { getArticleProvenance, type ArticleProvenance } from '@/lib/mongodb/article-metrics';

/**
 * Pipeline provenance for one article — staff only.
 *
 * ## Why this is an action and not part of the page payload
 *
 * `/article/[id]` is ISR-cached (`revalidate = 300`) precisely because nothing
 * in it reads `cookies()`/`headers()`. Calling `withAuth()` in that page would
 * opt EVERY article view — for every anonymous reader on a metered African
 * mobile connection — into dynamic rendering, to decorate a panel almost none
 * of them can see. So the reader-facing metrics ride the cached `Article`, and
 * the staff panel is fetched on demand by the small number of callers entitled
 * to it. The cached HTML never contains a single provenance value.
 *
 * ## This IS the gate
 *
 * Unlike `getMyAdminAccessAction` — which only decides whether to draw a link
 * to a page that re-gates itself — nothing downstream re-checks this one, so
 * it must be right here. The tier is derived from the VERIFIED WorkOS session
 * claims (`organizationId`, `role`, `permissions`), never from an argument and
 * never from the client: `useAuth()` does not expose those claims, and a
 * client that decided its own tier would be deciding its own access.
 *
 * Fail-soft is `null` in every direction — an unproven tier sees nothing, and
 * a failed read is reported as no data rather than as an empty provenance
 * (which would render as a set of confident absences).
 */
export async function getArticleProvenanceAction(
  articleId: string
): Promise<ArticleProvenance | null> {
  // Server Actions are a public RPC surface: the id is caller-controlled and is
  // validated before it reaches a query, like every other action in this repo.
  const parsed = idSchema.safeParse(articleId);
  if (!parsed.success) return null;

  try {
    // Lazy import, following `lib/engagement.ts`: authkit is a server-only
    // module. This action is imported by a CLIENT component (the article page's
    // metrics panel), so pulling the whole AuthKit server chain at module load
    // would put it in the article route's import graph — where it does not
    // resolve, and where nothing needs it until a staff caller actually asks.
    const { withAuth } = await import('@workos-inc/authkit-nextjs');
    const { user, organizationId, role, permissions } = await withAuth();
    if (!user) return null;
    if (!canAccessAdmin(resolveTier({ organizationId, role, permissions }))) return null;
  } catch {
    return null;
  }

  try {
    return await getArticleProvenance(parsed.data);
  } catch (err) {
    console.error('[article-metrics] provenance read failed:', err);
    return null;
  }
}

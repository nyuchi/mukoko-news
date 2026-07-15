import type { Db } from 'mongodb'

// ── Engagement subject keys ──────────────────────────────────────────────────
//
// articleSaves / articleLikes documents are keyed by a `sessionId` string. For
// anonymous visitors that is the `mukoko_session` cookie value; for signed-in
// users it is a stable `user:<workos-user-id>` key, which is what makes saves
// and likes follow the account across devices. The field name stays
// `sessionId` (the gateway and pipeline treat it as an opaque subject key and
// only ever aggregate by articleId), and the `user:` prefix keeps the two key
// spaces from ever colliding.

export const USER_KEY_PREFIX = 'user:'

export function userEngagementKey(userId: string): string {
  return `${USER_KEY_PREFIX}${userId}`
}

export interface EngagementSubject {
  /** Subject key to store/query with, or null when anonymous with no cookie. */
  key: string | null
  /** True when the key is the signed-in user's stable key. */
  isUser: boolean
}

/**
 * Resolve who is engaging: the WorkOS user when signed in, else the anonymous
 * cookie session. `withAuth()` failures degrade to anonymous — an auth
 * misconfig must never break public engagement.
 */
export async function resolveEngagementSubject(
  cookieSessionId: string | undefined
): Promise<EngagementSubject> {
  try {
    // Lazy import: authkit is a server-only module — loading it at call time
    // keeps this file importable from anything that transitively touches the
    // actions layer (tests, client bundles that tree-shake the call away).
    const { withAuth } = await import('@workos-inc/authkit-nextjs')
    const { user } = await withAuth()
    if (user) return { key: userEngagementKey(user.id), isUser: true }
  } catch (err) {
    console.error('[ENGAGEMENT] withAuth() failed; treating as anonymous', err)
  }
  return { key: cookieSessionId ?? null, isUser: false }
}

const CLAIMABLE_COLLECTIONS = ['articleSaves', 'articleLikes'] as const

/**
 * Claim anonymous cookie-keyed engagement for the signed-in user: re-key
 * non-conflicting docs to the user key, then drop whatever remains under the
 * cookie key (overlaps where the user already saved/liked the same article —
 * the user doc wins). Idempotent and best-effort: a partial failure converges
 * on the next signed-in interaction, and errors never propagate to the caller.
 */
export async function claimSessionEngagement(
  db: Db,
  cookieSessionId: string,
  userKey: string
): Promise<void> {
  if (!cookieSessionId || cookieSessionId === userKey) return
  for (const name of CLAIMABLE_COLLECTIONS) {
    try {
      const col = db.collection(name)
      const owned = await col
        .find({ sessionId: userKey }, { projection: { articleId: 1 } })
        .map((d) => d.articleId as string)
        .toArray()
      await col.updateMany(
        {
          sessionId: cookieSessionId,
          ...(owned.length > 0 ? { articleId: { $nin: owned } } : {}),
        },
        { $set: { sessionId: userKey } }
      )
      await col.deleteMany({ sessionId: cookieSessionId })
    } catch (err) {
      console.error(`[ENGAGEMENT] claiming ${name} for user failed`, err)
    }
  }
}

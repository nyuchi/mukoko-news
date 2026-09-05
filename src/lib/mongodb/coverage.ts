/**
 * Which countries the corpus can actually serve a reader right now.
 *
 * The onboarding modal used to offer `COUNTRIES.slice(0, 4)` — the first four
 * entries of a hand-ordered constant, which is the "East Africa" block at the
 * top of the array rather than anything about coverage. Measured on the live
 * corpus that meant a new reader was offered Tanzania (653 articles, 368 in the
 * last 30 days) while Nigeria — 13,518 articles, 8,648 of them in the last 30
 * days, the single largest country in the corpus — was not on the list at all.
 * Together the three busiest countries (NG, ZA, GH) are over half the corpus and
 * none of them appeared.
 *
 * Ranking by RECENT volume rather than all-time is deliberate: a country whose
 * sources have since gone dark still carries a large historical count, and
 * offering it would promise a feed the platform cannot currently fill.
 */

import { getDb } from './client'
import { clampInt } from '@/lib/safety'

export interface CoveredCountry {
  code: string
  /** Articles published in the window. */
  recent: number
}

/**
 * Country codes ordered by article volume over the last `days`.
 *
 * Fail-soft like every other read here: an unreachable cluster yields an empty
 * list and the caller falls back to a static set, because an onboarding step
 * with no options at all is worse than one with stale options.
 */
export async function getTopCountriesByRecentVolume(
  limit = 6,
  days = 30
): Promise<CoveredCountry[]> {
  limit = clampInt(limit, 1, 24, 6)
  days = clampInt(days, 1, 365, 30)
  try {
    const db = await getDb()
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const rows = await db
      .collection('articles')
      .aggregate<{ _id: string; recent: number }>([
        {
          $match: {
            status: { $ne: 'rejected' },
            moderationStatus: { $ne: 'removed' },
            datePublished: { $gte: since },
            countryCode: { $type: 'string', $ne: '' },
          },
        },
        { $group: { _id: '$countryCode', recent: { $sum: 1 } } },
        { $sort: { recent: -1 } },
        { $limit: limit },
      ])
      .toArray()

    return rows.map((r) => ({ code: String(r._id).trim().toUpperCase(), recent: r.recent }))
  } catch (error) {
    console.error('[coverage.getTopCountriesByRecentVolume]', error)
    return []
  }
}

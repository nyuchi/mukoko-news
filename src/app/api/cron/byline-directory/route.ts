import { timingSafeEqual } from 'node:crypto'

import { NextResponse, type NextRequest } from 'next/server'

import { getBylineDirectory } from '@/lib/mongodb/authors'
import { publishBylineDirectory } from '@/lib/mongodb/byline-directory'

/**
 * Rebuild the byline directory snapshot. The scan lives HERE, not on a read.
 *
 * `getBylineDirectory()` is the platform's slowest query — 11,057 ms warm on
 * the live cluster, a covered `IXSCAN` over ~58,700 keys that the M20's two
 * burstable vCPU simply take that long to walk. It used to run on whichever
 * reader arrived after the hour-long `unstable_cache` expired. It now runs
 * here, on a schedule, with nobody waiting for it, and every author page reads
 * the result by slug in a single `_id` lookup.
 *
 * ## Why this is a Route Handler and not a Server Action
 *
 * Vercel Cron invokes a URL. It sends `Authorization: Bearer $CRON_SECRET` and
 * a `user-agent` of `vercel-cron/1.0`, neither of which a Server Action can be
 * addressed with.
 *
 * ## Authorisation
 *
 * ⚠️ **This endpoint writes to the database, so it is authenticated by a shared
 * secret and by nothing else.** The UA header is not a check — it is trivially
 * spoofed — and there is deliberately no fallback that lets the route run when
 * `CRON_SECRET` is unset: a missing secret answers **503**, never "allow". An
 * open rebuild endpoint is a 11-second cluster query anyone on the internet can
 * fire in a loop, which is a denial-of-service knob pointed at the whole
 * platform, not just at `/author`.
 *
 * The comparison is length-safe and constant-time-ish via `timingSafeEqual`;
 * `runtime = 'nodejs'` is what makes `node:crypto` available here.
 *
 * ## Answers, and why a refusal is not a failure
 *
 * | outcome              | status | meaning                                        |
 * | -------------------- | ------ | ---------------------------------------------- |
 * | published            | 200    | the snapshot is new                            |
 * | `source-unavailable` | 503    | the corpus read failed; snapshot left as it was |
 * | `empty-build`        | 409    | build found nothing over a populated snapshot   |
 *
 * The last two are **refusals to destroy a working directory**, and they are
 * error codes rather than a cheerful 200 so that a cron that has started
 * failing is visible in Vercel's log instead of looking like a successful
 * no-op. See `@/lib/mongodb/byline-directory` for why an empty build is not
 * allowed to overwrite a populated snapshot.
 */
export const runtime = 'nodejs'

/**
 * Long enough for the build, which is the entire point of moving it here.
 *
 * `getBylineDirectory` is bounded at `QUERY_MAX_TIME_MS` (15 s) and measured at
 * 11 s; the write of ~5,400 rows follows it. 60 s leaves room for both and is
 * at or below the cap on every Vercel plan. This budget is a ceiling, not an
 * expectation — the same reasoning as `/author/[...slug]`.
 */
export const maxDuration = 60

/** Never cached, never prerendered: it is a write, and it must run when called. */
export const dynamic = 'force-dynamic'

/**
 * Compare a presented token against the secret without leaking its length or
 * its content through timing. `timingSafeEqual` throws on a length mismatch, so
 * the lengths are checked first and a mismatch fails before it is called.
 */
function authorized(request: NextRequest, secret: string): boolean {
  const presented = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    // Unset secret is a misconfiguration, not an invitation. Answering 503
    // rather than running keeps an unprotected rebuild off the internet.
    console.error('[/api/cron/byline-directory] CRON_SECRET is not set')
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }
  if (!authorized(request, secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const { ok, bylines } = await getBylineDirectory()
  const readMs = Date.now() - startedAt

  const outcome = await publishBylineDirectory(bylines, ok)
  const totalMs = Date.now() - startedAt

  const body = { ...outcome, bylines: bylines.length, readMs, totalMs }

  if (!outcome.published) {
    console.error('[/api/cron/byline-directory] refused', body)
    return NextResponse.json(body, {
      status: outcome.reason === 'source-unavailable' ? 503 : 409,
    })
  }

  console.log('[/api/cron/byline-directory] published', body)
  return NextResponse.json(body)
}

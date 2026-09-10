import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getRequestIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// A Report-Only CSP whose reports go nowhere is theatre: violations land in the
// console of a reader's phone in Harare, where nobody will ever read them. This
// is the collector `report-uri` / `report-to` point at, so the policy in
// src/lib/security-headers.ts can actually be promoted to enforcing on
// evidence rather than on hope.
//
// It is a public, unauthenticated POST endpoint by necessity (the browser sends
// the report, not the app), so it is deliberately dumb: rate-limited per IP,
// body capped, output truncated, and it never touches the database.
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000

/** Reports larger than this are dropped unread — a violation report is small. */
const MAX_BODY_BYTES = 16_384

/** Cap on any single field written to the log line. */
const MAX_FIELD_CHARS = 300

function clip(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > MAX_FIELD_CHARS ? `${trimmed.slice(0, MAX_FIELD_CHARS)}…` : trimmed
}

interface Violation {
  documentUri?: string
  directive?: string
  blockedUri?: string
  disposition?: string
}

/**
 * Normalise both wire formats into one shape:
 *  - `application/csp-report`  → `{ "csp-report": { "document-uri", … } }`
 *  - `application/reports+json` → `[{ type: "csp-violation", body: { documentURL, … } }]`
 */
function extractViolations(payload: unknown): Violation[] {
  if (Array.isArray(payload)) {
    return payload
      .filter(
        (entry): entry is { type?: string; body?: Record<string, unknown> } =>
          !!entry && typeof entry === 'object'
      )
      .filter((entry) => entry.type === 'csp-violation' || entry.type === undefined)
      .map((entry) => {
        const body = entry.body ?? {}
        return {
          documentUri: clip(body.documentURL),
          directive: clip(body.effectiveDirective),
          blockedUri: clip(body.blockedURL),
          disposition: clip(body.disposition),
        }
      })
  }

  if (payload && typeof payload === 'object') {
    const report = (payload as Record<string, unknown>)['csp-report']
    if (report && typeof report === 'object') {
      const body = report as Record<string, unknown>
      return [
        {
          documentUri: clip(body['document-uri']),
          directive: clip(body['effective-directive']) ?? clip(body['violated-directive']),
          blockedUri: clip(body['blocked-uri']),
          disposition: clip(body['disposition']),
        },
      ]
    }
  }

  return []
}

export async function POST(request: NextRequest) {
  const ip = getRequestIp(request)
  if (!(await checkRateLimit(`csp-report:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS))) {
    // 429 rather than 204 so the volume is itself visible in the platform logs.
    return new NextResponse(null, {
      status: 429,
      headers: { 'Retry-After': String(RATE_LIMIT_WINDOW_MS / 1000) },
    })
  }

  try {
    const raw = await request.text()
    if (raw.length > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 413 })
    }

    const violations = extractViolations(JSON.parse(raw))
    for (const v of violations) {
      // One compact line per violation — greppable in the Vercel runtime logs.
      console.warn(
        `[CSP] ${v.disposition ?? 'report'} ${v.directive ?? 'unknown-directive'} ` +
          `blocked=${v.blockedUri ?? 'unknown'} on=${v.documentUri ?? 'unknown'}`
      )
    }
  } catch {
    // Malformed or non-JSON body: drop it. A reporting endpoint must never be
    // a source of errors — it exists to observe, not to participate.
  }

  // 204 regardless: browsers ignore the response, and a non-2xx would only
  // invite retries.
  return new NextResponse(null, { status: 204 })
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/csp-report/route'
import { checkRateLimit } from '@/lib/rate-limit'

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => true),
  getRequestIp: () => '198.51.100.7',
}))

const mockedCheckRateLimit = vi.mocked(checkRateLimit)

function post(body: string, contentType = 'application/csp-report') {
  return new NextRequest('https://news.mukoko.com/api/csp-report', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  })
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  mockedCheckRateLimit.mockResolvedValue(true)
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
  vi.clearAllMocks()
})

describe('POST /api/csp-report', () => {
  it('accepts the report-uri wire format and logs one greppable line', async () => {
    const res = await POST(
      post(
        JSON.stringify({
          'csp-report': {
            'document-uri': 'https://news.mukoko.com/article/abc',
            'effective-directive': 'script-src-elem',
            'blocked-uri': 'https://evil.example/x.js',
            disposition: 'report',
          },
        })
      )
    )

    expect(res.status).toBe(204)
    expect(warn).toHaveBeenCalledTimes(1)
    const line = String(warn.mock.calls[0][0])
    expect(line).toContain('[CSP]')
    expect(line).toContain('script-src-elem')
    expect(line).toContain('https://evil.example/x.js')
    expect(line).toContain('https://news.mukoko.com/article/abc')
  })

  it('accepts the modern Reporting API wire format', async () => {
    const res = await POST(
      post(
        JSON.stringify([
          {
            type: 'csp-violation',
            body: {
              documentURL: 'https://news.mukoko.com/',
              effectiveDirective: 'img-src',
              blockedURL: 'http://insecure.example/a.png',
              disposition: 'report',
            },
          },
        ]),
        'application/reports+json'
      )
    )

    expect(res.status).toBe(204)
    expect(String(warn.mock.calls[0][0])).toContain('img-src')
  })

  it('rate-limits per IP rather than accepting unbounded reports', async () => {
    mockedCheckRateLimit.mockResolvedValue(false)
    const res = await POST(post('{}'))

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(warn).not.toHaveBeenCalled()
  })

  it('drops an oversized body unread', async () => {
    const res = await POST(post(JSON.stringify({ pad: 'x'.repeat(20_000) })))

    expect(res.status).toBe(413)
    expect(warn).not.toHaveBeenCalled()
  })

  it('swallows malformed bodies — a reporting endpoint never errors', async () => {
    const res = await POST(post('not json at all'))

    expect(res.status).toBe(204)
    expect(warn).not.toHaveBeenCalled()
  })

  it('truncates hostile field lengths instead of logging them whole', async () => {
    await POST(
      post(
        JSON.stringify({
          'csp-report': {
            'document-uri': `https://news.mukoko.com/${'a'.repeat(5000)}`,
            'effective-directive': 'script-src',
            'blocked-uri': 'inline',
          },
        })
      )
    )

    const line = String(warn.mock.calls[0][0])
    expect(line.length).toBeLessThan(1200)
    expect(line).toContain('…')
  })

  it('never touches the database', async () => {
    // The route imports nothing from @/lib/mongodb — a report is a log line,
    // not a write. This keeps a public unauthenticated POST off the cluster.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('src/app/api/csp-report/route.ts', 'utf8')
    )
    expect(source).not.toContain('mongodb')
  })
})

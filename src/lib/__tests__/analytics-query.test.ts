/**
 * Direct tests for the /analytics data layer.
 *
 * The page test mocks the Server Actions and asserts on rendered UI, so it
 * cannot see any of this — which is exactly why the reversed-range bug and the
 * dropped export filters shipped past a green CI. These exercise the pure
 * functions with no database.
 */

import { describe, it, expect } from 'vitest'
import { normalizeQuery, DEFAULT_WINDOW_DAYS, MAX_WINDOW_DAYS } from '@/lib/mongodb/analytics'

describe('normalizeQuery', () => {
  describe('date window', () => {
    it('honours an explicit range', () => {
      const q = normalizeQuery({ from: '2026-08-01', to: '2026-08-15' })
      expect(q.from).toBe('2026-08-01')
      expect(q.to).toBe('2026-08-15')
      expect(q.days).toBe(15)
    })

    it('swaps a reversed range instead of discarding it', () => {
      // Regression: this used to reset to the default 30-day window, so a
      // request for Aug 1-15 silently returned Jul 3 - Aug 1 — not the range
      // asked for, and not obviously wrong on screen either.
      const q = normalizeQuery({ from: '2026-08-15', to: '2026-08-01' })
      expect(q.from).toBe('2026-08-01')
      expect(q.to).toBe('2026-08-15')
    })

    it('defaults to the last 30 days when no range is given', () => {
      const q = normalizeQuery({})
      expect(q.days).toBe(DEFAULT_WINDOW_DAYS)
    })

    it('caps a span wider than the maximum', () => {
      const q = normalizeQuery({ from: '2000-01-01', to: '2026-08-31' })
      expect(q.days).toBeLessThanOrEqual(MAX_WINDOW_DAYS)
      expect(q.to).toBe('2026-08-31')
    })

    it('ignores a malformed or impossible date rather than throwing', () => {
      expect(normalizeQuery({ from: 'not-a-date' }).days).toBe(DEFAULT_WINDOW_DAYS)
      expect(normalizeQuery({ from: '2026-13-45' }).days).toBe(DEFAULT_WINDOW_DAYS)
      expect(normalizeQuery({ to: '15-08-2026' }).days).toBe(DEFAULT_WINDOW_DAYS)
    })
  })

  describe('filters', () => {
    it('upper-cases and de-duplicates country codes', () => {
      expect(normalizeQuery({ countries: ['zw', 'ZW', 'za'] }).countries).toEqual(['ZW', 'ZA'])
    })

    it('drops country codes that are not two letters', () => {
      expect(normalizeQuery({ countries: ['ZW', 'ZWE', '1', ''] }).countries).toEqual(['ZW'])
    })

    it('lower-cases category slugs and drops invalid ones', () => {
      expect(normalizeQuery({ categories: ['Transport', 'bad slug!', 'health'] }).categories).toEqual(
        ['transport', 'health']
      )
    })

    it('keeps only recognised sentiment values', () => {
      const q = normalizeQuery({
        sentiments: ['positive', 'furious', 'mixed'] as never,
      })
      expect(q.sentiments).toEqual(['positive', 'mixed'])
    })

    it('caps list filters so one query cannot carry an unbounded set', () => {
      const many = Array.from({ length: 50 }, (_, i) => `c${i}`)
      expect(normalizeQuery({ sources: many }).sources.length).toBeLessThanOrEqual(20)
    })

    it('clamps minQuality into 0..1 and rejects non-numbers', () => {
      expect(normalizeQuery({ minQuality: 5 }).minQuality).toBe(1)
      expect(normalizeQuery({ minQuality: -2 }).minQuality).toBe(0)
      expect(normalizeQuery({ minQuality: NaN }).minQuality).toBeNull()
      expect(normalizeQuery({}).minQuality).toBeNull()
    })

    it('treats an empty or whitespace term as no term', () => {
      expect(normalizeQuery({ q: '   ' }).q).toBeNull()
      expect(normalizeQuery({}).q).toBeNull()
    })

    it('truncates an over-long term rather than passing it through', () => {
      expect(normalizeQuery({ q: 'x'.repeat(500) }).q).toHaveLength(200)
    })
  })
})

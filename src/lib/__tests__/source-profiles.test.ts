import { describe, expect, it } from 'vitest'

import {
  getExactProfileDomain,
  getSourceColors,
  getSourceInitials,
  getSourceProfile,
} from '@/lib/source-profiles'

/**
 * A source profile carries publisher IDENTITY — the logo domain, the brand
 * colour, and the initials printed on the avatar. `getSourceProfile` resolves a
 * name against a ~20-row brand table and, failing an exact hit, falls through to
 * a SUBSTRING test. Measured against the live catalogue that matched 38 of 587
 * sources and got 11 of those wrong, because a substring cannot tell one
 * masthead from another.
 *
 * The four below are the measured cases. Each is a real, separate newsroom being
 * given another newsroom's identity — the same class of error as an article
 * declaring the wrong `publisher`, and just as visible to a reader: a Gambian
 * paper rendered in a Zimbabwean paper's navy under the letters "TS".
 *
 * These tests pin the accessors to EXACT matching. They deliberately do not pin
 * `getSourceProfile` itself, which keeps its historical behaviour for any caller
 * that wants a best-effort name guess rather than an identity.
 */
const MISATTRIBUTED = [
  { name: 'National Geographic', stolenFrom: 'Nation', wrongInitials: 'N', wrongPrimary: '#d32f2f' },
  {
    name: 'Amnesty International',
    stolenFrom: 'Nation',
    wrongInitials: 'N',
    wrongPrimary: '#d32f2f',
  },
  {
    name: 'The Standard Newspaper | Gambia',
    stolenFrom: 'The Standard',
    wrongInitials: 'TS',
    wrongPrimary: '#2c3e50',
  },
  {
    name: 'The Patriotic Vanguard',
    stolenFrom: 'Vanguard',
    wrongInitials: 'V',
    wrongPrimary: '#2e7d32',
  },
] as const

describe('source identity is never borrowed from another publisher', () => {
  it.each(MISATTRIBUTED)(
    '$name does not wear $stolenFrom’s initials or colour',
    ({ name, wrongInitials, wrongPrimary }) => {
      expect(getSourceInitials(name)).not.toBe(wrongInitials)
      expect(getSourceColors(name).primary).not.toBe(wrongPrimary)
      expect(getExactProfileDomain(name)).toBeNull()
    }
  )

  it.each(MISATTRIBUTED)('$name gets initials generated from its own name', ({ name }) => {
    const initials = getSourceInitials(name)
    const firstLetters = name
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .map((w) => w[0].toUpperCase())
      .join('')
    expect(initials).toBe(firstLetters)
  })

  it('the substring matcher that caused this is still reachable, and still wrong', () => {
    // Documents the mechanism rather than endorsing it: if a future change makes
    // `getSourceProfile` exact too, this test fails and should simply be deleted
    // along with the fallthrough.
    expect(getSourceProfile('National Geographic').name).toBe('Nation')
  })
})

describe('a real brand still resolves to its own identity', () => {
  it.each([
    ['The Herald', 'TH', '#0066cc', 'herald.co.zw'],
    ['NewsDay', 'ND', '#f39c12', 'newsday.co.zw'],
    ['ZimLive', 'ZL', '#e74c3c', 'zimlive.com'],
  ])('%s keeps its brand initials, colour and domain', (name, initials, primary, domain) => {
    expect(getSourceInitials(name)).toBe(initials)
    expect(getSourceColors(name).primary).toBe(primary)
    expect(getExactProfileDomain(name)).toBe(domain)
  })

  it('matches case-insensitively, because feed names are not normalised', () => {
    expect(getExactProfileDomain('the herald')).toBe('herald.co.zw')
    expect(getSourceInitials('THE HERALD')).toBe('TH')
  })

  it('trims, because a feed title can carry trailing whitespace', () => {
    expect(getExactProfileDomain('  The Herald  ')).toBe('herald.co.zw')
  })
})

describe('degenerate input', () => {
  it('an empty name yields a question mark, not a borrowed identity', () => {
    expect(getSourceInitials('')).toBe('?')
    expect(getExactProfileDomain('')).toBeNull()
    expect(getExactProfileDomain(null)).toBeNull()
    expect(getExactProfileDomain(undefined)).toBeNull()
  })

  it('an unknown publisher gets a stable colour derived from its own name', () => {
    const first = getSourceColors('Some Outlet Nobody Has Heard Of')
    const second = getSourceColors('Some Outlet Nobody Has Heard Of')
    expect(first).toEqual(second)
    expect(first.primary).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

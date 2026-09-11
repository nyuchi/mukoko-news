import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { canAccess, lockedFeatures, planFor, type Feature, type Plan } from '@/lib/access'

describe('planFor', () => {
  it('is anonymous signed out and free signed in', () => {
    expect(planFor(false)).toBe('anonymous')
    expect(planFor(true)).toBe('free')
  })

  it('cannot return subscriber, because nothing can prove one', () => {
    // There is no billing in this platform — no plan field, no webhook, no
    // checkout. A tier that something could CLAIM but nothing could verify is
    // worse than the gap: the obvious "source" would be a field on
    // identity/entity, which the gateway's WorkOS webhook writes and Mongo's
    // validators accept unknown keys into. That would make every writer to
    // those databases an authority on who has paid.
    expect([planFor(true), planFor(false)]).not.toContain('subscriber')
  })
})

describe('canAccess', () => {
  it('lets a signed-in reader reach the gated features', () => {
    expect(canAccess('ai-summary', 'free')).toBe(true)
    expect(canAccess('analytics-console', 'free')).toBe(true)
  })

  it('denies an anonymous reader', () => {
    expect(canAccess('ai-summary', 'anonymous')).toBe(false)
    expect(canAccess('analytics-console', 'anonymous')).toBe(false)
  })

  it('lets a higher plan reach everything a lower one can', () => {
    // The ordering is the whole point of a rank rather than a set: a
    // subscriber must never be refused something a free account gets.
    for (const feature of lockedFeatures('anonymous')) {
      expect(canAccess(feature, 'subscriber'), `subscriber denied ${feature}`).toBe(true)
    }
  })

  it('fails CLOSED on a feature it does not know', () => {
    // A typo'd or newly-introduced name must deny. A gate that fails open is
    // not a gate — the same rule `entity-access` uses for unknown roles.
    expect(canAccess('not-a-real-feature' as Feature, 'subscriber')).toBe(false)
  })

  it('fails CLOSED on a plan it does not know', () => {
    expect(canAccess('ai-summary', 'enterprise' as Plan)).toBe(false)
  })
})

describe('lockedFeatures', () => {
  it('names what signing in would actually buy', () => {
    expect(lockedFeatures('anonymous')).toContain('ai-summary')
    expect(lockedFeatures('anonymous')).toContain('analytics-console')
  })

  it('is empty for the top plan', () => {
    expect(lockedFeatures('subscriber')).toEqual([])
  })
})

/**
 * Paying is not the same as being staff, and the two must never learn about
 * each other. An admin is not a subscriber; a subscriber is not an admin.
 * Wiring them together is how a gate quietly becomes a privilege escalation —
 * the same failure `entity-access.ts` is kept structurally apart from `Tier`
 * to prevent.
 */
describe('access is not RBAC', () => {
  const ACCESS = readFileSync(join(process.cwd(), 'src/lib/access.ts'), 'utf8')
  const ROLES = readFileSync(join(process.cwd(), 'src/lib/auth/roles.ts'), 'utf8')

  it('does not import the staff tiers', () => {
    expect(ACCESS).not.toMatch(/from\s+['"].*auth\/roles['"]/)
    expect(ACCESS).not.toContain('resolveTier')
  })

  it('is not imported by the staff tiers', () => {
    expect(ROLES).not.toMatch(/from\s+['"].*\/access['"]/)
    // A CALL to this module's `canAccess`, not the substring: `roles.ts` has
    // its own `canAccessAdmin`, which is a different function about a
    // different question and is allowed to exist.
    expect(ROLES).not.toMatch(/(?<![A-Za-z])canAccess\s*\(/)
    expect(ROLES).not.toMatch(/(?<![A-Za-z])planFor\s*\(/)
  })
})

/**
 * The public surfaces are public ON PURPOSE, and this is the record of it.
 *
 * For an aggregator, the reading surfaces are what search engines index and
 * that traffic IS the asset — gating them hides the product from exactly the
 * people who would pay for it. And `/insights` is the published open-data
 * dashboard the project is partly known for, with a public export endpoint;
 * putting it behind a login contradicts the claim.
 */
describe('what is deliberately NOT gated', () => {
  const ACCESS = readFileSync(join(process.cwd(), 'src/lib/access.ts'), 'utf8')

  it.each([
    ['the article body', 'article-body'],
    ['the home feed', 'home-feed'],
    ['search', 'search'],
    ['the insights dashboard', 'insights'],
  ])('has no gate for %s', (_label, name) => {
    expect(ACCESS).not.toMatch(new RegExp(`['"]${name}['"]\\s*:`))
  })
})

/**
 * The trust score was withdrawn from every READER-facing surface on 2026-09-11
 * after it was measured against the live cluster:
 *
 *  - it is `(avgQuality*0.7 + volume*0.3)*100` over 7 days, so it ranks recent
 *    volume and fluency, not trustworthiness;
 *  - **200 of the 201 sources it rates "Established" sit on a feed the platform
 *    records as broken**, and exactly one is healthy;
 *  - `src-malawivoice-mw`, carrying 45+ casino-affiliate pages, scores 85.8;
 *  - `news.sourceScoreHistory`, which the code claimed audited every change to
 *    it, holds zero rows.
 *
 * Gating it behind a login would not have fixed any of that — it would have
 * published the same wrong verdict to a smaller audience. This suite stops it
 * drifting back.
 */
describe('the withdrawn trust score', () => {
  /**
   * Reader-facing code only.
   *
   * `src/lib/mongodb/` and `src/lib/api.ts` may NAME the fields, because that is
   * where the decision not to read them is written down and a reader of that
   * code needs to know why. `src/{lib,components}/publisher/` is out of scope
   * for a different and substantive reason: it is a verified publisher's
   * ownership-gated view of THEIR OWN source, which is not the platform
   * publishing a verdict about a third party. That surface still shows the same
   * unsound figures and wants the same treatment — tracked separately rather
   * than changed here under a request about readers.
   */
  const EXCLUDED = /src[/\\](lib[/\\]mongodb|lib[/\\]publisher|components[/\\]publisher|lib[/\\]api\.ts)/

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name)
      if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(full)
      return /\.tsx?$/.test(e.name) && !/\.(test|spec)\./.test(e.name) ? [full] : []
    })
  }

  /**
   * Comments stripped before scanning.
   *
   * Without this the check fails on its own explanation: the components that
   * deliberately do NOT read these fields say so at length in their doc blocks,
   * and a detector that cannot tell prose from code would force the reasoning to
   * be deleted to make the build pass. `design-tokens.test.ts` learned the same
   * lesson on the dangling-`var()` check.
   */
  function code(file: string): string {
    return readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ')
  }

  const FILES = walk(join(process.cwd(), 'src')).filter((f) => !EXCLUDED.test(f))

  it('walks a real tree, so a passing run means something', () => {
    expect(FILES.length).toBeGreaterThan(100)
  })

  it('strips comments but still sees code', () => {
    const panel = join(process.cwd(), 'src/components/article/source-provenance.tsx')
    expect(code(panel)).not.toMatch(/casino-affiliate/) // prose, gone
    expect(code(panel)).toMatch(/SourceProvenancePanel/) // code, kept
  })

  it('is rendered to no reader', () => {
    const offenders = FILES.filter((f) => /\b(source_trust|trustScore)\b/.test(code(f)))
    expect(offenders).toEqual([])
  })

  /**
   * `sourceHealth` / `consecutiveFailures` / `lastFetchError` are a separate
   * trap, and a tempting one — they look exactly like the reliability signal a
   * provenance panel wants. Measured the same day, **351 of the 387 active
   * sources in an error state carry the platform's OWN MongoDB read timeout**
   * as the publisher's fetch error, so rendering them tells a reader a newsroom
   * is failing when what failed was our database. `lastSuccessfulFetchAt` is
   * the one signal that cannot make that mistake.
   */
  it('renders no feed-health verdict to a reader', () => {
    const offenders = FILES.filter((f) =>
      /\b(sourceHealth|consecutiveFailures)\b/.test(code(f))
    )
    expect(offenders).toEqual([])
  })
})

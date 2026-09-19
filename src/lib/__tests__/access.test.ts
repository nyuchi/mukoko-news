import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  allowanceOf,
  canAccess,
  lockedFeatures,
  meteredFor,
  planFor,
  withinAllowance,
  type Feature,
  type Meter,
  type Plan,
} from '@/lib/access'

describe('planFor', () => {
  it('is anonymous signed out and free signed in', () => {
    expect(planFor(false)).toBe('anonymous')
    expect(planFor(true)).toBe('free')
  })

  /**
   * The paid tiers are reachable, but only from the billing field.
   *
   * This replaces an assertion that `planFor` could never return a paid tier at
   * all. That was right while this app refused to read a plan from anywhere —
   * and the refusal cost it the cross-app Mukoko subscription the sibling apps
   * already share (`MukokoPlan` in nhimbe's `lib/mongo/entitlements.ts`).
   *
   * The original concern was about the WRITER, not the reader, and it was
   * checked rather than assumed on 2026-09-19: the gateway's
   * `services/IdentityService.ts` writes only WorkOS-owned OIDC claim fields
   * and never touches `mukoko.plan`. So the field has exactly one intended
   * writer — a billing service — and it does not exist yet.
   */
  it('reads the paid tiers only from the billing field', () => {
    expect(planFor(true, 'pro')).toBe('pro')
    expect(planFor(true, 'custom')).toBe('custom')
  })

  it('fails CLOSED to free on an unknown or absent plan', () => {
    // A feature gated on a paid tier stays gated until a real subscription says
    // otherwise, rather than unlocking because a field is unset or misspelled.
    expect(planFor(true, null)).toBe('free')
    expect(planFor(true, undefined)).toBe('free')
    expect(planFor(true, 'enterprise')).toBe('free')
    expect(planFor(true, 'PRO')).toBe('free')
  })

  it('never grants a paid tier to someone with no session', () => {
    // Signing out must beat any plan string a caller could supply.
    expect(planFor(false, 'pro')).toBe('anonymous')
    expect(planFor(false, 'custom')).toBe('anonymous')
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
    // top plan must never be refused something a free account gets.
    for (const feature of lockedFeatures('anonymous')) {
      expect(canAccess(feature, 'custom'), `custom denied ${feature}`).toBe(true)
    }
  })

  it('fails CLOSED on a feature it does not know', () => {
    // A typo'd or newly-introduced name must deny. A gate that fails open is
    // not a gate — the same rule `entity-access` uses for unknown roles.
    expect(canAccess('not-a-real-feature' as Feature, 'custom')).toBe(false)
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
    expect(lockedFeatures('custom')).toEqual([])
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

  /**
   * The check above is necessary and was NOT sufficient, and the gap cost ten
   * days of the wrong product.
   *
   * `/insights` was gated from 2026-09-01 to 2026-09-11 — anonymous visitors got
   * the corpus summary and a "Sign in for the full picture" card, and the export
   * 401'd — while this suite went on passing, because the gate was never in
   * `access.ts`. It was a direct `isViewerSignedIn()` in the page and a
   * `requireViewer()` in every action. A test that only reads the access map
   * cannot see a gate written any other way, so it certified as open a surface
   * that was closed.
   *
   * The owner's reversal — *"open data behind a login is not correct... that is
   * not to gate free data, but those should not be able to be mined by bots —
   * have a security layer, it's public data"* — is enforced here at the
   * surfaces themselves. Abuse is handled by the edge cache and the export's
   * rate limit; see `app/api/insights/export/route.ts`.
   */
  describe('the open-data surfaces, by any mechanism', () => {
    const SURFACES = [
      'src/app/insights/page.tsx',
      'src/app/insights/insights-client.tsx',
      'src/lib/actions/insights.ts',
      'src/app/api/insights/export/route.ts',
    ]

    /** Comments stripped: these files EXPLAIN the withdrawn gate at length. */
    function code(rel: string): string {
      return readFileSync(join(process.cwd(), rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ')
    }

    it('strips comments but still sees code', () => {
      const page = code('src/app/insights/page.tsx')
      expect(page).not.toMatch(/owner/i) // prose, gone
      expect(page).toMatch(/InsightsPage/) // code, kept
    })

    it.each(SURFACES)('%s reads no session', (rel) => {
      expect(code(rel)).not.toMatch(
        /isViewerSignedIn|requireViewer|withAuth\(|useAuth\(|planFor|canAccess/
      )
    })
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

/**
 * The allowances — owner decision 2026-09-19.
 *
 *   > "Free = public is 50 articles 5 searches, then the rest is gated but free
 *   > user tier — have to be logged in. Similar to how Instagram and TikTok
 *   > work. Interactions is gated by auth. Analytics and AI is gated to auth,
 *   > 5 article insights then tiers by subscription kicks in."
 *
 * These numbers are policy, not derivation, so they are asserted literally: a
 * change to them should be a visible decision in a diff, not a quiet edit to a
 * config object.
 */
describe('allowances', () => {
  it('lets a stranger read 50 articles and run 5 searches', () => {
    expect(allowanceOf('articles', 'anonymous')).toBe(50)
    expect(allowanceOf('searches', 'anonymous')).toBe(5)
  })

  it('stops counting articles and searches once signed in', () => {
    // The wall exists to convert, so it has done its whole job the moment
    // somebody signs up. Continuing to meter them would be a second wall.
    expect(allowanceOf('articles', 'free')).toBeNull()
    expect(allowanceOf('searches', 'free')).toBeNull()
  })

  it('gives a free account five AI insights, then a subscription', () => {
    expect(allowanceOf('ai-summary', 'free')).toBe(5)
    expect(allowanceOf('ai-summary', 'pro')).toBeNull()
    expect(allowanceOf('ai-summary', 'custom')).toBeNull()
  })

  it('offers an anonymous reader no AI at all, agreeing with the gate', () => {
    // Two mechanisms must not disagree: `canAccess` already says no, and a
    // non-zero allowance here would be a second answer to the same question.
    expect(canAccess('ai-summary', 'anonymous')).toBe(false)
    expect(allowanceOf('ai-summary', 'anonymous')).toBe(0)
  })

  it('stops on the article AFTER the allowance, not the one that reaches it', () => {
    expect(withinAllowance('articles', 'anonymous', 49)).toBe(true)
    expect(withinAllowance('articles', 'anonymous', 50)).toBe(false)
    expect(withinAllowance('articles', 'anonymous', 51)).toBe(false)
  })

  it('treats a broken counter as exhausted, never as unlimited', () => {
    // A negative or non-finite count can only come from a broken meter, and the
    // safe reading of a broken meter is not "let them through for ever".
    expect(withinAllowance('articles', 'anonymous', -1)).toBe(false)
    expect(withinAllowance('articles', 'anonymous', Number.NaN)).toBe(false)
    expect(withinAllowance('articles', 'anonymous', Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('fails CLOSED on a meter or plan it does not know', () => {
    expect(allowanceOf('not-a-meter' as Meter, 'free')).toBe(0)
    expect(allowanceOf('articles', 'enterprise' as Plan)).toBe(0)
    expect(withinAllowance('articles', 'enterprise' as Plan, 0)).toBe(false)
  })

  it('names what an upgrade would actually raise', () => {
    expect(meteredFor('anonymous')).toEqual(
      expect.arrayContaining(['articles', 'searches', 'ai-summary'])
    )
    expect(meteredFor('free')).toEqual(['ai-summary'])
    expect(meteredFor('pro')).toEqual([])
  })
})

/**
 * The allowances are policy, and policy has exactly one home.
 *
 * `access.ts` already had a structural guard proving it never imports
 * `roles.ts` — the lesson being that a rule which exists in two places is a
 * rule that will eventually disagree with itself. The numbers are the same
 * shape of hazard, and a worse one: a `50` typed into the article wall and a
 * `50` typed into the map look identical right up to the day one of them
 * changes, and a wall that fires at a different count from the one the map
 * declares is unreviewable from either file.
 *
 * So no enforcing surface may carry its own copy. They read `allowanceOf`.
 */
describe('the allowance numbers live in ONE place', () => {
  /** Comments explain the numbers at length; only code is searched. */
  function code(file: string): string {
    return readFileSync(resolve(process.cwd(), file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
  }

  /**
   * ⚠️ The literal scan covers the two PURE modules only, and that is a real
   * limit rather than an oversight — so it is written down instead of being
   * quietly papered over.
   *
   * A blanket "this number must not appear" check cannot work on a component or
   * a page. Tailwind's spacing scale puts `5` in `p-5`, `h-5`, `mt-5` on almost
   * every card in this repo, and `src/app/search/page.tsx` passes a result
   * limit of 50 to `searchArticlesAction` that has nothing whatever to do with
   * the article allowance. A check that fires on those is noise, and a noisy
   * check is one somebody deletes — which would leave no check at all.
   *
   * So the scan runs where a bare number could only be policy, and the
   * positive assertion below carries the rest: every surface that decides
   * something reaches the decision through the map.
   */
  const PURE_MODULES = ['src/hooks/use-meter.ts', 'src/lib/metering.ts']

  it.each(PURE_MODULES)('%s does not hardcode an allowance', (file) => {
    const src = code(file)
    for (const meter of ['articles', 'searches', 'ai-summary'] as const) {
      for (const plan of ['anonymous', 'free', 'pro', 'custom'] as const) {
        const value = allowanceOf(meter, plan)
        // 0 and 1 appear all over ordinary code, so only real ceilings count.
        if (value === null || value <= 1) continue
        expect(
          new RegExp(`\\b${value}\\b`).test(src),
          `${file} contains the literal ${value}, the ${plan} allowance for "${meter}". Read it from allowanceOf() instead.`,
        ).toBe(false)
      }
    }
  })

  it('every enforcing surface actually consults the map', () => {
    // The scan above only proves a number is ABSENT, which a file that enforces
    // nothing passes trivially. This asserts the positive: the files that
    // decide something reach the decision through `@/lib/access`, directly or
    // through the hook that does.
    const deciders = [
      'src/components/access/metered-article-body.tsx',
      'src/components/article/article-summary.tsx',
      'src/app/search/page.tsx',
      'src/hooks/use-meter.ts',
    ]
    for (const file of deciders) {
      const src = code(file)
      expect(
        /@\/lib\/access|@\/hooks\/use-meter/.test(src),
        `${file} enforces an allowance without reading the access map`,
      ).toBe(true)
    }
  })

  it('interactions are gated SERVER-side, not in the browser', () => {
    // The one real gate in the model. Everything else is a conversion wall over
    // a payload already sent; this one must survive a console `fetch`, so the
    // check has to live in the Route Handler rather than in the component that
    // calls it.
    for (const route of ['like', 'save']) {
      const src = code(`src/app/api/articles/[id]/${route}/route.ts`)
      expect(
        /guardInteraction/.test(src),
        `/api/articles/[id]/${route} does not call the interaction guard`,
      ).toBe(true)
    }
    // …and views are deliberately NOT gated: they fire on every article load,
    // a crawler's included.
    expect(/guardInteraction/.test(code('src/app/api/articles/[id]/view/route.ts'))).toBe(false)
  })
})

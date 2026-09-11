/**
 * What a viewer is allowed to reach, by plan.
 *
 * ## Why a seam rather than `if (user)` at each call site
 *
 * There are two viewer states in this app today — signed out and signed in —
 * and there will be three the moment there is a way to pay. Scattering
 * `if (user)` through the components that gate on it means every one of them
 * has to be found and edited on that day, and the ones that are missed fail
 * OPEN. One map, consulted everywhere, moves that to a single line.
 *
 * ## What this is NOT
 *
 * It is not staff RBAC. `src/lib/auth/roles.ts` answers "is this person on the
 * platform team", reads the WorkOS org claims, and gates `/admin`. This answers
 * "has this reader paid", and the two must never be wired together: an admin is
 * not a subscriber and a subscriber is not an admin. Nothing here imports
 * `roles.ts` and nothing there imports this — `access.test.ts` asserts it
 * structurally, the same way `entity-access` is kept away from `Tier`.
 */

/**
 * The plans, in ascending order of what they can reach.
 *
 * ⚠️ **Nothing returns `subscriber` yet.** There is no billing in this
 * platform — no plan field, no webhook, no checkout. The tier exists so the
 * features that should eventually sit behind payment can be *declared* now and
 * moved in one edit later, not so that anything can claim it today. See
 * `planFor`.
 */
export type Plan = 'anonymous' | 'free' | 'subscriber'

const RANK: Record<Plan, number> = { anonymous: 0, free: 1, subscriber: 2 }

/**
 * Every gated capability in the app.
 *
 * A closed union on purpose: adding a gate means adding it here, which means
 * deciding its plan in the one place all the others are visible. A feature
 * gated by a string literal at its call site is a feature nobody can audit.
 */
export type Feature =
  /** The enrichment worker's summary on an article. */
  | 'ai-summary'
  /** The `/analytics` query console — arbitrary queries over the corpus. */
  | 'analytics-console'
  /** CSV/JSON of a query's matched slice. */
  | 'analytics-export'
  /** Articles saved to the account rather than the device. */
  | 'saved-articles'
  /** A verified publisher's own dashboard. */
  | 'publisher-dashboard'
  /**
   * The provenance panel on a source: how many articles we hold from it, when
   * we last successfully read its feed, how long it has been delivering, and
   * how we established its country.
   *
   * Signed-in rather than public because it is the platform's own operational
   * record of a named third party, not something the publisher published.
   */
  | 'source-transparency'

/**
 * The minimum plan each feature needs.
 *
 * **Closed map, and an unknown key grants nothing** — the same rule
 * `entity-access.ts` uses for membership roles, for the same reason: a gate
 * that fails open is not a gate. Everything not named here is public, and that
 * is deliberate rather than an oversight. Article bodies, the home feed,
 * `/search`, `/discover`, `/sources`, `/topic`, `/author` and `/insights` are
 * ALL public and must stay so:
 *
 *  - the reading surfaces are what search engines index, and for an aggregator
 *    that traffic is the asset — gating them hides the product from the people
 *    who would subscribe to it;
 *  - `/insights` is the published open-data dashboard this project is partly
 *    known for, with a public export endpoint. Putting it behind a login
 *    contradicts the claim, and the claim is worth more than the conversions.
 */
const REQUIRES: Record<Feature, Plan> = {
  'ai-summary': 'free',
  'analytics-console': 'free',
  'analytics-export': 'free',
  'saved-articles': 'free',
  'publisher-dashboard': 'free',
  'source-transparency': 'free',
}

/**
 * Can this plan reach this feature?
 *
 * Fails closed on anything it does not recognise, so a typo'd or
 * newly-introduced feature name denies rather than grants.
 */
export function canAccess(feature: Feature, plan: Plan): boolean {
  const required = REQUIRES[feature]
  if (required === undefined) return false
  const have = RANK[plan]
  if (have === undefined) return false
  return have >= RANK[required]
}

/**
 * The plan for a viewer.
 *
 * Today this is the whole of it: signed in means `free`, signed out means
 * `anonymous`. **It deliberately cannot return `subscriber`**, because there is
 * nothing to read a subscription from — and inventing a source would be worse
 * than the gap. In particular a plan must never be read from a field some other
 * domain writes: `entity` and `identity` are written by the gateway's WorkOS
 * webhook and MongoDB's validators accept unknown fields, so honouring a
 * `plan: "subscriber"` from there would make every writer to those databases an
 * authority on who has paid. When billing lands, this function is the one place
 * that changes.
 */
export function planFor(signedIn: boolean): Plan {
  return signedIn ? 'free' : 'anonymous'
}

/** Features a plan cannot reach — what an upgrade would actually buy. */
export function lockedFeatures(plan: Plan): Feature[] {
  return (Object.keys(REQUIRES) as Feature[]).filter((f) => !canAccess(f, plan))
}

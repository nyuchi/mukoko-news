/**
 * What a viewer is allowed to reach, and how much of it.
 *
 * ## Why a seam rather than `if (user)` at each call site
 *
 * Scattering `if (user)` through the components that gate on it means every one
 * of them has to be found and edited the day the tiers change, and the ones that
 * are missed fail OPEN. One map, consulted everywhere, moves that to a line.
 *
 * ## What this is NOT
 *
 * It is not staff RBAC. `src/lib/auth/roles.ts` answers "is this person platform
 * staff", reads the WorkOS org claims and gates `/admin`. This answers "what has
 * this reader signed up or paid for". An admin is not a subscriber and a
 * subscriber is not an admin; `access.test.ts` asserts structurally that neither
 * module imports the other, so an edit that wires them together fails CI rather
 * than quietly turning a paywall into a privilege escalation.
 *
 * ## The shape (owner decision 2026-09-19)
 *
 *   > "Free = public is 50 articles 5 searches, then the rest is gated but free
 *   > user tier — have to be logged in. Similar to how Instagram and TikTok
 *   > work. Interactions is gated by auth. Analytics and AI is gated to auth,
 *   > 5 article insights then tiers by subscription kicks in."
 *
 * Two different mechanisms, and keeping them apart is the point of this file:
 *
 *   - a **gate** is binary — you may reach this feature or you may not
 *     (`canAccess`). Interactions, the analytics console and the export are
 *     gates: signed out means no.
 *   - an **allowance** is a ceiling on something you may otherwise reach
 *     (`allowanceOf`). Reading articles and searching are NOT gated for an
 *     anonymous reader — they are metered, because the whole product depends on
 *     a stranger being able to walk in and read.
 *
 * Collapsing the two is how an aggregator accidentally deletes itself from
 * search: `robots.txt` here deliberately courts crawlers and answer engines, and
 * for an aggregator that indexed traffic IS the asset. The 50-article allowance
 * is a wall a *person* meets after real use, not a gate a crawler meets on the
 * first request.
 */

/**
 * The plans, ascending.
 *
 * `free` / `pro` / `custom` are NOT invented here — they mirror `MukokoPlan`,
 * the cross-app subscription vocabulary already used by the sibling Mukoko apps
 * (nhimbe's `src/lib/mongo/entitlements.ts`), so one subscription means the same
 * thing in every product. `anonymous` is this app's own addition: the shared
 * field cannot express "not signed in", because the apps that defined it require
 * a session before anything is gated. Reading here does not.
 */
export type Plan = "anonymous" | "free" | "pro" | "custom";

const RANK: Record<Plan, number> = {
  anonymous: 0,
  free: 1,
  pro: 2,
  // Usage-based billing above Pro. Metering and invoicing live outside this
  // repo; here it means only "no ceiling to enforce".
  custom: 3,
};

/**
 * Every BINARY gate in the app.
 *
 * A closed union on purpose: adding a gate means adding it here, which means
 * deciding its plan in the one place all the others are visible. A feature gated
 * by a string literal at its call site is a feature nobody can audit.
 */
export type Feature =
  /** Like, save and the rest of the engagement actions. Signed-in only. */
  | "interactions"
  /** The enrichment worker's summary on an article. Metered — see `ai-summary`. */
  | "ai-summary"
  /** The `/analytics` query console. Anonymous callers get the preview instead. */
  | "analytics-console"
  /** CSV/JSON of a query's matched slice. */
  | "analytics-export"
  /** Articles saved to the account rather than the device. */
  | "saved-articles"
  /** A verified publisher's own dashboard. */
  | "publisher-dashboard"
  /** The provenance panel on a source. */
  | "source-transparency";

/**
 * The minimum plan each gate needs.
 *
 * **Closed map, and an unknown key grants nothing** — the same rule
 * `entity-access.ts` uses for membership roles, for the same reason: a gate that
 * fails open is not a gate.
 *
 * Everything not named here is public, deliberately: article bodies, the home
 * feed, `/discover`, `/categories`, `/sources`, `/topic`, `/author` and
 * `/insights` are what search engines index, and `/insights` is the published
 * open-data dashboard with a public export. Gating them hides the product from
 * the people who would pay for it. What limits an anonymous reader is the
 * allowance below, not a gate.
 */
const REQUIRES: Record<Feature, Plan> = {
  interactions: "free",
  "ai-summary": "free",
  "analytics-console": "free",
  "analytics-export": "free",
  "saved-articles": "free",
  "publisher-dashboard": "free",
  "source-transparency": "free",
};

/**
 * The metered capabilities — things a plan may reach, up to a point.
 *
 * Distinct from `Feature` because the failure modes differ. Reaching a gate you
 * lack shows you what you are missing; exhausting an allowance has to show you
 * what you have already had, or it reads as the site breaking.
 */
export type Meter = "articles" | "searches" | "ai-summary";

/** `null` means no ceiling to enforce — not "infinite", just nothing to count. */
export type Allowance = number | null;

const ALLOWANCES: Record<Meter, Record<Plan, Allowance>> = {
  // Instagram/TikTok shape: a stranger reads freely for a while, then is asked
  // to sign up — not asked on arrival.
  articles: { anonymous: 50, free: null, pro: null, custom: null },
  searches: { anonymous: 5, free: null, pro: null, custom: null },
  // AI is signed-in only (0 for anonymous — the gate above already says so, and
  // this agrees with it rather than contradicting it), then five on the house
  // before a subscription is needed.
  "ai-summary": { anonymous: 0, free: 5, pro: null, custom: null },
};

/**
 * Can this plan reach this gate?
 *
 * Fails closed on anything it does not recognise, so a typo'd or newly
 * introduced feature name denies rather than grants.
 */
export function canAccess(feature: Feature, plan: Plan): boolean {
  const required = REQUIRES[feature];
  if (required === undefined) return false;
  const have = RANK[plan];
  if (have === undefined) return false;
  return have >= RANK[required];
}

/**
 * How many of `meter` this plan gets, or `null` for no ceiling.
 *
 * Fails closed the same way: an unknown meter or plan allows **nothing**, so a
 * miswired counter denies rather than handing out an unmetered surface.
 */
export function allowanceOf(meter: Meter, plan: Plan): Allowance {
  const row = ALLOWANCES[meter];
  if (row === undefined) return 0;
  const allowance = row[plan];
  return allowance === undefined ? 0 : allowance;
}

/**
 * Has this plan used up its allowance of `meter`?
 *
 * `used` is a count of what has already happened, so the comparison is `>=`:
 * with an allowance of 50 and 50 already read, the 51st is the one that stops.
 * A negative or non-finite count is treated as exhausted rather than trusted —
 * it can only come from a broken counter, and the safe reading of a broken
 * counter is not "unlimited".
 */
export function withinAllowance(meter: Meter, plan: Plan, used: number): boolean {
  const allowance = allowanceOf(meter, plan);
  if (!Number.isFinite(used) || used < 0) return false;
  if (allowance === null) return true;
  return used < allowance;
}

/**
 * The plan for a viewer.
 *
 * ⚠️ **`mukokoPlan` must come from the billing service and nothing else.**
 *
 * An earlier version of this file refused to read a plan from `identity.persons`
 * at all, on the grounds that `identity` is written by the gateway's WorkOS
 * webhook and Mongo's validators accept unknown keys — so honouring a plan from
 * there would make every writer to that database an authority on who has paid.
 * That concern is real, but it is a constraint on the WRITER, and refusing to
 * read cost this app the cross-app subscription the rest of the platform already
 * shares.
 *
 * Checked 2026-09-19 rather than assumed: `mukoko-news-gateway`'s
 * `services/IdentityService.ts` writes only the WorkOS-owned OIDC claim fields
 * and **never touches `mukoko.plan`**. So the field has exactly one intended
 * writer — a billing service — and that writer does not exist yet.
 *
 * Until it does, every caller passes `null` here and everyone reads `free`,
 * which is the correct default: a feature gated on a paid tier stays gated until
 * a real subscription says otherwise, rather than silently unlocking because a
 * field is unset. Unknown values fail closed to `free` for the same reason.
 */
export function planFor(signedIn: boolean, mukokoPlan?: string | null): Plan {
  if (!signedIn) return "anonymous";
  if (mukokoPlan === "pro") return "pro";
  if (mukokoPlan === "custom") return "custom";
  return "free";
}

/** Features a plan cannot reach — what an upgrade would actually buy. */
export function lockedFeatures(plan: Plan): Feature[] {
  return (Object.keys(REQUIRES) as Feature[]).filter((f) => !canAccess(f, plan));
}

/** Meters this plan has a ceiling on — what an upgrade would actually raise. */
export function meteredFor(plan: Plan): Meter[] {
  return (Object.keys(ALLOWANCES) as Meter[]).filter(
    (m) => allowanceOf(m, plan) !== null,
  );
}

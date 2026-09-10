// Pan-African countries — all 54 African Union member states
// Single source of truth - used by preferences, discover, and other pages
//
// Each row used to carry an `color: "bg-<hue>-<step>"` accent — 54 raw Tailwind
// palette utilities, more than half the raw-palette usage in the whole app, and
// the only consumer painted it as the circle BEHIND the flag emoji. So the
// colour was invisible under the artwork it sat behind, and where it did show
// at the rim it was an arbitrary hue asserted next to a national flag
// (Zimbabwe on green, Libya on black, Tunisia on red). The flag is the
// country's own identity and needs nothing behind it; the circle is now a
// neutral surface token. Removing the field deleted the utilities outright
// rather than translating 54 arbitrary choices into 54 different ones.
export const COUNTRIES = [
  // East Africa
  { code: "ZW", name: "Zimbabwe", flag: "🇿🇼" },
  { code: "KE", name: "Kenya", flag: "🇰🇪" },
  { code: "TZ", name: "Tanzania", flag: "🇹🇿" },
  { code: "UG", name: "Uganda", flag: "🇺🇬" },
  { code: "RW", name: "Rwanda", flag: "🇷🇼" },
  { code: "ET", name: "Ethiopia", flag: "🇪🇹" },
  { code: "BI", name: "Burundi", flag: "🇧🇮" },
  { code: "DJ", name: "Djibouti", flag: "🇩🇯" },
  { code: "ER", name: "Eritrea", flag: "🇪🇷" },
  { code: "SO", name: "Somalia", flag: "🇸🇴" },
  { code: "SS", name: "South Sudan", flag: "🇸🇸" },
  { code: "KM", name: "Comoros", flag: "🇰🇲" },
  { code: "MG", name: "Madagascar", flag: "🇲🇬" },
  { code: "MU", name: "Mauritius", flag: "🇲🇺" },
  { code: "SC", name: "Seychelles", flag: "🇸🇨" },
  // Southern Africa
  { code: "ZA", name: "South Africa", flag: "🇿🇦" },
  { code: "BW", name: "Botswana", flag: "🇧🇼" },
  { code: "ZM", name: "Zambia", flag: "🇿🇲" },
  { code: "MW", name: "Malawi", flag: "🇲🇼" },
  { code: "NA", name: "Namibia", flag: "🇳🇦" },
  { code: "MZ", name: "Mozambique", flag: "🇲🇿" },
  { code: "LS", name: "Lesotho", flag: "🇱🇸" },
  { code: "SZ", name: "Eswatini", flag: "🇸🇿" },
  { code: "AO", name: "Angola", flag: "🇦🇴" },
  // West Africa
  { code: "NG", name: "Nigeria", flag: "🇳🇬" },
  { code: "GH", name: "Ghana", flag: "🇬🇭" },
  { code: "SN", name: "Senegal", flag: "🇸🇳" },
  { code: "CI", name: "Côte d'Ivoire", flag: "🇨🇮" },
  { code: "CM", name: "Cameroon", flag: "🇨🇲" },
  { code: "BJ", name: "Benin", flag: "🇧🇯" },
  { code: "BF", name: "Burkina Faso", flag: "🇧🇫" },
  { code: "CV", name: "Cabo Verde", flag: "🇨🇻" },
  { code: "GM", name: "Gambia", flag: "🇬🇲" },
  { code: "GN", name: "Guinea", flag: "🇬🇳" },
  { code: "GW", name: "Guinea-Bissau", flag: "🇬🇼" },
  { code: "LR", name: "Liberia", flag: "🇱🇷" },
  { code: "ML", name: "Mali", flag: "🇲🇱" },
  { code: "MR", name: "Mauritania", flag: "🇲🇷" },
  { code: "NE", name: "Niger", flag: "🇳🇪" },
  { code: "SL", name: "Sierra Leone", flag: "🇸🇱" },
  { code: "TG", name: "Togo", flag: "🇹🇬" },
  { code: "GQ", name: "Equatorial Guinea", flag: "🇬🇶" },
  { code: "ST", name: "São Tomé and Príncipe", flag: "🇸🇹" },
  // Central Africa
  { code: "CD", name: "DR Congo", flag: "🇨🇩" },
  { code: "CG", name: "Republic of Congo", flag: "🇨🇬" },
  { code: "CF", name: "Central African Republic", flag: "🇨🇫" },
  { code: "TD", name: "Chad", flag: "🇹🇩" },
  { code: "GA", name: "Gabon", flag: "🇬🇦" },
  // North Africa
  { code: "EG", name: "Egypt", flag: "🇪🇬" },
  { code: "MA", name: "Morocco", flag: "🇲🇦" },
  { code: "TN", name: "Tunisia", flag: "🇹🇳" },
  { code: "DZ", name: "Algeria", flag: "🇩🇿" },
  { code: "LY", name: "Libya", flag: "🇱🇾" },
  { code: "SD", name: "Sudan", flag: "🇸🇩" },
] as const;

export type CountryCode = (typeof COUNTRIES)[number]["code"];

/**
 * The last known-good answer to "which countries are we aggregating from" —
 * used ONLY when the live read fails.
 *
 * ## This is no longer the source of truth
 *
 * It used to be: a hand-measured list of sixteen codes that everything on the
 * site derived its coverage claim from. That was accurate the day it was
 * measured and wrong the moment a new source started producing — a country
 * would be live in the corpus and "coming soon" on the site until somebody
 * remembered to edit this array. The claim is now a live count
 * (`getLiveCoverageAction` → `getLiveCountries`), so countries appear and drop
 * off on their own.
 *
 * ## Why it still exists
 *
 * Because the failure mode of a live number is worse than the failure mode of a
 * stale one. If the cluster is unreachable, the aggregation returns empty, and
 * rendering that honestly would put **"live in 0 African countries"** into the
 * page title, the JSON-LD, `llms.txt` and the MCP server card — telling every
 * answer engine that crawls us that the platform covers nowhere. A slightly
 * stale sixteen is a far smaller lie than a confident zero.
 *
 * So this is a floor, not a fact. It is stamped with the date it was measured
 * and is expected to drift; nothing should read it directly except the
 * fallback path in `getLiveCoverageAction`.
 *
 * Measured 2026-09-10 at the documented bar (>= 500 articles in 30 days):
 *
 *   NG 11,019 · ZA 5,663 · ZW 3,520 · GH 3,450 · SN 2,959 · KE 2,347 ·
 *   EG 1,348 · CI 1,039 · ZM 1,010 · UG 996 · MW 979 · NA 739 · CM 658 ·
 *   ET 533 · LS 511 · TZ 505   |   SO 390 · GN 359 · RW 340 · MA 331 · …
 *
 * ## The caveat this carries, live count or not
 *
 * `feedSources.countryCode` provenance is unreliable for legacy rows: 315 of
 * 473 pre-provenance sources are `countryCodeSource: "assumed"`, and
 * `articles.countryCode` is stamped from the source, so it inherits the doubt.
 * Spot-checked, ZW's active sources include RT, The Guardian and Foreign
 * Policy; ET's include Mashable Middle East; LS's second source is France 24
 * French. Counting only sources whose country is `declared` or ccTLD-derived,
 * roughly 7 countries clear the same bar.
 *
 * Making the count live does not fix that — it makes it self-correcting. When
 * the pipeline's provenance backfill reaches the assumed rows, the mis-filed
 * articles stop being counted under the wrong country and this number moves on
 * its own, with no code change and no re-measurement.
 */
export const FALLBACK_LIVE_COUNTRY_CODES: readonly CountryCode[] = [
  "NG",
  "ZA",
  "ZW",
  "GH",
  "SN",
  "KE",
  "EG",
  "CI",
  "ZM",
  "UG",
  "MW",
  "NA",
  "CM",
  "ET",
  "LS",
  "TZ",
] as const;

/** Every African Union member state — the platform's scope. 54, and static. */
export const COUNTRY_SCOPE_TOTAL = COUNTRIES.length;

/**
 * The ONE sanctioned way to state coverage, mid-sentence.
 *
 * A FUNCTION now, not a constant: the count is a live figure the caller has
 * already resolved, so the copy cannot be baked at module scope. Every
 * description, meta tag and JSON-LD blurb calls one of these two rather than
 * writing its own number — the previous state of this repo was nine surfaces
 * each hand-writing "16 African countries", "15 other African countries" or
 * "12 more countries", which is exactly how a claim drifts.
 *
 * `src/lib/__tests__/coverage-claim.test.ts` enforces that no surface writes a
 * country count of its own, including the crawler-facing routes that used to be
 * static files under `public/`.
 */
export function coverageFragment(liveCount: number): string {
  return `live in ${liveCount} African countries, with all ${COUNTRY_SCOPE_TOTAL} in scope`;
}

/** The same claim as a standalone sentence, including what "in scope" means. */
export function coverageClaim(liveCount: number): string {
  return `Live in ${liveCount} African countries, with all ${COUNTRY_SCOPE_TOTAL} African Union member states in scope — the rest are coming soon.`;
}

// Default feed preferences for first-time visitors (and for the server-rendered
// initial feed). Must stay in sync between PreferencesContext defaults and the
// server pages that prefetch the feed, so the client can skip its initial
// refetch when the user's preferences match these defaults.
export const DEFAULT_FEED_COUNTRIES: string[] = ["ZW"];

/**
 * Category emoji and colour mapping.
 *
 * The keys are the pipeline's canonical category vocabulary — the closed
 * 17-value `CATEGORY_ENUM` in `fundi-news-enrichment/src/agent.ts` — plus the
 * `all` pseudo-category the UI uses for "no filter". Nothing else belongs here:
 * `sitemap.ts` derives the category URLs it submits to search engines straight
 * from these keys, so an entry with no articles behind it is an empty page
 * offered to crawlers.
 *
 * Two keys were removed once the corpus was measured:
 *
 * - `general` — withdrawn from the enum because the model was being offered a
 *   catch-all and took it on 11,627 of 44,237 enriched articles, and stripped
 *   from the stored data. No article carries it, so offering it here was a
 *   promise of a feed that cannot be filled.
 * - `harare` — a city, not a category. It was never in the enum; geography is
 *   owned by the `places` domain and filtered on `countryCode`, not by
 *   smuggling one city into the topic vocabulary.
 *
 * `getCategoryEmoji` falls back to 📰 for anything unrecognised, so removing a
 * key degrades to a default icon rather than throwing.
 */
// The `color` field was eighteen raw Tailwind palette utilities (`bg-red-500`
// for politics, `bg-emerald-500` for economy, …) and it disagreed with the
// SECOND category colour table that lived privately in `app/categories/
// page.tsx` — twelve `from-<hue>-500 to-<hue>-700` gradients, on a partly
// different set of categories. Two tables, two answers, neither from the design
// system.
//
// There is now one answer: `categoryTone` in `@/lib/category-tone` returns a
// matched Mzizi container/on-container pair. This map keeps the emoji, which is
// the part that was never in dispute.
export const CATEGORY_META: Record<string, { emoji: string }> = {
  all: { emoji: "📰" },
  politics: { emoji: "🏛️" },
  economy: { emoji: "💰" },
  business: { emoji: "💼" },
  technology: { emoji: "💻" },
  sports: { emoji: "⚽" },
  health: { emoji: "🏥" },
  education: { emoji: "📚" },
  entertainment: { emoji: "🎬" },
  international: { emoji: "🌍" },
  agriculture: { emoji: "🌾" },
  crime: { emoji: "🚔" },
  environment: { emoji: "🌍" },
  science: { emoji: "🔬" },
  culture: { emoji: "🎭" },
  lifestyle: { emoji: "✨" },
  travel: { emoji: "✈️" },
  food: { emoji: "🍽️" },
};

// Category emoji helper
export function getCategoryEmoji(slug: string): string {
  if (!slug) return "📰";
  return CATEGORY_META[slug.toLowerCase()]?.emoji || "📰";
}

// Base URL for the application
// Uses environment variable in production, falls back to default for development
export const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://news.mukoko.com";

// Public help centre (Intercom). The in-app /help page carries the short answers;
// this is where the full, maintained guides live, and the address support staff
// send readers to. Overridable so a staging build can point at a test workspace.
export const SUPPORT_URL =
  process.env.NEXT_PUBLIC_SUPPORT_URL || "https://support.nyuchi.com";

// Where a reader can reach a human. Kept next to SUPPORT_URL so the two never drift.
export const SUPPORT_EMAIL = "support@mukoko.com";

// Helper to generate full article URLs
export function getArticleUrl(articleId: string): string {
  return `${BASE_URL}/article/${articleId}`;
}

// Helper to generate full URLs from paths
export function getFullUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_URL}${normalizedPath}`;
}

// Pan-African countries — all 54 African Union member states
// Single source of truth - used by preferences, discover, and other pages
export const COUNTRIES = [
  // East Africa
  { code: "ZW", name: "Zimbabwe", flag: "🇿🇼", color: "bg-green-600" },
  { code: "KE", name: "Kenya", flag: "🇰🇪", color: "bg-red-600" },
  { code: "TZ", name: "Tanzania", flag: "🇹🇿", color: "bg-blue-500" },
  { code: "UG", name: "Uganda", flag: "🇺🇬", color: "bg-yellow-600" },
  { code: "RW", name: "Rwanda", flag: "🇷🇼", color: "bg-cyan-500" },
  { code: "ET", name: "Ethiopia", flag: "🇪🇹", color: "bg-green-400" },
  { code: "BI", name: "Burundi", flag: "🇧🇮", color: "bg-red-400" },
  { code: "DJ", name: "Djibouti", flag: "🇩🇯", color: "bg-sky-500" },
  { code: "ER", name: "Eritrea", flag: "🇪🇷", color: "bg-green-700" },
  { code: "SO", name: "Somalia", flag: "🇸🇴", color: "bg-blue-400" },
  { code: "SS", name: "South Sudan", flag: "🇸🇸", color: "bg-black" },
  { code: "KM", name: "Comoros", flag: "🇰🇲", color: "bg-green-500" },
  { code: "MG", name: "Madagascar", flag: "🇲🇬", color: "bg-red-500" },
  { code: "MU", name: "Mauritius", flag: "🇲🇺", color: "bg-blue-600" },
  { code: "SC", name: "Seychelles", flag: "🇸🇨", color: "bg-blue-700" },
  // Southern Africa
  { code: "ZA", name: "South Africa", flag: "🇿🇦", color: "bg-yellow-500" },
  { code: "BW", name: "Botswana", flag: "🇧🇼", color: "bg-sky-400" },
  { code: "ZM", name: "Zambia", flag: "🇿🇲", color: "bg-orange-500" },
  { code: "MW", name: "Malawi", flag: "🇲🇼", color: "bg-red-500" },
  { code: "NA", name: "Namibia", flag: "🇳🇦", color: "bg-blue-600" },
  { code: "MZ", name: "Mozambique", flag: "🇲🇿", color: "bg-yellow-500" },
  { code: "LS", name: "Lesotho", flag: "🇱🇸", color: "bg-blue-800" },
  { code: "SZ", name: "Eswatini", flag: "🇸🇿", color: "bg-blue-500" },
  { code: "AO", name: "Angola", flag: "🇦🇴", color: "bg-red-700" },
  // West Africa
  { code: "NG", name: "Nigeria", flag: "🇳🇬", color: "bg-green-500" },
  { code: "GH", name: "Ghana", flag: "🇬🇭", color: "bg-yellow-400" },
  { code: "SN", name: "Senegal", flag: "🇸🇳", color: "bg-green-600" },
  { code: "CI", name: "Côte d'Ivoire", flag: "🇨🇮", color: "bg-orange-600" },
  { code: "CM", name: "Cameroon", flag: "🇨🇲", color: "bg-green-700" },
  { code: "BJ", name: "Benin", flag: "🇧🇯", color: "bg-green-500" },
  { code: "BF", name: "Burkina Faso", flag: "🇧🇫", color: "bg-red-600" },
  { code: "CV", name: "Cabo Verde", flag: "🇨🇻", color: "bg-blue-700" },
  { code: "GM", name: "Gambia", flag: "🇬🇲", color: "bg-red-500" },
  { code: "GN", name: "Guinea", flag: "🇬🇳", color: "bg-red-600" },
  { code: "GW", name: "Guinea-Bissau", flag: "🇬🇼", color: "bg-red-700" },
  { code: "LR", name: "Liberia", flag: "🇱🇷", color: "bg-red-700" },
  { code: "ML", name: "Mali", flag: "🇲🇱", color: "bg-green-600" },
  { code: "MR", name: "Mauritania", flag: "🇲🇷", color: "bg-green-700" },
  { code: "NE", name: "Niger", flag: "🇳🇪", color: "bg-orange-500" },
  { code: "SL", name: "Sierra Leone", flag: "🇸🇱", color: "bg-blue-500" },
  { code: "TG", name: "Togo", flag: "🇹🇬", color: "bg-green-500" },
  { code: "GQ", name: "Equatorial Guinea", flag: "🇬🇶", color: "bg-green-600" },
  { code: "ST", name: "São Tomé and Príncipe", flag: "🇸🇹", color: "bg-green-700" },
  // Central Africa
  { code: "CD", name: "DR Congo", flag: "🇨🇩", color: "bg-blue-600" },
  { code: "CG", name: "Republic of Congo", flag: "🇨🇬", color: "bg-green-600" },
  { code: "CF", name: "Central African Republic", flag: "🇨🇫", color: "bg-blue-700" },
  { code: "TD", name: "Chad", flag: "🇹🇩", color: "bg-yellow-600" },
  { code: "GA", name: "Gabon", flag: "🇬🇦", color: "bg-green-500" },
  // North Africa
  { code: "EG", name: "Egypt", flag: "🇪🇬", color: "bg-red-700" },
  { code: "MA", name: "Morocco", flag: "🇲🇦", color: "bg-red-600" },
  { code: "TN", name: "Tunisia", flag: "🇹🇳", color: "bg-red-500" },
  { code: "DZ", name: "Algeria", flag: "🇩🇿", color: "bg-green-700" },
  { code: "LY", name: "Libya", flag: "🇱🇾", color: "bg-black" },
  { code: "SD", name: "Sudan", flag: "🇸🇩", color: "bg-red-600" },
] as const;

export type CountryCode = (typeof COUNTRIES)[number]["code"];

/**
 * The countries Mukoko News is actually LIVE in, as opposed to in scope for.
 *
 * The platform's scope is all 54 African Union member states (`COUNTRIES`);
 * 16 of them are released and the rest are coming soon. Before this list
 * existed, three numbers disagreed on the same site: `COUNTRIES` and the
 * sitemap said 54, every piece of public copy said 16, and the actual source
 * coverage was a third number — so an answer engine repeated whichever it read
 * first. Everything that states coverage now derives from here.
 *
 * ## Measured, not chosen (live cluster, 2026-09-10)
 *
 * A country is released when it has at least one ACTIVE feed source that
 * published in the trailing 30 days, and at least 500 articles in that window.
 * Ranked by 30-day volume the corpus falls off a cliff exactly at 16:
 *
 *   NG 10,987 · ZA 5,638 · ZW 3,518 · GH 3,444 · SN 2,950 · KE 2,339 ·
 *   EG 1,345 · CI 1,037 · ZM 1,005 · UG 992 · MW 978 · NA 740 · TZ 721 ·
 *   CM 653 · ET 551 · LS 510  |  SO 386 · GN 358 · MA 331 · LY 224 · …
 *
 * The 17th country is 24% below the 16th, so the cut is a real break in the
 * data rather than a threshold tuned to land on a wanted number. Any threshold
 * between 387 and 510 produces the same 16.
 *
 * ## The caveat this list carries
 *
 * `feedSources.countryCode` provenance is unreliable for legacy rows: 315 of
 * 473 pre-provenance sources are `countryCodeSource: "assumed"`, and
 * `articles.countryCode` is stamped from the source, so it inherits the same
 * doubt. Spot-checked on the cluster, ZW's active sources include RT, The
 * Guardian, Foreign Policy and Simple Flying; ET's include Mashable Middle
 * East and Amnesty International; LS's second source is France 24 French.
 * Counting only sources whose country is `declared` or derived from their own
 * ccTLD (`tld`), just 7 countries clear the same 500-article bar (ZA, NG, ZW,
 * KE, UG, TZ, NA).
 *
 * So 16 is the honest answer to "where do we have a live, producing feed",
 * and it is NOT the answer to "where do we have verified local sources". When
 * the provenance backfill reaches the assumed rows this list should be
 * re-measured, not re-argued.
 */
export const RELEASED_COUNTRY_CODES: readonly CountryCode[] = [
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
  "TZ",
  "CM",
  "ET",
  "LS",
] as const;

const RELEASED_COUNTRY_SET: ReadonlySet<string> = new Set(RELEASED_COUNTRY_CODES);

/** Every African Union member state — the platform's scope. 54. */
export const COUNTRY_SCOPE_TOTAL = COUNTRIES.length;

/** How many of those are live today. 16. */
export const RELEASED_COUNTRY_COUNT = RELEASED_COUNTRY_CODES.length;

/** Is this country live, or is it still "coming soon"? */
export function isReleasedCountry(code: string | null | undefined): boolean {
  return !!code && RELEASED_COUNTRY_SET.has(code);
}

/**
 * The ONE sanctioned way to state coverage, mid-sentence.
 *
 * Every description, meta tag and JSON-LD blurb interpolates one of these two
 * constants rather than writing its own number, because the previous state of
 * this repo — nine surfaces each hand-writing "16 African countries", "15
 * other African countries" or "12 more countries" — is exactly how a claim
 * drifts. `src/lib/__tests__/coverage-claim.test.ts` pins them, including in
 * the static files under `public/` that cannot import this module.
 */
export const COVERAGE_FRAGMENT = `live in ${RELEASED_COUNTRY_COUNT} African countries, with all ${COUNTRY_SCOPE_TOTAL} in scope`;

/** The same claim as a standalone sentence, including what "in scope" means. */
export const COVERAGE_CLAIM = `Live in ${RELEASED_COUNTRY_COUNT} African countries, with all ${COUNTRY_SCOPE_TOTAL} African Union member states in scope — the rest are coming soon.`;

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
export const CATEGORY_META: Record<string, { emoji: string; color: string }> = {
  all: { emoji: "📰", color: "bg-gray-500" },
  politics: { emoji: "🏛️", color: "bg-red-500" },
  economy: { emoji: "💰", color: "bg-emerald-500" },
  business: { emoji: "💼", color: "bg-emerald-600" },
  technology: { emoji: "💻", color: "bg-blue-500" },
  sports: { emoji: "⚽", color: "bg-orange-500" },
  health: { emoji: "🏥", color: "bg-green-500" },
  education: { emoji: "📚", color: "bg-violet-500" },
  entertainment: { emoji: "🎬", color: "bg-pink-500" },
  international: { emoji: "🌍", color: "bg-cyan-500" },
  agriculture: { emoji: "🌾", color: "bg-amber-500" },
  crime: { emoji: "🚔", color: "bg-red-600" },
  environment: { emoji: "🌍", color: "bg-green-600" },
  science: { emoji: "🔬", color: "bg-purple-500" },
  culture: { emoji: "🎭", color: "bg-rose-500" },
  lifestyle: { emoji: "✨", color: "bg-pink-400" },
  travel: { emoji: "✈️", color: "bg-sky-500" },
  food: { emoji: "🍽️", color: "bg-orange-400" },
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

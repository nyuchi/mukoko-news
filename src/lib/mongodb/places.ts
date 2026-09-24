import { getDomainDb } from './client';
import {
  COUNTRY_PRESENTATION,
  FALLBACK_FLAG,
  STATIC_COUNTRIES,
  type CountryOption,
} from '@/lib/countries';

/**
 * Countries, read from the `places` domain — the platform SSOT for geography.
 *
 * WHY NOT THE LOCAL CONSTANT
 * --------------------------
 * `COUNTRIES` in `src/lib/constants.ts` is a hand-maintained array. It happens
 * to match `places.placesGeo` exactly today (both 54 African countries, verified
 * code-for-code on 2026-09-06) — but nothing keeps them that way. `places` is
 * the declared owner: "Geography is owned by `places` … it is the SSOT for all
 * geo." A country added there, or the platform expanding beyond Africa, would
 * never reach this app.
 *
 * THE SPLIT THIS DRAWS
 * --------------------
 * `places` is the authority on **which countries exist and what they are
 * called**. The local constant remains the authority on **how one is drawn** —
 * flag emoji and accent colour, which `places` does not carry and should not:
 * a flag is a presentation detail of this app, not a fact about geography.
 *
 * So a country present in `places` but missing from the constant still appears,
 * with a neutral placeholder flag. It is listed because it exists, not because
 * someone remembered to add it here. That is the inversion that makes this a
 * real SSOT read rather than a second copy.
 *
 * Fail-soft, like every other read in this directory: a failure returns the
 * static list rather than an empty picker. A country selector with no countries
 * is worse than a slightly stale one.
 */

// Re-exported so callers that already import the reader do not need a second
// import for the shape and the fallback. The definitions live in
// `@/lib/countries` because client components need them and must not pull the
// MongoDB driver into their bundle.
export type { CountryOption };
export { STATIC_COUNTRIES };

interface PlacesGeoCountry {
  isoCode?: unknown;
  name?: unknown;
}

/**
 * Every country in `places.placesGeo`, decorated with local presentation.
 *
 * Sorted by name so the picker order is stable and does not depend on insertion
 * order in another domain's collection.
 */
export async function getCountries(): Promise<CountryOption[]> {
  try {
    const db = await getDomainDb('places');
    const rows = await db
      .collection<PlacesGeoCountry>('placesGeo')
      .find(
        { geoType: 'country', isoCode: { $type: 'string', $ne: '' } },
        { projection: { _id: 0, isoCode: 1, name: 1 } }
      )
      .toArray();

    const countries: CountryOption[] = [];
    for (const row of rows) {
      if (typeof row.isoCode !== 'string' || typeof row.name !== 'string') continue;
      const code = row.isoCode.trim().toUpperCase();
      if (!code) continue;

      countries.push({
        code,
        // `places` owns the name. The local constant's name is not consulted:
        // if the two disagree, the owning domain is right by definition.
        name: row.name,
        flag: COUNTRY_PRESENTATION.get(code) ?? FALLBACK_FLAG,
      });
    }

    // An empty read is treated as a failed one. `places` having zero countries
    // is not a real state, so it means the query or the connection is wrong —
    // and rendering an empty picker would present that as "no countries exist".
    if (countries.length === 0) return STATIC_COUNTRIES;

    return countries.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('[PLACES] country read failed — falling back to the static list', error);
    return STATIC_COUNTRIES;
  }
}

/**
 * Country tokens for TOPIC FILTERING, folded, read from the `places` SSOT.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * A country is a FACET of this corpus, not a subject within it: `byCountry`
 * already answers "where". Ranking country names as "Topics" tells a reader the
 * same thing twice, and it is not a small effect — measured on the live cluster
 * 2026-09-23, five of the top ten keywords were the five countries listed in
 * the panel beside them.
 *
 * WHY IT IS HERE AND NOT IN `analytics.ts`
 * ----------------------------------------
 * Because it kept being in `analytics.ts`, and in `insights.ts`, and in the
 * gateway, and each copy drifted. A platform-wide audit on 2026-09-23 counted
 * SIXTEEN independently hand-maintained country lists across the four repos,
 * holding FIVE different answers to "how many countries are there" (53, 54, 55,
 * 21, 16). Two dashboards in THIS app disagreed about whether Senegal is a
 * trending topic, because one copy folded diacritics and the other did not.
 *
 * `places` is the declared owner of geography. A list of countries that lives
 * anywhere else is a copy, and a copy is a future disagreement. This function
 * is a read, not a list.
 *
 * THE ALIAS LAYER
 * ---------------
 * `placesGeo` carries English names only, which is exactly why every app grew
 * its own alias array — the spellings the corpus actually publishes had nowhere
 * canonical to live. They now live on the country document as `altNames`,
 * seeded 2026-09-23 from the top-400 `aiKeywords` facet over 90 days, and only
 * with spellings OBSERVED there: `Sénégal`, `Côte d'Ivoire`, `Guinée`, `Maroc`,
 * `Algérie`, `RDC`. Nothing was inferred — a French form nobody publishes is
 * not a fact about this corpus, and inventing one in the SSOT is worse than
 * leaving the gap visible.
 *
 * Adding a spelling is now a write to `places`, once, for every app.
 */
export async function getCountryTopicTokens(): Promise<Set<string>> {
  const fold = (raw: string): string =>
    raw
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '');

  try {
    const db = await getDomainDb('places');
    const rows = await db
      .collection<{ isoCode?: unknown; name?: unknown; altNames?: unknown }>('placesGeo')
      .find(
        { geoType: 'country' },
        { projection: { _id: 0, isoCode: 1, name: 1, altNames: 1 } }
      )
      .toArray();

    const tokens = new Set<string>();
    for (const row of rows) {
      if (typeof row.name === 'string' && row.name.trim()) tokens.add(fold(row.name));
      if (typeof row.isoCode === 'string' && row.isoCode.trim()) tokens.add(fold(row.isoCode));
      if (Array.isArray(row.altNames)) {
        for (const alt of row.altNames) {
          if (typeof alt === 'string' && alt.trim()) tokens.add(fold(alt));
        }
      }
    }

    // An empty read is a failed one, exactly as in `getCountries`. Returning an
    // empty set here would silently turn the filter into a no-op and put the
    // country list straight back into the Topics panel — the bug this closes.
    if (tokens.size === 0) return staticCountryTokens();

    return tokens;
  } catch (error) {
    console.error('[PLACES] country token read failed — falling back to the static list', error);
    return staticCountryTokens();
  }
}

/**
 * The fallback, and it is deliberately the SAME static list the country picker
 * falls back to rather than a second one. It carries English names only, so a
 * `places` outage degrades the filter to what it caught before the alias layer
 * existed — countries still filtered, foreign spellings temporarily not. That
 * is a smaller, more legible loss than an unfiltered panel.
 */
function staticCountryTokens(): Set<string> {
  const fold = (raw: string): string =>
    raw.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const tokens = new Set<string>();
  for (const c of STATIC_COUNTRIES) {
    tokens.add(fold(c.name));
    tokens.add(fold(c.code));
  }
  return tokens;
}

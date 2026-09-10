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

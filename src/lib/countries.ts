import { COUNTRIES } from '@/lib/constants';

/**
 * The country shape, and the offline fallback list.
 *
 * WHY THIS IS SEPARATE FROM `mongodb/places.ts`
 * ---------------------------------------------
 * Both pickers that render countries are **client** components, and they need
 * two things before any server round-trip completes: the `CountryOption` type,
 * and a list to show while the read is in flight. Importing either from
 * `mongodb/places.ts` drags the whole MongoDB driver into the client bundle —
 * the build fails outright with `Can't resolve 'net'`, which is the honest
 * outcome, but it means the type and the fallback cannot live beside the query.
 *
 * So the split is: this module is pure data, safe anywhere. `mongodb/places.ts`
 * does the `places` read and imports its fallback from here.
 *
 * The authority question is settled elsewhere and is not affected by this file
 * existing: `places.placesGeo` decides which countries exist and what they are
 * called. This is what to draw while asking, and what to draw if the answer
 * never comes — a picker with no countries is worse than a slightly stale one.
 */

export interface CountryOption {
  code: string;
  name: string;
  flag: string;
}

/**
 * Presentation for a code — the flag.
 *
 * Keyed by plain `string`, not the literal union `COUNTRIES` infers, because the
 * whole point is looking up codes this constant does NOT contain: a country
 * `places` knows and this app has no art for must resolve to the placeholder
 * rather than fail to compile.
 */
export const COUNTRY_PRESENTATION = new Map<string, string>(
  COUNTRIES.map((c) => [c.code as string, c.flag])
);

/** Shown for a country `places` lists that this app has no flag for. */
export const FALLBACK_FLAG = '🌍';

/** The static list, in the shape the pickers consume. */
export const STATIC_COUNTRIES: CountryOption[] = COUNTRIES.map((c) => ({
  code: c.code,
  name: c.name,
  flag: c.flag,
}));

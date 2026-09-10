import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The country list is read from `places` — the domain that owns geography —
 * rather than from this app's hand-maintained constant.
 *
 * The constant matched `places` exactly when this was written, so none of these
 * tests would have caught a bug *today*. They exist because nothing kept the two
 * in sync: the failure this prevents is a country added to the SSOT that never
 * reaches the app, and that failure is silent by construction.
 */

const toArray = vi.fn();
const find = vi.fn((_filter?: unknown, _options?: unknown) => ({ toArray }));
const collection = vi.fn((_name?: string) => ({ find }));
const getDomainDb = vi.fn(async () => ({ collection }));

vi.mock('@/lib/mongodb/client', () => ({
  getDomainDb: (...args: unknown[]) => getDomainDb(...(args as [])),
}));

const { getCountries, STATIC_COUNTRIES } = await import('@/lib/mongodb/places');

beforeEach(() => {
  vi.clearAllMocks();
  find.mockReturnValue({ toArray });
  collection.mockReturnValue({ find });
});

describe('getCountries', () => {
  it('reads countries from the places domain, not the local constant', async () => {
    toArray.mockResolvedValue([
      { isoCode: 'ZW', name: 'Zimbabwe' },
      { isoCode: 'NG', name: 'Nigeria' },
    ]);

    const result = await getCountries();

    expect(getDomainDb).toHaveBeenCalledWith('places');
    expect(collection).toHaveBeenCalledWith('placesGeo');
    // Only what places returned — the 54-entry constant is not merged in.
    expect(result.map((c) => c.code)).toEqual(['NG', 'ZW']);
  });

  it('queries only country records that carry an ISO code', async () => {
    toArray.mockResolvedValue([]);
    await getCountries();
    expect(find.mock.calls[0][0]).toMatchObject({ geoType: 'country' });
  });

  it('takes the name from places, not from the local constant', async () => {
    // If the two disagree, the owning domain is right by definition.
    toArray.mockResolvedValue([{ isoCode: 'ZW', name: 'Republic of Zimbabwe' }]);
    const [country] = await getCountries();
    expect(country.name).toBe('Republic of Zimbabwe');
  });

  it('decorates with the local flag', async () => {
    toArray.mockResolvedValue([{ isoCode: 'ZW', name: 'Zimbabwe' }]);
    const [country] = await getCountries();
    expect(country.flag).toBe('🇿🇼');
    // The accent colour that used to ride along here is gone: it was painted
    // behind the flag, so it was never visible, and it stated a hue next to a
    // national flag that nothing chose deliberately.
    expect(country).not.toHaveProperty('color');
  });

  it('still lists a country the app has no flag for', async () => {
    // THE point of the inversion. A country exists because `places` says so,
    // not because someone remembered to add art for it here — so a new one
    // appears with a placeholder rather than vanishing.
    toArray.mockResolvedValue([{ isoCode: 'FR', name: 'France' }]);
    const [country] = await getCountries();
    expect(country.code).toBe('FR');
    expect(country.flag).toBe('🌍');
  });

  it('sorts by name so the order does not depend on another domain', async () => {
    toArray.mockResolvedValue([
      { isoCode: 'ZW', name: 'Zimbabwe' },
      { isoCode: 'AO', name: 'Angola' },
      { isoCode: 'KE', name: 'Kenya' },
    ]);
    const result = await getCountries();
    expect(result.map((c) => c.name)).toEqual(['Angola', 'Kenya', 'Zimbabwe']);
  });

  it('skips malformed rows rather than rendering a nameless chip', async () => {
    toArray.mockResolvedValue([
      { isoCode: 'ZW', name: 'Zimbabwe' },
      { isoCode: 'XX' }, // no name
      { name: 'Nowhere' }, // no code
      { isoCode: '   ', name: 'Blank' },
    ]);
    const result = await getCountries();
    expect(result.map((c) => c.code)).toEqual(['ZW']);
  });

  it('falls back to the static list when the read throws', async () => {
    toArray.mockRejectedValue(new Error('cluster down'));
    const result = await getCountries();
    expect(result).toEqual(STATIC_COUNTRIES);
    expect(result.length).toBe(54);
  });

  it('treats an empty read as a failure, not as "no countries exist"', async () => {
    // `places` holding zero countries is not a real state, so an empty result
    // means the query or connection is wrong. Rendering an empty picker would
    // present that fault to the reader as a fact about the world.
    toArray.mockResolvedValue([]);
    const result = await getCountries();
    expect(result).toEqual(STATIC_COUNTRIES);
  });
});

describe('STATIC_COUNTRIES', () => {
  it('is the 54-country fallback, with presentation attached', () => {
    expect(STATIC_COUNTRIES).toHaveLength(54);
    for (const country of STATIC_COUNTRIES) {
      expect(country.code).toMatch(/^[A-Z]{2}$/);
      expect(country.name).toBeTruthy();
      expect(country.flag).toBeTruthy();
    }
  });
});

import { describe, it, expect } from 'vitest';
import { formatLocalDateTime } from '../local-time';

// 2026-09-10T12:00:00Z — noon UTC, which lands on three different clock faces
// in the three zones below.
const instant = new Date('2026-09-10T12:00:00.000Z');

describe('formatLocalDateTime', () => {
  it('renders the SAME instant on the reader’s own clock, not the server’s', () => {
    const harare = formatLocalDateTime(instant, { locale: 'en-GB', timeZone: 'Africa/Harare' });
    const utc = formatLocalDateTime(instant, { locale: 'en-GB', timeZone: 'UTC' });
    const newYork = formatLocalDateTime(instant, {
      locale: 'en-GB',
      timeZone: 'America/New_York',
    });

    // CAT is UTC+2, EDT is UTC-4 in September.
    expect(harare?.display).toContain('14:00');
    expect(utc?.display).toContain('12:00');
    expect(newYork?.display).toContain('08:00');

    expect(harare?.timeZone).toBe('Africa/Harare');
    expect(newYork?.timeZone).toBe('America/New_York');
  });

  it('crosses the date line into the previous day where the zone requires it', () => {
    // 01:00 UTC on the 10th is still the 9th in Honolulu (UTC-10).
    const early = new Date('2026-09-10T01:00:00.000Z');
    const honolulu = formatLocalDateTime(early, {
      locale: 'en-GB',
      timeZone: 'Pacific/Honolulu',
    });
    expect(honolulu?.display).toContain('9 Sep');
    expect(honolulu?.display).toContain('Wed');
  });

  it('defaults to the environment’s own zone and locale when none is given', () => {
    // No timeZone argument is precisely how the component calls it — that is
    // what makes Intl resolve the BROWSER's zone.
    const resolved = formatLocalDateTime(instant);
    expect(resolved?.timeZone).toBe(new Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('emits a machine-readable UTC instant for <time dateTime>', () => {
    // The `dateTime` attribute must be unambiguous regardless of which zone
    // the display string was rendered in.
    const harare = formatLocalDateTime(instant, { timeZone: 'Africa/Harare' });
    const newYork = formatLocalDateTime(instant, { timeZone: 'America/New_York' });
    expect(harare?.machine).toBe('2026-09-10T12:00:00.000Z');
    expect(newYork?.machine).toBe(harare?.machine);
  });

  it('carries the weekday, day and month as well as the time', () => {
    const display = formatLocalDateTime(instant, { locale: 'en-GB', timeZone: 'UTC' })?.display;
    expect(display).toContain('Thu');
    expect(display).toContain('10');
    expect(display).toContain('Sep');
  });

  it('returns null instead of throwing on an invalid date', () => {
    expect(formatLocalDateTime(new Date('nonsense'))).toBeNull();
    expect(formatLocalDateTime(undefined as unknown as Date)).toBeNull();
  });

  it('returns null instead of throwing on a zone Intl refuses', () => {
    // Intl throws a RangeError for an unknown IANA zone; the strip must render
    // its placeholder rather than take the header down.
    expect(formatLocalDateTime(instant, { timeZone: 'Mars/Olympus_Mons' })).toBeNull();
  });
});

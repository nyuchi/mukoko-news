/**
 * Reader for the mukoko-weather public embed API.
 *
 * `GET https://weather.mukoko.com/api/embed/current` (CORS `*`, edge runtime)
 * derives the location from the CALLER's IP via Vercel's
 * `x-vercel-ip-latitude` / `x-vercel-ip-longitude` headers.
 *
 * ── Why this module is browser-only ──────────────────────────────────────
 * Called server-side from mukoko-news, the "caller" is the Vercel datacenter,
 * not the reader: a call made from a datacenter came back
 * `{"name":"Your location","lat":37.751,"lon":-97.822}` — the geographic
 * centroid of the United States — so every Zimbabwean reader would be shown
 * Kansas weather, confidently and wrongly. The fetch therefore happens from
 * the reader's own browser after mount, where the IP is the reader's own. That
 * also matches the endpoint's own `Cache-Control: private, max-age=300` on the
 * IP path: a per-visitor response must never be shared-cached, and a browser
 * fetch is the only place that header means anything.
 *
 * We deliberately send NO params. The alternative — pinning `?slug=` from the
 * reader's country preference (`PreferencesContext`) — is worse on three
 * counts: the preference is a COUNTRY code (`ZW`) while the endpoint wants a
 * location slug (a city), so it would need a country-to-capital guess; the
 * preference is per-device localStorage, not per-account, so it does not
 * follow the reader anyway; and an unknown slug silently falls back to Harare,
 * which would present a guess as a fact. IP geo is at least the reader's real
 * network location, and it is what the endpoint was purpose-built to do.
 *
 * Every export here is pure or fail-soft. Nothing in this module ever throws:
 * the weather strip is decoration on a news site, and decoration must not be
 * able to take the header down with it.
 */

export const WEATHER_APP_URL = 'https://weather.mukoko.com';
export const WEATHER_EMBED_ENDPOINT = `${WEATHER_APP_URL}/api/embed/current`;

/** Give up rather than hold an open request against a slow/hung endpoint. */
export const WEATHER_REQUEST_TIMEOUT_MS = 6000;

/** Third-party text lands in our chrome — cap it so it cannot blow out the row. */
const MAX_TEXT_LENGTH = 48;

export type ConditionIconKey = 'clear' | 'cloudy' | 'drizzle' | 'rain' | 'snow' | 'storm' | 'fog';

export interface WeatherSnapshot {
  /** Display name of the place the reading is for, e.g. "Harare". */
  locationName: string | null;
  /** Temperature in degrees Celsius (the upstream app is Open-Meteo/metric). */
  temp: number | null;
  /** Human condition label, e.g. "Partly cloudy". */
  condition: string | null;
  /** WMO 4677 weather code, or null when the payload omitted a usable one. */
  code: number | null;
  isDay: boolean;
  /** Never null — falls back to the Mukoko Weather product itself. */
  attribution: { name: string; url: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * EVERY numeric in the embed payload is `number | null` — the upstream shaper
 * rounds and nulls non-finite values — so nothing may assume a number.
 */
function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Trim, strip control characters (this is third-party text), and cap length. */
function displayText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_TEXT_LENGTH
    ? `${cleaned.slice(0, MAX_TEXT_LENGTH - 1)}…`
    : cleaned;
}

/**
 * Only absolute https URLs are accepted as a link target. The value arrives
 * from another service and is rendered as an `href`; anything else (including
 * `javascript:` and `data:`) is dropped in favour of the product default.
 */
function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Pure shaper: the raw embed payload into what the strip can actually render.
 *
 * Returns null when there is nothing worth showing a reader (not an object, or
 * both the temperature and the condition are missing). A null return is the
 * signal to render no weather at all — never a placeholder, never a guess.
 */
export function normalizeWeather(raw: unknown): WeatherSnapshot | null {
  if (!isRecord(raw)) return null;

  const current = isRecord(raw.current) ? raw.current : {};
  const location = isRecord(raw.location) ? raw.location : {};
  const attribution = isRecord(raw.attribution) ? raw.attribution : {};

  const temp = finiteNumber(current.temp);
  const rawCondition = displayText(current.condition);
  // "Unknown" is literally what the upstream WMO map emits for a code it does
  // not recognise. It is a placeholder, not a condition — do not show it.
  const condition = rawCondition && rawCondition.toLowerCase() !== 'unknown' ? rawCondition : null;

  if (temp === null && condition === null) return null;

  return {
    locationName: displayText(location.name),
    temp,
    condition,
    code: finiteNumber(current.code),
    // Absent means "assume day" — the only effect is which glyph is drawn.
    isDay: current.isDay !== false,
    attribution: {
      name: displayText(attribution.name) ?? 'Mukoko Weather',
      url: safeHttpsUrl(attribution.url) ?? WEATHER_APP_URL,
    },
  };
}

/**
 * WMO 4677 code to an icon family. Pure, and total: an unknown or null code
 * answers 'cloudy' rather than throwing or leaving the glyph empty. The icon
 * is decoration only — the condition is always ALSO rendered as text, so a
 * reader never depends on the glyph (or on colour) to know the weather.
 */
export function conditionIconKey(code: number | null): ConditionIconKey {
  if (code === null) return 'cloudy';
  if (code <= 1) return 'clear';
  if (code <= 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain';
  if (code >= 85 && code <= 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloudy';
}

/**
 * Fetch + normalise the current conditions. Resolves to null on ANY problem —
 * offline, DNS failure, CORS rejection, non-2xx, timeout, malformed JSON, or a
 * payload with nothing renderable in it. It never rejects and never throws.
 */
export async function fetchCurrentWeather(): Promise<WeatherSnapshot | null> {
  if (typeof fetch !== 'function') return null;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer =
    controller && typeof setTimeout === 'function'
      ? setTimeout(() => controller.abort(), WEATHER_REQUEST_TIMEOUT_MS)
      : null;

  try {
    const response = await fetch(WEATHER_EMBED_ENDPOINT, {
      method: 'GET',
      headers: { accept: 'application/json' },
      // No cookies cross-origin; the endpoint is public and takes no auth.
      credentials: 'omit',
      mode: 'cors',
      // Let the browser honour the endpoint's own `private, max-age=300`
      // instead of forcing a network round-trip on every mount.
      cache: 'default',
      signal: controller ? controller.signal : undefined,
    });
    if (!response.ok) return null;
    return normalizeWeather(await response.json());
  } catch {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

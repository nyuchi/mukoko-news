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
 * ── IP geo is a guess, and on mobile it is often a bad one ───────────────
 * Owner report 2026-09-11: *"the weather is not location aware, it's pulling a
 * random place not actually where the user currently is."* Measured on a
 * Zimbabwean handset, the strip read **"Opposite Carrier Singapore"** — a
 * carrier-NAT egress, which is what mobile networks routinely present to IP
 * geolocation. The endpoint was doing its job; the input was wrong.
 *
 * So the endpoint's `?lat=`/`?lon=` path is used when, and only when, the
 * reader has granted the browser's Geolocation permission. Verified against
 * the live endpoint: no params returns `{"name":"Your location","lat":37.751,
 * "lon":-97.822}` (the US centroid, from this datacenter's IP), while
 * `?lat=-17.8252&lon=31.0335` returns `{"name":"Harare","country":"ZW"}`.
 *
 * Three rules on that, none of them optional:
 *
 *  1. **Never prompt on load.** `requestCoords()` is called on mount only when
 *     `navigator.permissions` already reports `granted`. Otherwise the strip
 *     shows a "Use my location" control and nothing happens until it is
 *     pressed. A news site that throws a location prompt at a first-time
 *     reader has spent trust it did not have.
 *  2. **Coarsen before sending.** Coordinates are rounded to 2dp (~1.1 km)
 *     before they leave the device. Weather does not vary at street level, and
 *     a precise fix is the reader's home address; the coarse one answers the
 *     same question.
 *  3. **Fail back to IP, never to a guess.** No permission, a denial, a
 *     timeout, a malformed fix — every one of them falls through to the
 *     param-less call. The old alternative considered here, pinning `?slug=`
 *     from the reader's COUNTRY preference, stays rejected: the preference is
 *     a country code (`ZW`) and the endpoint wants a city slug, an unknown
 *     slug silently falls back to Harare, and presenting that guess as a fact
 *     is the failure this whole module exists to avoid.
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

/** Give up on a position fix rather than leave the strip waiting on it. */
export const GEOLOCATION_TIMEOUT_MS = 8000;

/**
 * Where the reader's last granted fix is remembered, so a second visit does
 * not need the permission round-trip before the weather is right.
 */
export const COORDS_STORAGE_KEY = 'mukoko-news-coords';

/** A position, already coarsened — see rule 2 in the module docblock. */
export interface Coords {
  lat: number;
  lon: number;
}

/**
 * Round to ~1.1 km and reject anything that is not a real position.
 *
 * Returns null rather than clamping: a latitude of 800 is not a reader near
 * the pole, it is a bug or a hostile value, and sending a clamped version of
 * it would turn nonsense into a plausible-looking place name.
 */
export function coarsenCoords(lat: unknown, lon: unknown): Coords | null {
  const la = finiteNumber(lat);
  const lo = finiteNumber(lon);
  if (la === null || lo === null) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  return { lat: Math.round(la * 100) / 100, lon: Math.round(lo * 100) / 100 };
}

/** Parse a stored pair. Anything unexpected reads as "nothing stored". */
export function parseStoredCoords(raw: string | null | undefined): Coords | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    return coarsenCoords(parsed.lat, parsed.lon);
  } catch {
    return null;
  }
}

/** Read the remembered fix. Never throws — blocked storage returns null. */
export function readStoredCoords(): Coords | null {
  try {
    return parseStoredCoords(window.localStorage.getItem(COORDS_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Remember a fix, or forget it when passed null. Never throws. */
export function storeCoords(coords: Coords | null): void {
  try {
    if (coords) window.localStorage.setItem(COORDS_STORAGE_KEY, JSON.stringify(coords));
    else window.localStorage.removeItem(COORDS_STORAGE_KEY);
  } catch {
    /* private mode, blocked storage — this visit still uses the fix in memory */
  }
}

export type GeolocationAvailability = 'granted' | 'prompt' | 'denied' | 'unsupported';

/**
 * What the browser will do if asked — WITHOUT asking.
 *
 * This is the whole reason the strip can use a real position without ever
 * springing a permission dialog on a first-time reader: `granted` means the
 * reader has already said yes, so the fix can be taken silently; anything else
 * means the control has to be pressed first. `navigator.permissions` is not
 * universally implemented, and Safari in particular has shipped without
 * geolocation in it, so an unanswerable query reads as `prompt` — offer the
 * control, do not act unilaterally.
 */
export async function geolocationAvailability(): Promise<GeolocationAvailability> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unsupported';
  try {
    const permissions = navigator.permissions;
    if (!permissions?.query) return 'prompt';
    const status = await permissions.query({ name: 'geolocation' as PermissionName });
    if (status.state === 'granted' || status.state === 'denied') return status.state;
    return 'prompt';
  } catch {
    return 'prompt';
  }
}

/**
 * Ask the browser for a position. Resolves to null on any problem — no
 * permission, a denial, a timeout, an unusable fix — and never rejects.
 *
 * `maximumAge` lets the browser hand back a cached fix: the reader has not
 * moved far enough in five minutes to change the weather, and a cached fix
 * avoids waking the radio.
 */
export async function requestCoords(): Promise<Coords | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return new Promise<Coords | null>((resolve) => {
    let settled = false;
    const done = (value: Coords | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => done(coarsenCoords(position.coords?.latitude, position.coords?.longitude)),
        () => done(null),
        { enableHighAccuracy: false, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 5 * 60_000 }
      );
    } catch {
      done(null);
    }
  });
}

/**
 * The URL to call for a reading. With coordinates it names the reader's actual
 * place; without them the endpoint falls back to its IP lookup.
 */
export function weatherEndpointUrl(coords: Coords | null): string {
  if (!coords) return WEATHER_EMBED_ENDPOINT;
  const url = new URL(WEATHER_EMBED_ENDPOINT);
  url.searchParams.set('lat', String(coords.lat));
  url.searchParams.set('lon', String(coords.lon));
  return url.toString();
}

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
export async function fetchCurrentWeather(
  coords: Coords | null = null
): Promise<WeatherSnapshot | null> {
  if (typeof fetch !== 'function') return null;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer =
    controller && typeof setTimeout === 'function'
      ? setTimeout(() => controller.abort(), WEATHER_REQUEST_TIMEOUT_MS)
      : null;

  try {
    const response = await fetch(weatherEndpointUrl(coords), {
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

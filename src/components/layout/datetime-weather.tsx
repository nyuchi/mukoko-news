'use client';

import { useEffect, useState } from 'react';
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Moon,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { formatLocalDateTime } from '@/lib/local-time';
import {
  conditionIconKey,
  fetchCurrentWeather,
  type ConditionIconKey,
  type WeatherSnapshot,
} from '@/lib/weather';

/**
 * The header's date/time + weather strip.
 *
 * Two independent pieces of state, each of which degrades on its own:
 *
 *  • The CLOCK is client-only. A server render happens in the datacenter's
 *    timezone, so any time in the SSR HTML is both wrong for the reader and a
 *    guaranteed hydration mismatch. The server (and the first client render)
 *    emit an `invisible` placeholder of representative width instead, so the
 *    row is already exactly its final size before the real time replaces it.
 *
 *  • The WEATHER is fetched from the reader's own browser (see `lib/weather`
 *    for why it cannot be fetched server-side) and is null until it lands —
 *    and stays null forever if the endpoint is slow, blocked, erroring, or
 *    returns a payload with nothing in it. Null renders nothing at all. The
 *    row's `min-h` is set by the clock side, so weather arriving late (or
 *    never) changes no height, and because it is the flex row's END item its
 *    appearance cannot move the date either.
 *
 * There is no animation anywhere in here — nothing to reduce under
 * `prefers-reduced-motion`, and no ticker/marquee by design.
 */

const CONDITION_ICONS: Record<ConditionIconKey, LucideIcon> = {
  clear: Sun,
  cloudy: Cloud,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
  fog: CloudFog,
};

/** Re-read the clock often enough that the displayed minute is never stale. */
const CLOCK_TICK_MS = 30_000;
/** The endpoint caches for 5 minutes; refreshing faster would only burn calls. */
const WEATHER_REFRESH_MS = 10 * 60_000;

/**
 * Representative placeholder text. Same font/size as the real string, so it
 * reserves the row's height and roughly its width; `invisible` (not `hidden`)
 * keeps it in the layout.
 */
const CLOCK_PLACEHOLDER = 'Wed 10 Sep, 00:00';

function WeatherReading({ weather }: { weather: WeatherSnapshot }) {
  const iconKey = conditionIconKey(weather.code);
  // A clear sky after dark is a moon, not a sun; every other condition looks
  // the same at night.
  const Icon = !weather.isDay && iconKey === 'clear' ? Moon : CONDITION_ICONS[iconKey];

  // The upstream app serves Open-Meteo metric values; Zimbabwe (its primary
  // market, and ours) is a Celsius country. The unit is spelled out rather
  // than left as a bare degree glyph.
  const temperature = weather.temp === null ? null : `${weather.temp}°C`;

  // A single spoken sentence: which place, how warm, what it is doing. The
  // glyph is aria-hidden, so nothing here depends on seeing an icon or a hue.
  const spoken = [
    weather.locationName ? `Weather in ${weather.locationName}` : 'Current weather',
    weather.temp === null ? null : `${weather.temp} degrees Celsius`,
    weather.condition,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <a
      href={weather.attribution.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${spoken}. Opens ${weather.attribution.name}.`}
      className="flex min-h-[var(--touch-chip)] max-w-[65%] items-center gap-1.5 rounded-full px-2 text-text-secondary transition-colors hover:bg-elevated hover:text-foreground focus-visible:bg-elevated focus-visible:text-foreground"
    >
      <Icon
        aria-hidden="true"
        className="h-[var(--icon-sm)] w-[var(--icon-sm)] shrink-0 text-cobalt"
      />
      {temperature && <span className="font-mono tabular-nums">{temperature}</span>}
      {weather.condition && <span className="truncate">{weather.condition}</span>}
      {weather.locationName && (
        <span className="hidden truncate text-text-tertiary sm:inline">
          · {weather.locationName}
        </span>
      )}
      {/* The attribution the API returns, credited in the chrome itself on
          wide screens and always in the link's accessible name. */}
      <span className="hidden truncate text-text-tertiary lg:inline">
        · {weather.attribution.name}
      </span>
    </a>
  );
}

export function DateTimeWeather() {
  const [now, setNow] = useState<Date | null>(null);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);

  // Clock: starts only after mount, so the server never renders a time.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Weather: browser-side, fail-soft, and cancelled on unmount so a late
  // response cannot set state on a component that is gone.
  useEffect(() => {
    let active = true;

    const load = () => {
      fetchCurrentWeather()
        .then((snapshot) => {
          if (active) setWeather(snapshot);
        })
        .catch(() => {
          // fetchCurrentWeather already swallows everything; this is belt and
          // braces so a future change there can never surface an unhandled
          // rejection in the header.
          if (active) setWeather(null);
        });
    };

    load();
    const id = setInterval(load, WEATHER_REFRESH_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const local = now ? formatLocalDateTime(now) : null;

  return (
    <div
      data-testid="datetime-weather"
      className="flex min-h-[var(--touch-chip)] items-center justify-between gap-3 text-[11px] sm:text-xs"
    >
      <p className="min-w-0 truncate font-mono tabular-nums text-text-secondary">
        {local ? (
          <time dateTime={local.machine} title={local.timeZone ?? undefined}>
            {local.display}
          </time>
        ) : (
          <span className="invisible" aria-hidden="true">
            {CLOCK_PLACEHOLDER}
          </span>
        )}
      </p>

      {weather ? <WeatherReading weather={weather} /> : null}
    </div>
  );
}

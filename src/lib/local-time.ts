/**
 * Local date/time formatting for the header strip.
 *
 * The reader's clock is the READER's, not the server's. A Next.js server
 * renders in the datacenter's timezone (UTC on Vercel), so any time put into
 * the SSR HTML is both wrong for the reader and a guaranteed hydration
 * mismatch the moment the client renders its own. The component therefore
 * renders a placeholder on the server and calls this on mount, with no
 * explicit `timeZone`/`locale` — which is what makes `Intl` resolve the
 * BROWSER's zone and locale.
 *
 * `timeZone` and `locale` are still parameters so the behaviour is testable
 * without mutating the process clock: passing them exercises exactly the code
 * path the component uses, with a zone the test chooses.
 */

export interface LocalDateTime {
  /** Human string in the target locale + zone, e.g. "Wed 10 Sep, 14:32". */
  display: string;
  /** Machine-readable instant for `<time dateTime>` (ISO 8601, UTC). */
  machine: string;
  /** IANA zone the display was rendered in, e.g. "Africa/Harare". */
  timeZone: string | null;
}

export interface LocalDateTimeOptions {
  /** BCP-47 tag. Omit (the default) to use the reader's own locale. */
  locale?: string;
  /** IANA zone. Omit (the default) to use the reader's own zone. */
  timeZone?: string;
}

/**
 * Format an instant for display in the reader's own locale and timezone.
 *
 * Returns null for an invalid date or if `Intl` refuses the options (an
 * unknown IANA zone throws a RangeError) — the caller then renders the
 * reserved placeholder rather than a broken string. This never throws.
 */
export function formatLocalDateTime(
  date: Date,
  options: LocalDateTimeOptions = {}
): LocalDateTime | null {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;

  try {
    const formatter = new Intl.DateTimeFormat(options.locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: options.timeZone,
    });

    return {
      display: formatter.format(date),
      machine: date.toISOString(),
      timeZone: formatter.resolvedOptions().timeZone ?? null,
    };
  } catch {
    return null;
  }
}

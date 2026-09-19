/**
 * Counting what an anonymous reader has already had.
 *
 * `@/lib/access` declares the policy — 50 articles, 5 searches, no AI summary
 * for a stranger; unlimited reading and five summaries once signed in. This
 * module is the other half: it counts, so `withinAllowance` has a number to
 * compare against. It holds no policy of its own and no numbers.
 *
 * ## ⚠️ These are CONVERSION gates, not confidentiality gates
 *
 * The count lives in the reader's own `localStorage`, so a determined reader
 * clears it in a keystroke. That is a deliberate trade and not laziness, for
 * two reasons this codebase has already paid for once each:
 *
 *  1. **`robots.txt` here deliberately courts crawlers and answer engines, and
 *     for an aggregator indexed traffic IS the asset.** A server-side wall
 *     treats a crawler as an anonymous reader, so past the allowance Googlebot
 *     gets the wall instead of the article — which quietly deletes the product
 *     from search. This is the identical hazard that made the welcome gate a
 *     client overlay rather than server-rendered chrome, and it applies to
 *     every metered surface regardless of how that surface renders.
 *  2. **The metered surfaces that ARE prerendered would lose it.** Measured on
 *     a production build: `/`, `/search`, `/discover` and `/insights` are all
 *     `○`. Counting searches server-side means `/search` reads a session,
 *     which makes it `ƒ`.
 *
 * ⚠️ One correction to the obvious version of this argument, because the
 * obvious version is wrong and was written here first: **`/article/[id]` is
 * already `ƒ` dynamic** and was before any of this — so "a server-side count
 * would cost the article route its ISR" is simply not true, and citing it
 * would have been a confident claim nobody had checked. For articles the
 * binding reason is (1) alone, which is sufficient on its own.
 *
 * So the wall is added in the browser, over a page that was served in full. A
 * reader who wants to defeat it can; a reader who is merely at their fiftieth
 * article is asked to sign up, which is the entire objective. **Nothing behind
 * a meter may be a secret**, because the payload was already delivered. If
 * something genuinely must not leave the server, it needs a session-gated
 * action of its own — never a meter.
 *
 * Interactions are the counter-example and are gated properly, server-side, in
 * the engagement Route Handlers: those are POSTs rather than indexed pages, so
 * gating them costs neither ISR nor a crawler.
 *
 * ## No reset window, deliberately
 *
 * A stranger gets fifty articles on this device, not fifty a month. The ask was
 * "similar to how Instagram and TikTok work", and those are one-way walls — the
 * point is the account, and a window that silently reopens the door removes the
 * reason to make one. A rolling window is a perfectly reasonable different
 * product decision, but it is a *pricing* decision and inventing one here would
 * be this repo's own forbidden move: a number nobody chose, applied as fact.
 * Adding one later is one field on the stored shape and one comparison here.
 */

import type { Meter } from "@/lib/access";

/** One storage key per meter, so a reset of one never clears another. */
const KEYS: Record<Meter, string> = {
  articles: "mukoko-news-meter-articles",
  searches: "mukoko-news-meter-searches",
  "ai-summary": "mukoko-news-meter-ai-summary",
};

/**
 * How many distinct ids a deduplicating meter will remember.
 *
 * The list exists only to answer "have I already counted this one", and once
 * the reader is past their allowance the answer stops mattering — they are
 * walled either way. Capping it keeps a long-lived device from accumulating an
 * unbounded array in storage. It is generous enough that the dedupe is exact
 * for every count that can still change a decision.
 */
const MAX_REMEMBERED_IDS = 200;

export interface MeterReading {
  /** How many have been used. `0` whenever the count cannot be read. */
  used: number;
  /** The distinct ids counted, for a deduplicating meter. */
  ids: string[];
}

const EMPTY: MeterReading = { used: 0, ids: [] };

/**
 * ⚠️ A storage failure reads as ZERO USED — the opposite of `withinAllowance`,
 * on purpose.
 *
 * `withinAllowance` treats a broken count as exhausted, because a non-finite or
 * negative `used` can only come from a miswired counter and the safe reading of
 * a broken counter is not "unlimited". A storage read that *throws* is a
 * different thing entirely: it is a reader in a private window, or one who has
 * blocked site data. Walling them permanently would make the product unusable
 * for a choice they are entitled to make, and they are not exempt from the
 * wall — they simply start again next visit.
 *
 * This is the same rule the welcome gate follows: storage failing must not trap
 * anyone.
 */
export function readMeter(meter: Meter): MeterReading {
  const key = KEYS[meter];
  if (!key || typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY;
    const { used, ids } = parsed as { used?: unknown; ids?: unknown };
    const list = Array.isArray(ids)
      ? ids.filter((v): v is string => typeof v === "string")
      : [];
    // A count below the number of remembered ids is a corrupted record; the ids
    // are the harder evidence, so they win.
    const n =
      typeof used === "number" && Number.isFinite(used) && used >= 0
        ? Math.floor(used)
        : 0;
    return { used: Math.max(n, list.length), ids: list };
  } catch {
    return EMPTY;
  }
}

/** Persist a reading. Silent on failure — see `readMeter`. */
function writeMeter(meter: Meter, reading: MeterReading): void {
  const key = KEYS[meter];
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        used: reading.used,
        ids: reading.ids.slice(-MAX_REMEMBERED_IDS),
      }),
    );
  } catch {
    // A reader who cannot be counted is not walled. Nothing to do.
  }
}

/**
 * Count one use of `meter`, returning the new total.
 *
 * With an `id`, the meter deduplicates: re-reading the same article, or
 * refreshing it, does not spend a second one. Without an `id` every call counts
 * — a search is an event, not a thing.
 */
export function recordMeterUse(meter: Meter, id?: string): number {
  const current = readMeter(meter);
  if (id !== undefined) {
    if (current.ids.includes(id)) return current.used;
    const next: MeterReading = {
      used: current.used + 1,
      ids: [...current.ids, id],
    };
    writeMeter(meter, next);
    return next.used;
  }
  const next: MeterReading = { used: current.used + 1, ids: current.ids };
  writeMeter(meter, next);
  return next.used;
}

/**
 * Forget a meter.
 *
 * Called when a reader signs in: their anonymous tally has done its job and
 * must not follow them, or signing out would drop them straight back onto a
 * wall they already answered. It is the metering counterpart of
 * `claimSessionEngagement`, which does the same for likes and saves.
 */
export function clearMeter(meter: Meter): void {
  const key = KEYS[meter];
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to do; a stale tally is harmless next to trapping a reader.
  }
}

/** Forget every meter. */
export function clearAllMeters(): void {
  (Object.keys(KEYS) as Meter[]).forEach(clearMeter);
}

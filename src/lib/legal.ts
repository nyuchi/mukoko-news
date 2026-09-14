/**
 * The published terms, and which version a reader has accepted.
 *
 * ## One version, three consumers
 *
 * `/terms`, `/privacy` and the first-run acceptance screen must agree about
 * WHICH text is current. They only can if they read the same constant, so this
 * is the single place the version and its date are written down — the pages
 * render `LEGAL_LAST_UPDATED` rather than a hand-typed month, and the
 * acceptance screen stores `LEGAL_VERSION` rather than a boolean.
 *
 * ## Why the stored value is a version and not `true`
 *
 * A boolean records that somebody once accepted something. It cannot tell you
 * WHAT they accepted, so a later material change to the terms is unannounceable
 * — every existing reader stays silently on a record of consent to text that no
 * longer exists. Storing the version means `LEGAL_VERSION !== accepted` is a
 * question the app can ask, and a future change can re-prompt exactly the
 * readers whose acceptance predates it.
 *
 * Bump this ONLY for a material change. A typo fix that re-prompts every reader
 * on the platform trains them to dismiss the screen without reading it, which
 * is worse than not showing it.
 */
export const LEGAL_VERSION = "2026-09-14";

/** Human-facing date for the same revision. Rendered on both legal pages. */
export const LEGAL_LAST_UPDATED = "14 September 2026";

/**
 * Where the accepted version is kept.
 *
 * `localStorage`, so it is per-device and per-browser — the same treatment
 * `PreferencesContext` already gets. That is a deliberate limitation rather
 * than an oversight: binding acceptance to an account would mean the screen
 * could not be shown to the anonymous readers who are most of the audience,
 * and every signed-out visit would have to either block or silently skip it.
 *
 * The cost is that a reader who clears storage, or opens the site in a second
 * browser, is asked again. That is the right direction to fail — asking twice
 * is a small annoyance, whereas assuming consent that was never given on this
 * device is the thing worth avoiding.
 */
export const LEGAL_ACCEPTANCE_KEY = "mukoko-news-terms-accepted";

/**
 * Has this reader accepted the CURRENT terms?
 *
 * Reads storage defensively: a private window, blocked site data, or a
 * disabled-storage browser all make `localStorage` throw rather than return
 * null. A throw here must not decide the answer, and it must not break the
 * page — it simply means we cannot prove acceptance, so the screen is shown.
 */
export function hasAcceptedCurrentTerms(): boolean {
  try {
    return window.localStorage.getItem(LEGAL_ACCEPTANCE_KEY) === LEGAL_VERSION;
  } catch {
    return false;
  }
}

/**
 * Record acceptance of the current terms.
 *
 * Fail-soft for the same reason as the read: if storage is unavailable the
 * reader has still accepted, and the app must not error at them over it. They
 * will be asked again next visit, which is the honest consequence of a browser
 * that will not remember anything.
 */
export function recordTermsAcceptance(): void {
  try {
    window.localStorage.setItem(LEGAL_ACCEPTANCE_KEY, LEGAL_VERSION);
  } catch {
    // Nothing to do — see above.
  }
}

/**
 * What Mukoko is, in one sentence, for every surface that needs to say it.
 *
 * The position is load-bearing rather than decorative: Mukoko aggregates and
 * links, it does not publish. Stating it differently in different places is how
 * a platform ends up having claimed, somewhere, to be the publisher of
 * somebody else's article.
 */
export const AGGREGATOR_STATEMENT =
  "Mukoko News is a news aggregator. We provide the vehicle — the index, the search, the feed — and we do not publish news. Every article, headline, photograph and video belongs to the newsroom that produced it.";

/**
 * Contrast — the second half of the theme.
 *
 * ## One setting, three states, exactly like the theme
 *
 * `off` | `on` | `system`, the same shape as Light | Dark | System, and for the
 * same reason: **the site's setting has to win in both directions.** Owner
 * report 2026-09-11 — *"the increase contrast toggle was on in system
 * settings; when turned off I saw it work, but like the theme it needs to
 * disable it on the site or have it on."*
 *
 * That is the whole history of this module in one line. It shipped as a pair of
 * values (outlines on/off) sitting UNDER an unconditional
 * `@media (prefers-contrast: more)` block, so a reader with the OS switch on
 * got the high-contrast treatment whatever the control said — a setting that
 * says Off and is not off. The first fix made the OS query a third choice but
 * only for the EDGES; the text lift stayed unconditional, so `off` still was
 * not off. It is now the whole treatment, and `off` means off.
 *
 * ## Resolved in JS, not in CSS — and that is what makes it work
 *
 * `system` is resolved here against `matchMedia('(prefers-contrast: more)')`
 * and a single attribute is stamped on `<html>`, precisely as the theme
 * resolves `system` to a `light`/`dark` class. The stylesheet then has ONE
 * rule, `:root[data-contrast='more']`, and no media query at all.
 *
 * Expressing it in CSS instead means duplicating the whole declaration block —
 * once for `[data-contrast='on']` and once inside the media query for
 * `[data-contrast='system']` — and two copies of a palette drift. Worse, a
 * media query cannot be overridden by a preference that is not also in the
 * cascade, which is exactly the bug being fixed.
 *
 * ## Per-device, like the other preferences here
 *
 * `localStorage`, same as the theme. It does not follow the account across the
 * Mukoko apps yet — a known gap recorded with the rest of them, not a decision
 * made here.
 */

export type ContrastPreference = 'off' | 'on' | 'system'

/** What the document is actually rendering: the treatment, or not. */
export type ResolvedContrast = 'standard' | 'more'

/**
 * Storage key.
 *
 * The pre-paint bootstrap in `layout.tsx` reads this as a STRING LITERAL — it
 * has to, because it runs before any module is evaluated. The two cannot import
 * from each other, so a test asserts they still agree; that is the only thing
 * standing between a rename here and a setting that silently stops applying.
 */
export const CONTRAST_STORAGE_KEY = 'mukoko-news-contrast'

/** The attribute the CSS keys off. Carries the RESOLVED value, never the preference. */
export const CONTRAST_ATTRIBUTE = 'data-contrast'

/** The OS signal `system` follows. One string, used by the provider and the bootstrap. */
export const CONTRAST_QUERY = '(prefers-contrast: more)'

/**
 * Anything that is not one of the three exact strings is `off`.
 *
 * Deliberately strict, and the DEFAULT is `off` rather than `system`: a reader
 * who has never opened this control has not asked for the treatment, and
 * inheriting it from an OS switch they set for unrelated reasons is the exact
 * complaint this module exists to answer. `system` is one tap away for a reader
 * who does want their device to decide.
 */
export function parseContrastPreference(raw: string | null | undefined): ContrastPreference {
  return raw === 'on' || raw === 'system' ? raw : 'off'
}

/**
 * The preference plus the OS signal, as the one value the stylesheet sees.
 *
 * `on` and `off` ignore `systemAsks` entirely — that is what "the site's
 * setting wins in both directions" means, and asserting it is cheaper than
 * arguing about it later.
 */
export function resolveContrast(
  preference: ContrastPreference,
  systemAsks: boolean
): ResolvedContrast {
  if (preference === 'on') return 'more'
  if (preference === 'off') return 'standard'
  return systemAsks ? 'more' : 'standard'
}

/** Does the device ask for more contrast? Never throws — an unanswerable query is a no. */
export function systemAsksForContrast(): boolean {
  try {
    return window.matchMedia(CONTRAST_QUERY).matches
  } catch {
    return false
  }
}

/** Read the stored preference. Never throws — private mode and blocked storage return the default. */
export function readContrastPreference(): ContrastPreference {
  try {
    return parseContrastPreference(window.localStorage.getItem(CONTRAST_STORAGE_KEY))
  } catch {
    return 'off'
  }
}

/** Persist the preference. Never throws; a failed write costs the setting, not the page. */
export function storeContrastPreference(preference: ContrastPreference): void {
  try {
    window.localStorage.setItem(CONTRAST_STORAGE_KEY, preference)
  } catch {
    /* private mode, blocked storage — the attribute below still applies for this session */
  }
}

/**
 * Apply the RESOLVED value to the document.
 *
 * `standard` REMOVES the attribute rather than writing it, and that is
 * load-bearing rather than tidiness: the single CSS rule names
 * `[data-contrast='more']` positively, so an absent attribute is the standard
 * look. A reader whose bootstrap never ran — JS off, blocked storage, a throw —
 * gets the standard palette rather than a treatment they cannot switch off.
 */
export function applyContrast(
  resolved: ResolvedContrast,
  root: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void }
): void {
  if (resolved === 'more') root.setAttribute(CONTRAST_ATTRIBUTE, 'more')
  else root.removeAttribute(CONTRAST_ATTRIBUTE)
}

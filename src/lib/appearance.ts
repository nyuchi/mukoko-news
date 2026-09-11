/**
 * Reader-controlled appearance options that are NOT the theme.
 *
 * Right now that is one thing: whether components draw a visible outline.
 *
 * ## Why this is a setting and not the default
 *
 * A card is a surface. It reads as a separate object because its fill differs
 * from the page, its corners are rounded and its content is inset — not because
 * a 1px line is drawn around it. Outlining every component makes the whole app
 * look like a high-contrast theme nobody asked for, and it flattens hierarchy:
 * when everything is boxed, nothing is emphasised.
 *
 * But outlines are exactly the right answer for a reader who wants more edge
 * definition, so they stay one toggle away rather than being deleted. The CSS
 * side is a single token (`--outline` in `globals.css`), transparent by default
 * and switched on by `data-outlines="on"` on the root element.
 *
 * ## Why there are THREE values and not two (owner report 2026-09-11)
 *
 * `prefers-contrast: more` used to turn outlines on regardless of this setting,
 * on the argument that a reader who asked their OS for more contrast is asking
 * for the edge. Measured on the owner's phone with the OS "Increase Contrast"
 * switch on, that is what it actually produced: every card, panel, chip and the
 * nav pill outlined, with the Appearance card showing "Off — Separated by fill"
 * selected. *"The contrast is still appearing in dark mode even though it's
 * off."*
 *
 * A setting that says Off and is not off is worse than no setting. So the OS
 * query is now one of the three CHOICES rather than an override on top of them:
 *
 *   - `off`     — no component outlines, whatever the OS asks. The default.
 *   - `on`      — always outlined.
 *   - `system`  — outlined only under `prefers-contrast: more`.
 *
 * The OS signal is not discarded — it still lifts `--text-secondary` /
 * `--text-tertiary` to full foreground unconditionally, which is the part of
 * "make differences easier to see" that is about READING rather than about
 * drawing boxes. What it no longer does is overrule a reader who has said no.
 *
 * ## Per-device, like the other preferences here
 *
 * `localStorage`, same as the theme and `PreferencesContext`. It does not
 * follow the account across the Mukoko apps yet — that is a known gap, recorded
 * in the same place as the rest of them, not a decision made here.
 */

export type OutlinePreference = 'on' | 'off' | 'system'

/**
 * Storage key.
 *
 * The pre-paint bootstrap script in `layout.tsx` reads this key as a STRING
 * LITERAL — it has to, because it runs before any module is evaluated. The two
 * cannot import from each other, so a test asserts they still agree; that is
 * the only thing standing between a rename here and a setting that silently
 * stops applying.
 */
export const OUTLINE_STORAGE_KEY = 'mukoko-news-outlines'

/** The attribute the CSS keys off. */
export const OUTLINE_ATTRIBUTE = 'data-outlines'

/**
 * Only the two exact strings are honoured; everything else is off.
 *
 * Deliberately strict rather than truthy: a half-written or foreign value in
 * localStorage must land on the default look, not on an outlined app the
 * reader never asked for and would have no idea how to turn off. That is also
 * why the DEFAULT is `off` rather than `system` — a reader who has never opened
 * this control has not asked for edges, and inheriting them from an OS switch
 * they set for other reasons is exactly the complaint this answers.
 */
export function parseOutlinePreference(raw: string | null | undefined): OutlinePreference {
  return raw === 'on' || raw === 'system' ? raw : 'off'
}

/** Read the stored preference. Never throws — private mode and blocked storage both return the default. */
export function readOutlinePreference(): OutlinePreference {
  try {
    return parseOutlinePreference(window.localStorage.getItem(OUTLINE_STORAGE_KEY))
  } catch {
    return 'off'
  }
}

/** Persist the preference. Never throws; a failed write costs the setting, not the page. */
export function storeOutlinePreference(preference: OutlinePreference): void {
  try {
    window.localStorage.setItem(OUTLINE_STORAGE_KEY, preference)
  } catch {
    /* private mode, blocked storage — the attribute below still applies for this session */
  }
}

/**
 * Apply the preference to the document.
 *
 * `off` REMOVES the attribute rather than writing `"off"`, and that is
 * load-bearing rather than tidiness: an ABSENT attribute must mean the quiet
 * look, so a reader with JavaScript disabled, blocked storage, or a bootstrap
 * that threw gets no outlines instead of inheriting whatever their OS asked
 * for. Every rule that draws an edge names `[data-outlines='on']` or
 * `[data-outlines='system']` positively; nothing keys off the absence.
 */
export function applyOutlinePreference(
  preference: OutlinePreference,
  root: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void }
): void {
  if (preference === 'off') root.removeAttribute(OUTLINE_ATTRIBUTE)
  else root.setAttribute(OUTLINE_ATTRIBUTE, preference)
}

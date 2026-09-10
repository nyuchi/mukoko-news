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
 * `prefers-contrast: more` turns them on regardless of this setting, and that
 * is not a courtesy: that media block replaces every surface with `Canvas`, so
 * page, card and hover row become one colour and fill can no longer separate
 * anything. The outline is the only separation left.
 *
 * ## Per-device, like the other preferences here
 *
 * `localStorage`, same as the theme and `PreferencesContext`. It does not
 * follow the account across the Mukoko apps yet — that is a known gap, recorded
 * in the same place as the rest of them, not a decision made here.
 */

export type OutlinePreference = 'on' | 'off'

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
 * Anything that is not exactly `"on"` is off.
 *
 * Deliberately strict rather than truthy: a half-written or foreign value in
 * localStorage must land on the default look, not on an outlined app the
 * reader never asked for and would have no idea how to turn off.
 */
export function parseOutlinePreference(raw: string | null | undefined): OutlinePreference {
  return raw === 'on' ? 'on' : 'off'
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
 * `off` REMOVES the attribute rather than setting it to `"off"`, so the CSS
 * selector stays a plain `[data-outlines='on']` and there is exactly one state
 * that means "outlined".
 */
export function applyOutlinePreference(
  preference: OutlinePreference,
  root: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void }
): void {
  if (preference === 'on') root.setAttribute(OUTLINE_ATTRIBUTE, 'on')
  else root.removeAttribute(OUTLINE_ATTRIBUTE)
}

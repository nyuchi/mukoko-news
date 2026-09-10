/**
 * The mineral a category is drawn in.
 *
 * ## What this replaces
 *
 * Two separate colour tables, both raw Tailwind palette:
 *
 * - `CATEGORY_META[].color` in `constants.ts` — eighteen flat `bg-<hue>-<step>`
 *   utilities, painted as the circle behind a category emoji.
 * - A second, private `categoryMeta` in `app/categories/page.tsx` — twelve
 *   `from-<hue>-500 to-<hue>-700` gradients on a card with a hard-coded
 *   `text-white`. Mzizi's doctrine is explicit that the palette takes **no
 *   gradients**, and `text-white` is a foreground with no matching ground
 *   token: it worked only because the gradient happened always to be dark.
 *
 * The two tables covered overlapping but different category sets and disagreed
 * where they met — `technology` was `bg-blue-500` in one and a cyan gradient in
 * the other, `health` green in one and red in the other — so the same category
 * was two colours depending on which page you were looking at. Neither value
 * came from the design system.
 *
 * ## Why containers, not the base minerals
 *
 * A category chip is a *surface with text on it*, so it needs a matched pair.
 * The mineral containers ship exactly that — `--container-<mineral>` and
 * `--on-container-<mineral>` — and both sides are redefined per theme, so a
 * chip that is legible in light mode is legible in dark mode by construction
 * rather than by a second hand-picked value. The saturated base minerals are
 * for marks and fills, not for text grounds.
 *
 * ## Assignment is deterministic, not semantic
 *
 * Seven minerals, more categories than that, and no honest way to say which
 * mineral *means* "agriculture". So known categories are assigned by hand for
 * stability (the same category is always the same colour, which is the only
 * property that matters for recognition), and anything unknown hashes onto the
 * ring. A category the pipeline invents tomorrow gets a stable colour without a
 * code change, and never falls through to an `undefined` class.
 */

export type Mineral =
  | 'tanzanite'
  | 'cobalt'
  | 'malachite'
  | 'gold'
  | 'terracotta'
  | 'sodalite'
  | 'copper'

const RING: readonly Mineral[] = [
  'tanzanite',
  'cobalt',
  'malachite',
  'gold',
  'terracotta',
  'sodalite',
  'copper',
]

/**
 * Hand-assigned minerals for the categories the corpus actually carries.
 *
 * Spread across the ring so adjacent cards in a grid do not repeat, and kept
 * fixed so a reader learns "business is malachite" and it stays true.
 */
const ASSIGNED: Record<string, Mineral> = {
  politics: 'tanzanite',
  business: 'malachite',
  economy: 'malachite',
  technology: 'cobalt',
  science: 'cobalt',
  sports: 'terracotta',
  entertainment: 'copper',
  culture: 'copper',
  lifestyle: 'copper',
  health: 'sodalite',
  education: 'gold',
  agriculture: 'gold',
  environment: 'malachite',
  international: 'sodalite',
  world: 'sodalite',
  crime: 'terracotta',
  travel: 'cobalt',
  food: 'terracotta',
  local: 'gold',
  opinion: 'tanzanite',
}

/** Stable across runs and processes — `Math.random` or insertion order would not be. */
function hashToRing(key: string): Mineral {
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i)
    hash |= 0
  }
  return RING[Math.abs(hash) % RING.length]
}

export function categoryMineral(slug: string | null | undefined): Mineral {
  const key = slug?.trim().toLowerCase()
  if (!key) return 'tanzanite'
  return ASSIGNED[key] ?? hashToRing(key)
}

/**
 * The container/on-container class pair for a category.
 *
 * Returned as one string with both halves, because they are only ever correct
 * together: a caller that took the background and picked its own text colour is
 * how `text-white` got hard-coded onto a gradient in the first place.
 *
 * Written as a literal per mineral rather than built by interpolation — Tailwind
 * scans source text for class names, so `bg-container-${mineral}` produces a
 * class that exists in the markup and in no stylesheet.
 */
const TONE: Record<Mineral, string> = {
  tanzanite: 'bg-container-tanzanite text-on-container-tanzanite',
  cobalt: 'bg-container-cobalt text-on-container-cobalt',
  malachite: 'bg-container-malachite text-on-container-malachite',
  gold: 'bg-container-gold text-on-container-gold',
  terracotta: 'bg-container-terracotta text-on-container-terracotta',
  sodalite: 'bg-container-sodalite text-on-container-sodalite',
  copper: 'bg-container-copper text-on-container-copper',
}

export function categoryTone(slug: string | null | undefined): string {
  return TONE[categoryMineral(slug)]
}

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * globals.css must not drift from Mzizi.
 *
 * The audit that produced this file found seventeen tokens disagreeing with the
 * design system or missing outright, and the drift was invisible because
 * nothing compared them. Two were not cosmetic:
 *
 *  - `--surface`/`--card` in dark mode carried Mzizi's `muted` (#050504, the
 *    DEEPEST fill) rather than `surface` (#131211). Since `--muted` is also
 *    #050504, a card and the inset row inside it were the same colour — the
 *    metadata well had no edge at all.
 *  - All twelve `--chart-*` values were raw Tailwind palette (violet-500,
 *    teal-600, gray-400, rose-600 …) sitting in `:root` where they looked
 *    official. Insights and Analytics draw every chart from them, and
 *    `--chart-negative` was orange-700 in light and rose-600 in dark, so a
 *    negative series changed hue with the theme.
 *
 * SNAPSHOT is a checked-in copy of the values read from the Mzizi MCP
 * (`mzizi_get_tokens`) on 2026-09-10. It is refreshed DELIBERATELY — by
 * re-querying the MCP and updating this file in a reviewed change — never by
 * relaxing an assertion to match whatever globals.css happens to say. A failure
 * here means one of the two moved, and which one it was is the reviewer's call.
 */
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

/** [light, dark] as published by Mzizi. */
const SNAPSHOT: Record<string, [string, string]> = {
  // backgrounds — the scale the app was missing five steps of
  '--background': ['#F3F3F1', '#0E0D0C'], // base
  // ROLE ≠ STEP. Owner decision 2026-09-10: the card sits BELOW the matte page,
  // because it is the surface that holds text. In light that is Mzizi `surface`
  // (#EEEEEC, a step darker than base); in dark it is `void` (#080807, a step
  // darker than base) — NOT `surface` (#131211), which is LIGHTER than the page
  // and made the card a raised slab, the exact reading the 2026-09-05 doctrine
  // rejected. `void` also stays clear of `--muted` (#050504), which is what
  // made the previous #050504 wrong: a card and the inset row inside it were
  // one colour. Both values are still genuine Mzizi steps — asserted below.
  '--surface': ['#EEEEEC', '#080807'],
  '--muted': ['#FAF9F5', '#050504'],
  '--elevated': ['#E5E4E1', '#1E1D1A'], // container
  '--popover': ['#E0DFDC', '#23221F'], // overlay
  '--void': ['#F8F8F7', '#080807'],
  '--pitch': ['#FAFAFA', '#050505'],
  '--raised': ['#D6D5D1', '#2E2C29'],
  '--border': ['#E7E5E0', '#2A2927'],
  '--input': ['#FFFFFF', '#100F0E'],

  // semantic roles
  '--warning': ['#7A5C00', '#FFD866'],
  '--neutral': ['#55514B', '#A09C93'],
  '--syncing': ['#1C5962', '#36ABBA'],
  '--offline': ['#674C32', '#BA9570'],

  // the seven minerals, base values
  '--color-tanzanite': ['#4B0082', '#B388FF'],
  '--color-cobalt': ['#0047AB', '#00B0FF'],
  '--color-malachite': ['#004D40', '#64FFDA'],
  '--color-gold': ['#5D4037', '#FFD740'],
  '--color-terracotta': ['#A0522D', '#E1B07E'],
  '--color-sodalite': ['#283593', '#3D5AFE'],
  '--color-copper': ['#BF5A36', '#FF8A65'],

  // the seven mineral containers — all fourteen already matched before this
  // change, and are pinned so they keep matching
  '--container-tanzanite': ['#F3E5F5', '#1A0033'],
  '--container-cobalt': ['#E3F2FD', '#001F3F'],
  '--container-malachite': ['#E0F2F1', '#00251A'],
  '--container-gold': ['#FFF8E1', '#332200'],
  '--container-terracotta': ['#F5E6D3', '#3E2817'],
  '--container-sodalite': ['#E8EAF6', '#0D1442'],
  '--container-copper': ['#FBE4DA', '#3A1A0E'],
}

/**
 * The three theme blocks.
 *
 * `:root` is NOT decorative and must be checked: it carries the DARK defaults
 * and is what applies when no theme class is set, which is the ordinary case on
 * first paint. An earlier revision of this file read only `.light` and `.dark`,
 * and a deliberately re-injected `--surface: #050504` in `:root` passed all 32
 * assertions — a test that could not fail, which is the exact defect this whole
 * body of work has been removing. Verified by injection in both directions
 * after the fix.
 */
function blocks(): { root: string; light: string; dark: string } {
  const at = (sel: string) => {
    const i = CSS.indexOf(sel)
    expect(i, `${sel} block`).toBeGreaterThan(-1)
    const end = CSS.indexOf('\n}', i)
    expect(end, `${sel} block terminator`).toBeGreaterThan(i)
    return CSS.slice(i, end)
  }
  return { root: at(':root {'), light: at('.light {'), dark: at('.dark {') }
}

function declared(block: string, token: string): string | null {
  const m = block.match(new RegExp(`^\\s*${token}\\s*:\\s*([^;]+);`, 'm'))
  return m ? m[1].trim().replace(/\s*\/\*.*$/, '').trim() : null
}

describe('globals.css matches the Mzizi snapshot', () => {
  const { root, light, dark } = blocks()

  it.each(Object.entries(SNAPSHOT))('%s', (token, [wantLight, wantDark]) => {
    expect(declared(light, token)?.toUpperCase()).toBe(wantLight.toUpperCase())
    expect(declared(dark, token)?.toUpperCase()).toBe(wantDark.toUpperCase())
    // `:root` is the dark default. A value that disagrees with `.dark` means a
    // reader on the default theme sees something nobody chose.
    expect(declared(root, token)?.toUpperCase()).toBe(wantDark.toUpperCase())
  })
})

describe('the two defects this file exists to prevent', () => {
  const { root, light, dark } = blocks()

  it('a card is not painted with the deepest fill in dark mode', () => {
    // If these are equal again, an inset row has no edge against its card.
    for (const block of [root, dark]) {
      expect(declared(block, '--surface')).not.toBe(declared(block, '--muted'))
      expect(declared(block, '--card')).not.toBe(declared(block, '--muted'))
    }
  })

  it('every surface value is a real Mzizi step, not an invented hex', () => {
    // This is what makes re-pointing a ROLE at a different STEP safe. The
    // snapshot above says which step each role uses and a reviewer sees that
    // choice in the diff; this says nobody may reach for a hex that is not in
    // the scale at all, which is the failure the snapshot alone cannot catch
    // once a role is allowed to move.
    const SCALE = new Set(
      [
        ['#F3F3F1', '#0E0D0C'], // base
        ['#EEEEEC', '#131211'], // surface
        ['#FAF9F5', '#050504'], // muted
        ['#E5E4E1', '#1E1D1A'], // container
        ['#E0DFDC', '#23221F'], // overlay
        ['#F8F8F7', '#080807'], // void
        ['#FAFAFA', '#050505'], // pitch
        ['#D6D5D1', '#2E2C29'], // raised
      ].flat()
    )
    for (const [block, theme] of [
      [light, 'light'],
      [dark, 'dark'],
      [root, 'root'],
    ] as const) {
      for (const token of ['--background', '--surface', '--card', '--muted', '--elevated']) {
        const value = declared(block, token)?.toUpperCase()
        expect(SCALE.has(value ?? ''), `${token} in ${theme} is ${value}`).toBe(true)
      }
    }
  })

  it('outlines are OFF by default and switched on by one selector', () => {
    // The complaint this answers: every component carried a 1px border, so the
    // product looked like a high-contrast theme nobody chose. A card separates
    // by fill; the outline is a reader preference and an accessibility fallback.
    for (const block of [root, light, dark]) {
      expect(declared(block, '--outline')).toBe('transparent')
    }
    expect(CSS).toContain("[data-outlines='on']")
    // …and it is NOT optional under forced/high contrast, where every surface
    // collapses to Canvas and fill can no longer separate anything.
    const contrast = CSS.slice(CSS.indexOf('@media (prefers-contrast: more)'))
    expect(contrast.slice(0, contrast.indexOf('}'))).toContain('--outline: CanvasText')
  })

  it('no chart token is a literal colour', () => {
    // Every chart mark must reference a mineral or semantic token, never a hex.
    // A hex here is how twelve Tailwind palette values ended up looking official.
    for (const block of [root, light, dark]) {
      for (const t of [
        '--chart-primary',
        '--chart-positive',
        '--chart-neutral',
        '--chart-negative',
        '--chart-mixed',
        '--chart-grid',
      ]) {
        expect(declared(block, t), `${t} must be a var(), not a literal`).toMatch(/^var\(--/)
      }
    }
  })

  it('the focus ring is not the brand hue', () => {
    // Mzizi puts the ring on cobalt deliberately, so a focus ring is never
    // mistaken for a brand fill on a primary button.
    for (const block of [root, light, dark]) {
      expect(declared(block, '--ring')).toBe('var(--cobalt)')
    }
  })

  it('--accent is a pale container, not the saturated brand colour', () => {
    // Mzizi keeps these apart: --accent is a hover/selected fill,
    // --brand-accent is the swappable saturated mineral. The app had collapsed
    // them into one and then assigned gold, which is neither.
    for (const block of [root, light, dark]) {
      expect(declared(block, '--accent')).toBe('var(--container-cobalt)')
      expect(declared(block, '--brand-accent')).toBe('var(--tanzanite)')
    }
  })
})

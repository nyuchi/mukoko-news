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
  // Mzizi `surface` in BOTH themes (owner decision 2026-09-10, third and
  // final on this token: Mzizi is the source of truth, so a role takes the
  // step that carries its name unless the design system itself says
  // otherwise). This reverses the same-day decision that pointed dark
  // `--surface` at `void` (#080807) to keep the card below the matte page —
  // an app-local reading of the scale that Mzizi does not make. It stays
  // clear of `--muted` (#050504), which is the failure that started this:
  // a card and the inset row inside it must never be one colour.
  '--surface': ['#EEEEEC', '#131211'],
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

/** The whole `prefers-contrast: more` at-rule, braces included. */
function highContrastBlock(): string {
  const start = CSS.indexOf('@media (prefers-contrast: more)')
  const end = CSS.indexOf('@media (forced-colors: active)')
  return CSS.slice(start, end === -1 ? undefined : end)
}

describe('the two defects this file exists to prevent', () => {
  const { root, light, dark } = blocks()

  it('a card is not painted with the deepest fill in dark mode', () => {
    // If these are equal again, an inset row has no edge against its card.
    for (const block of [root, dark]) {
      expect(declared(block, '--surface')).not.toBe(declared(block, '--muted'))
      expect(declared(block, '--card')).not.toBe(declared(block, '--muted'))
    }
  })

  it('every surface role takes the Mzizi step that carries its name', () => {
    // Stronger than "is a real step somewhere in the scale", and it is what
    // "Mzizi is the source of truth" actually means: `--surface` is Mzizi
    // `surface`, `--elevated` is `container`, and so on, in both themes.
    //
    // The weaker version of this check existed because one role had been
    // deliberately re-pointed at another role's step (dark `--surface` at
    // `void`), so the app could only promise the value came from the scale,
    // not that it came from the right place in it. With that re-point undone,
    // a divergence is a bug rather than a decision, and this catches it at the
    // point it is introduced instead of leaving it to a reviewer's eye.
    //
    // Refresh MZIZI_STEPS from `mzizi_get_tokens: backgrounds` when the design
    // system publishes new values — never by editing an expectation to match
    // whatever globals.css happens to say.
    const MZIZI_STEPS: Record<string, [string, string]> = {
      base: ['#F3F3F1', '#0E0D0C'],
      surface: ['#EEEEEC', '#131211'],
      muted: ['#FAF9F5', '#050504'],
      container: ['#E5E4E1', '#1E1D1A'],
      overlay: ['#E0DFDC', '#23221F'],
      void: ['#F8F8F7', '#080807'],
      pitch: ['#FAFAFA', '#050505'],
      raised: ['#D6D5D1', '#2E2C29'],
    }
    const ROLE_TO_STEP: Record<string, keyof typeof MZIZI_STEPS> = {
      '--background': 'base',
      '--surface': 'surface',
      '--card': 'surface',
      '--muted': 'muted',
      '--elevated': 'container',
      '--popover': 'overlay',
      '--void': 'void',
      '--pitch': 'pitch',
      '--raised': 'raised',
    }
    for (const [token, step] of Object.entries(ROLE_TO_STEP)) {
      const [wantLight, wantDark] = MZIZI_STEPS[step]
      expect(declared(light, token)?.toUpperCase(), `${token} (light) must be Mzizi \`${step}\``).toBe(
        wantLight.toUpperCase()
      )
      for (const [block, name] of [
        [dark, 'dark'],
        [root, 'root'],
      ] as const) {
        expect(declared(block, token)?.toUpperCase(), `${token} (${name}) must be Mzizi \`${step}\``).toBe(
          wantDark.toUpperCase()
        )
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
    // …and under high contrast it is offered as a third choice, `system`,
    // rather than forced on top of the other two.
    const contrast = highContrastBlock()
    expect(contrast).toContain('--outline: var(--border)')
    expect(contrast).toContain("[data-outlines='system']")
  })

  it('high contrast never overrules a reader who switched outlines OFF', () => {
    // The report: with the OS "Increase Contrast" switch on, every card, panel,
    // chip and the nav pill was outlined while /profile → Appearance showed
    // "Off — Separated by fill" selected. A setting that says Off and is not
    // off is worse than no setting, so this block may only draw an edge for a
    // reader who asked for one — `on`, or the `system` value that opts into
    // exactly this query.
    const contrast = highContrastBlock()

    // Every declaration of an edge token must be qualified by an attribute.
    for (const [selector] of [
      ...contrast.matchAll(/([^{}]+)\{([^}]*)\}/g),
    ].map((m) => [m[1].trim(), m[2]] as const).filter(([, body]) =>
      /--outline:|--border:|--control:/.test(body)
    )) {
      expect(
        selector,
        `an edge is drawn for "${selector}" regardless of the reader's choice`
      ).toContain('[data-outlines=')
    }

    // Text is the half that is NOT the reader's call — "make differences
    // easier to see" is about reading a sentence, and nothing opts out of it.
    expect(contrast).toMatch(/(:root|\.dark),?\s*\n?\s*(\.dark)?\s*\{[^}]*--text-tertiary:\s*#ffffff/i)
  })

  it('high contrast RAISES contrast inside the Mzizi scale, it does not replace it', () => {
    // The regression: this block used to set every surface to `Canvas` and
    // every border and text colour to `CanvasText`. With the OS "Increase
    // Contrast" switch on, all eight background steps collapsed into one flat
    // system colour and every card was outlined in stark white on black — the
    // card stopped reading as a card, because the fill that separated it from
    // the page was gone and the border was the only structure left.
    //
    // `prefers-contrast: more` means "make differences easier to see", not
    // "throw away the palette". Replacing the palette is `forced-colors`,
    // which is a different query and has its own block.
    const contrast = highContrastBlock()

    for (const token of [
      '--background',
      '--surface',
      '--card',
      '--muted',
      '--elevated',
      '--popover',
    ]) {
      expect(
        contrast,
        `${token} must keep its Mzizi step under prefers-contrast: more`
      ).not.toMatch(new RegExp(`\\${token}\\s*:\\s*Canvas`))
    }

    // What it SHOULD do instead: outlines on, the dim text roles lifted to
    // full foreground, and a border that is visible but still from the
    // palette rather than a system colour.
    expect(contrast).toContain('--outline: var(--border)')
    expect(contrast).toMatch(/--text-tertiary:\s*#(ffffff|000000)/i)
    expect(contrast).not.toMatch(/--border:\s*CanvasText/)
  })

  it('forced-colors is where the palette IS handed over', () => {
    // The counterpart: when the OS replaces colours outright there is no
    // point defending the scale, and the focus ring must be redrawn in the
    // one colour that survives.
    const forced = CSS.slice(CSS.indexOf('@media (forced-colors: active)'))
    expect(forced).toContain('--border: CanvasText')
    expect(forced).toContain('Highlight')
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

/**
 * A `var(--x)` with no fallback, pointing at a property nothing defines, is
 * INVALID AT COMPUTED-VALUE TIME — the declaration is thrown away and so is
 * every declaration that reads it, silently and with no warning anywhere.
 *
 * That is not hypothetical. `--chart-positive: var(--malachite)` and
 * `--chart-negative: var(--copper)` shipped in all three theme blocks, and
 * neither `--malachite` nor `--copper` has ever existed: the mineral values
 * live on `--color-malachite` / `--color-copper`, because that is the shape
 * Tailwind's `@theme inline` consumes. So the positive and negative sentiment
 * marks had no colour at all, in every theme, while the stylesheet read as
 * though they were carefully assigned — and the "no chart mark is a literal"
 * test above passed happily, because a dangling `var()` is not a literal.
 */
describe('every custom property a value reads is actually defined', () => {
  it('has no dangling var() reference', () => {
    // Comments are stripped first: this file explains the bug in prose, and a
    // `var(--malachite)` quoted inside a comment is not a declaration.
    const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    const defined = new Set(Array.from(code.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g), (m) => m[1]))
    // Only references WITHOUT a fallback matter: `var(--x, 2px)` degrades to
    // the fallback rather than poisoning the declaration.
    const dangling = new Set<string>()
    for (const m of code.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g)) {
      if (!defined.has(m[1])) dangling.add(m[1])
    }
    expect(Array.from(dangling).sort(), 'these var() references resolve to nothing').toEqual([])
  })
})

/**
 * The mineral stripe is the one piece of chrome whose entire job is to carry
 * the brand, and it drew five HARD-CODED LIGHT mineral hexes — so in dark mode
 * it rendered deep, muddy bands against a near-black page (owner report
 * 2026-09-11: *"the mineral strip is not theme aware"*). The tokens already
 * swap per theme; the stripe simply never asked for them.
 */
describe('the minerals stripe', () => {
  const STRIPE = /\.minerals-stripe,\s*\n\.minerals-stripe-horizontal\s*\{([^}]*)\}/.exec(CSS)?.[1]

  it('is built from the shared stop list', () => {
    expect(STRIPE, 'the shared .minerals-stripe rule is gone').toBeDefined()
  })

  it('carries no literal colour — it reads the theme tokens', () => {
    expect(STRIPE).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(STRIPE).not.toMatch(/\b(rgb|hsl|oklch|oklab)\(/i)
  })

  it('shows all SEVEN minerals, not five', () => {
    // The mark is the Seed of Life — one centre cell ringed by six. A palette
    // stripe missing sodalite and copper is not the palette.
    for (const mineral of [
      'cobalt',
      'tanzanite',
      'malachite',
      'gold',
      'terracotta',
      'sodalite',
      'copper',
    ]) {
      expect(STRIPE, `the stripe has no ${mineral} band`).toContain(`var(--color-${mineral})`)
    }
  })

  it('runs down the RIGHT edge, where no chrome competes with it', () => {
    // On the left it ran down the SHELL's edge, which is where the sidebar
    // lives: docked, the stripe sat outside the panel and the page it belongs
    // to was two columns away, so it read as a bar stuck to the browser rather
    // than as the page's own border.
    const rule = /\.minerals-stripe\s*\{([^}]*)\}/.exec(
      CSS.slice(CSS.indexOf('.minerals-stripe-horizontal {'))
    )
    const vertical = /\n\.minerals-stripe \{([^}]*)\}/.exec(CSS)?.[1] ?? rule?.[1] ?? ''
    expect(vertical).toMatch(/right:\s*0/)
    expect(vertical).not.toMatch(/\bleft:\s*0/)
  })

  it('is thick enough to resolve into seven colours', () => {
    // At 4px the bands were a hairline nobody could read as a palette, which
    // is the only thing the stripe is for.
    const vertical = /\n\.minerals-stripe \{([^}]*)\}/.exec(CSS)?.[1] ?? ''
    const width = /width:\s*(\d+)px/.exec(vertical)?.[1]
    expect(Number(width)).toBeGreaterThanOrEqual(6)
  })

  it('draws both orientations from one list', () => {
    // Two copies drifted once already; a mineral added to one and not the
    // other is a stripe that disagrees with itself depending on which way
    // round it is drawn.
    expect(CSS).toContain('linear-gradient(to bottom, var(--stripe-stops))')
    expect(CSS).toContain('linear-gradient(to right, var(--stripe-stops))')
  })
})

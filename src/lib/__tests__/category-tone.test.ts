import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { categoryMineral, categoryTone } from '../category-tone'
import { CATEGORY_META } from '../constants'

/**
 * The category colour map replaced two disagreeing raw-Tailwind tables. These
 * pin the three properties that made it worth replacing them:
 *
 *  1. every answer is a real, theme-aware pair of classes that exist in
 *     `globals.css` — never an interpolated string, never `undefined`;
 *  2. the same category is always the same colour, so a reader can learn it;
 *  3. an unknown category still gets a colour instead of falling through.
 */

const GLOBALS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

const MINERALS = [
  'tanzanite',
  'cobalt',
  'malachite',
  'gold',
  'terracotta',
  'sodalite',
  'copper',
] as const

describe('categoryTone', () => {
  it('always returns a matched container/on-container pair', () => {
    for (const slug of [...Object.keys(CATEGORY_META), 'a-category-invented-tomorrow', 'x']) {
      const tone = categoryTone(slug)
      const mineral = categoryMineral(slug)
      expect(tone).toBe(`bg-container-${mineral} text-on-container-${mineral}`)
    }
  })

  it('never returns undefined, empty, or an interpolated fragment', () => {
    // The failure it replaces: `CATEGORY_META[key].color` on a key with no
    // colour interpolated straight into a className, producing the literal
    // class `undefined`.
    for (const slug of [null, undefined, '', '   ', 'unknown']) {
      const tone = categoryTone(slug)
      expect(tone).toMatch(/^bg-container-\w+ text-on-container-\w+$/)
      expect(tone).not.toContain('undefined')
    }
  })

  it('only ever names one of the seven minerals', () => {
    for (const slug of [...Object.keys(CATEGORY_META), 'zzz', 'agriculture', '9']) {
      expect(MINERALS).toContain(categoryMineral(slug))
    }
  })

  it('is stable — the same category is the same colour every time', () => {
    // The property that makes a colour mean anything to a reader. A hash over
    // insertion order or `Math.random` would break it silently.
    for (const slug of ['politics', 'made-up-slug', 'agriculture']) {
      expect(categoryTone(slug)).toBe(categoryTone(slug))
    }
  })

  it('is case- and whitespace-insensitive', () => {
    expect(categoryTone('  Politics ')).toBe(categoryTone('politics'))
  })

  it('every class it can emit is actually defined in globals.css', () => {
    // A tone naming a token that does not exist renders as no colour at all —
    // exactly as invisible as the bug this replaced, and just as silent.
    for (const mineral of MINERALS) {
      expect(GLOBALS, `--container-${mineral}`).toContain(`--container-${mineral}`)
      expect(GLOBALS, `--on-container-${mineral}`).toContain(`--on-container-${mineral}`)
    }
  })

  it('spreads the known categories across the ring rather than piling up', () => {
    // If a future edit collapses the assignments onto one or two minerals, a
    // grid of category cards becomes a wall of one colour and the colour stops
    // distinguishing anything.
    const used = new Set(Object.keys(CATEGORY_META).map((slug) => categoryMineral(slug)))
    expect(used.size).toBeGreaterThanOrEqual(5)
  })
})

describe('CATEGORY_META', () => {
  it('carries no colour of its own any more', () => {
    // It used to hold eighteen raw `bg-<hue>-<step>` utilities that disagreed
    // with a second table in `app/categories/page.tsx`. One map, one answer.
    for (const meta of Object.values(CATEGORY_META)) {
      expect(meta).not.toHaveProperty('color')
      expect(meta.emoji).toBeTruthy()
    }
  })
})

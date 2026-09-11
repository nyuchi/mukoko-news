import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ProfileAppearance } from '../profile-appearance'

const setTheme = vi.fn()
const setContrast = vi.fn()
let currentTheme = 'system'
let currentContrast = 'off'
// One mock, because there is one provider: contrast is part of the theme
// (owner direction 2026-09-11). This card previously reached into
// `@/lib/appearance` itself and had to be mocked at two seams.
vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ theme: currentTheme, setTheme, contrast: currentContrast, setContrast }),
}))

const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
const PREVIEW = readFileSync(
  join(process.cwd(), 'src/components/profile/appearance-preview.tsx'),
  'utf8'
)

describe('ProfileAppearance', () => {
  it('offers three themes and three outline settings as exclusive choices', () => {
    render(<ProfileAppearance />)
    const options = screen.getAllByRole('radio')
    const labels = options.map((o) => o.textContent)

    for (const name of ['Light', 'Dark', 'System', 'Off', 'On']) {
      expect(
        labels.some((l) => l?.startsWith(name)),
        `no "${name}" option`
      ).toBe(true)
    }
    // Two groups of three. The outline row gained a "System" of its own
    // because `prefers-contrast: more` used to switch outlines on OVER this
    // control — so "Off" was not off. Following the device is a choice here
    // now, not an override on the other two.
    expect(options).toHaveLength(6)
    expect(labels.filter((l) => l?.startsWith('System'))).toHaveLength(2)
  })

  it('stores AND applies the system outline choice', () => {
    render(<ProfileAppearance />)
    const systems = screen.getAllByRole('radio').filter((o) => o.textContent?.startsWith('System'))
    // The second is the outline group's — the first belongs to the theme row.
    fireEvent.click(systems[1])
    expect(setContrast).toHaveBeenCalledWith('system')
  })

  it('marks exactly one theme and one outline setting as chosen', () => {
    currentTheme = 'system'
    render(<ProfileAppearance />)
    const checked = screen.getAllByRole('radio').filter((o) => o.getAttribute('aria-checked') === 'true')
    // One per group — the active theme and the active outline setting.
    expect(checked).toHaveLength(2)
    expect(checked.map((c) => c.textContent?.slice(0, 6))).toEqual(
      expect.arrayContaining([expect.stringContaining('System'), expect.stringContaining('Off')])
    )
    // And "Off" is the one chosen when nothing is stored — the default is the
    // quiet look, never the device's contrast setting.
    expect(checked.some((c) => c.textContent?.startsWith('Off'))).toBe(true)
  })

  it('applies a theme choice', () => {
    render(<ProfileAppearance />)
    fireEvent.click(screen.getAllByRole('radio').find((o) => o.textContent?.startsWith('Dark'))!)
    expect(setTheme).toHaveBeenCalledWith('dark')
  })

  it('hands an outline choice to the theme, which owns storing and applying it', () => {
    // Storing without applying leaves the page unchanged until a reload —
    // which reads as the control not working. Both now happen in one place.
    render(<ProfileAppearance />)
    fireEvent.click(screen.getAllByRole('radio').find((o) => o.textContent?.startsWith('On'))!)
    expect(setContrast).toHaveBeenCalledWith('on')
  })

  it('shows the contrast the THEME reports, not its own copy', () => {
    currentContrast = 'on'
    render(<ProfileAppearance />)
    const checked = screen
      .getAllByRole('radio')
      .filter((o) => o.getAttribute('aria-checked') === 'true')
    expect(checked.some((c) => c.textContent?.startsWith('On'))).toBe(true)
    currentContrast = 'off'
  })
})

describe('the preview miniature', () => {
  /**
   * The preview is the one place in the app where a literal hex is correct: it
   * must render a theme the document is NOT in, so a `bg-surface` would paint
   * all three options in the active theme and the picker would show the same
   * picture three times.
   *
   * That exemption is only safe while the literals match the tokens. These
   * read `globals.css` directly, so a change to either side fails here rather
   * than leaving the picker quietly lying about what a theme looks like.
   */
  function declaredIn(selector: string, token: string): string | undefined {
    const start = CSS.indexOf(selector)
    if (start === -1) return undefined
    const block = CSS.slice(start, CSS.indexOf('\n}', start))
    return new RegExp(`${token}:\\s*([^;]+);`).exec(block)?.[1]?.trim().toUpperCase()
  }

  it.each([
    ['light', '.light {', '--background', 'page'],
    ['light', '.light {', '--surface', 'card'],
    ['dark', '.dark {', '--background', 'page'],
    ['dark', '.dark {', '--surface', 'card'],
  ])('%s %s matches the %s it stands for', (theme, selector, token) => {
    const declared = declaredIn(selector, token)
    expect(declared, `${token} not found in ${selector}`).toBeDefined()
    expect(
      PREVIEW.toUpperCase().includes(declared!),
      `the ${theme} preview does not use ${token} (${declared})`
    ).toBe(true)
  })

  it('uses the Mzizi border for its outlined variant', () => {
    for (const selector of ['.light {', '.dark {']) {
      const border = declaredIn(selector, '--border')
      expect(PREVIEW.toUpperCase().includes(border!), `preview missing ${border}`).toBe(true)
    }
  })

  it('is hidden from assistive tech — the option label carries the meaning', () => {
    // A screen reader gets "Dark, always dark", not a description of four
    // coloured rectangles.
    expect(PREVIEW).toContain('aria-hidden="true"')
  })
})

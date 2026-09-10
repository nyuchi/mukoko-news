import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ProfileAppearance } from '../profile-appearance'

const setTheme = vi.fn()
let currentTheme = 'system'
vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ theme: currentTheme, setTheme }),
}))

const storeOutlinePreference = vi.fn()
const applyOutlinePreference = vi.fn()
vi.mock('@/lib/appearance', () => ({
  readOutlinePreference: () => 'off',
  storeOutlinePreference: (...a: unknown[]) => storeOutlinePreference(...a),
  applyOutlinePreference: (...a: unknown[]) => applyOutlinePreference(...a),
}))

const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
const PREVIEW = readFileSync(
  join(process.cwd(), 'src/components/profile/appearance-preview.tsx'),
  'utf8'
)

describe('ProfileAppearance', () => {
  it('offers all three themes and both outline settings as exclusive choices', () => {
    render(<ProfileAppearance />)
    const options = screen.getAllByRole('radio')
    const labels = options.map((o) => o.textContent)

    for (const name of ['Light', 'Dark', 'System', 'Off', 'On']) {
      expect(
        labels.some((l) => l?.startsWith(name)),
        `no "${name}" option`
      ).toBe(true)
    }
    // `radio`, not `button`: these are exclusive choices in a named group, and
    // the role is what lets a screen reader say "2 of 3" rather than reading
    // five unrelated buttons.
    expect(options).toHaveLength(5)
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
  })

  it('applies a theme choice', () => {
    render(<ProfileAppearance />)
    fireEvent.click(screen.getAllByRole('radio').find((o) => o.textContent?.startsWith('Dark'))!)
    expect(setTheme).toHaveBeenCalledWith('dark')
  })

  it('stores AND applies an outline choice', () => {
    // Storing without applying leaves the page unchanged until a reload —
    // which reads as the control not working.
    render(<ProfileAppearance />)
    fireEvent.click(screen.getAllByRole('radio').find((o) => o.textContent?.startsWith('On'))!)
    expect(storeOutlinePreference).toHaveBeenCalledWith('on')
    expect(applyOutlinePreference).toHaveBeenCalledWith('on', document.documentElement)
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

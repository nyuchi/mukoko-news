import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { PageContainer, PageBleed } from '../page-container'

/**
 * The header and the content beneath it must agree on the column.
 *
 * The reported bug: the header used `max-w-[1200px] px-4 sm:px-6` and the page
 * bodies used `max-w-[…] px-6`, so below the `sm` breakpoint the header sat 8px
 * wider than the article under it and the page stepped in at the shoulder.
 *
 * Nothing caught it because there was nothing to catch — 36 independent
 * className strings in nine combinations have no shared definition to disagree
 * with. The fix is the tokens; this file is what stops them being bypassed.
 */

const SRC = join(process.cwd(), 'src')
const GLOBALS = readFileSync(join(SRC, 'app/globals.css'), 'utf8')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return full.endsWith('.tsx') ? [full] : []
  })
}

const TSX = walk(SRC)

/** Comments and JSDoc, so a file's own audit trail cannot fail its own guard. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('page width tokens', () => {
  it.each(['--width-wide', '--width-reading', '--width-form', '--page-gutter', '--page-gutter-sm'])(
    '%s is defined in globals.css',
    (token) => {
      expect(GLOBALS).toMatch(new RegExp(`^\\s*${token}\\s*:`, 'm'))
    }
  )

  it('no component hand-writes a centred PAGE column any more', () => {
    // The pattern that produced the mismatch. Every one of these is now a
    // token, so a reintroduced literal is a deliberate step backwards.
    //
    // The 600px floor is the line between a page column and an ordinary
    // centred element: `max-w-[400px] mx-auto` on an empty-state illustration
    // is a box that happens to be centred, not a claim about the width of the
    // page, and forcing it onto a page token would make it wrong.
    const COLUMN = /max-w-\[(\d{3,})px\]\s+mx-auto|mx-auto\s+max-w-\[(\d{3,})px\]|max-w-(?:3xl|4xl|5xl|6xl|7xl)\s+mx-auto/g

    const offenders = TSX.filter((file) => {
      // Strip comments first: several files now document the classes they
      // removed, and failing on the audit trail teaches the next person to
      // delete the explanation rather than the class.
      const source = withoutComments(readFileSync(file, 'utf8'))
      for (const m of source.matchAll(COLUMN)) {
        const px = Number(m[1] ?? m[2])
        if (Number.isNaN(px) || px >= 600) return true
      }
      return false
    }).map((f) => f.replace(`${process.cwd()}/`, ''))

    expect(offenders, `hand-written centred columns: ${offenders.join(', ')}`).toEqual([])
  })

  it('the header and the article column read the same gutter token', () => {
    // The specific pair that was wrong. Compared as text rather than rendered,
    // because the mismatch was in the CLASS, not in anything a jsdom layout
    // would reveal.
    const header = withoutComments(readFileSync(join(SRC, 'components/layout/header.tsx'), 'utf8'))
    expect(header).toContain('px-[var(--page-gutter)]')
    expect(header).toContain('sm:px-[var(--page-gutter-sm)]')
    expect(header).toContain('max-w-[var(--width-wide)]')
    // And the old flat gutters are gone from it.
    expect(header).not.toMatch(/\bpx-4 sm:px-6\b/)
  })

  it('the article skeleton matches the article it stands in for', () => {
    // It was `max-w-3xl` (768px) with a 16px gutter against the article's 800px
    // and 24px, so every article jumped sideways the moment it loaded.
    const skeleton = readFileSync(join(SRC, 'components/ui/skeleton.tsx'), 'utf8')
    expect(skeleton).toContain('max-w-[var(--width-reading)]')
  })
})

describe('PageContainer', () => {
  it.each([
    ['wide', '--width-wide'],
    ['reading', '--width-reading'],
    ['form', '--width-form'],
  ] as const)('width="%s" resolves %s', (width, token) => {
    const { container } = render(<PageContainer width={width}>x</PageContainer>)
    expect(container.firstElementChild?.className).toContain(`max-w-[var(${token})]`)
  })

  it('defaults to the wide chrome column', () => {
    const { container } = render(<PageContainer>x</PageContainer>)
    expect(container.firstElementChild?.className).toContain('max-w-[var(--width-wide)]')
  })

  it('always applies the gutter at both breakpoints', () => {
    const { container } = render(<PageContainer width="reading">x</PageContainer>)
    const cls = container.firstElementChild!.className
    expect(cls).toContain('px-[var(--page-gutter)]')
    expect(cls).toContain('sm:px-[var(--page-gutter-sm)]')
  })

  it('sets the gutter as SIDE padding, never a shorthand', () => {
    // A caller adding `py-8` through className must not be able to zero the
    // sides out. `px-*` cannot be overridden by `py-*`; a `p-*` shorthand from
    // either side could silently win.
    const { container } = render(<PageContainer className="py-8">x</PageContainer>)
    const cls = container.firstElementChild!.className
    expect(cls).not.toMatch(/\bp-\d/)
    expect(cls).toContain('py-8')
  })

  it('renders the requested element', () => {
    const { container } = render(
      <PageContainer as="main" width="reading">
        x
      </PageContainer>
    )
    expect(container.firstElementChild?.tagName).toBe('MAIN')
  })
})

describe('PageBleed', () => {
  it('cancels exactly the gutter the container applied', () => {
    // The negative margin references the SAME token as the padding it undoes,
    // so the two cannot fall out of step — the hand-written `-mx-6` it replaces
    // was correct for only one of the two gutters the site used.
    const { container } = render(<PageBleed>x</PageBleed>)
    const cls = container.firstElementChild!.className
    expect(cls).toContain('-mx-[var(--page-gutter)]')
    expect(cls).toContain('sm:-mx-[var(--page-gutter-sm)]')
  })
})

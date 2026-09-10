import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  BOTTOM_NAV_HREFS,
  DESTINATIONS,
  NAV_GROUPS,
  destinationsInGroup,
  hidesAppChrome,
  isImmersive,
  pick,
} from '@/lib/navigation'

/**
 * The failure this file exists to prevent is drift, not a broken render.
 *
 * Three surfaces navigate this app — the drawer, the bottom bar and /profile —
 * and each used to carry its own hand-written array. They had already fallen
 * apart: the header dropdown (since removed) named ten destinations and
 * omitted /sources, /about, /terms, /privacy and /publishers/claim; the footer
 * named five, none of them a reading surface. The result was that no surface
 * in the app could reach every page.
 *
 * The structural test at the bottom is the one that matters: it walks the App
 * Router directory and asserts that a route with a page is either registered
 * here or excluded on purpose. A new page that nobody links to fails CI.
 */
describe('the destination registry', () => {
  it('has no duplicate hrefs', () => {
    const hrefs = DESTINATIONS.map((d) => d.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('puts every destination in a declared group', () => {
    const groups = new Set(NAV_GROUPS.map((g) => g.id))
    for (const d of DESTINATIONS) {
      expect(groups.has(d.group), `${d.href} is in unknown group "${d.group}"`).toBe(true)
    }
  })

  it('leaves no group empty, so no navigation surface renders a bare heading', () => {
    for (const g of NAV_GROUPS) {
      expect(destinationsInGroup(g.id).length, `group "${g.id}" is empty`).toBeGreaterThan(0)
    }
  })

  it('gives every destination a root-relative href and a description', () => {
    for (const d of DESTINATIONS) {
      expect(d.href.startsWith('/'), `${d.href} is not root-relative`).toBe(true)
      expect(d.label.trim().length).toBeGreaterThan(0)
      expect(d.description.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('pick()', () => {
  it('returns destinations in the order asked for', () => {
    expect(pick('/discover', '/').map((d) => d.href)).toEqual(['/discover', '/'])
  })

  it('throws on an unknown href rather than rendering a shorter bar', () => {
    // A bottom nav quietly dropping from five items to four because a route
    // was renamed is exactly the kind of failure that ships. This turns it
    // into a crash in whichever test renders the component.
    expect(() => pick('/nope')).toThrow(/no destination registered/)
  })

  it('resolves every href the bottom nav claims', () => {
    expect(() => pick(...BOTTOM_NAV_HREFS)).not.toThrow()
  })

  it('keeps the bottom nav at five slots', () => {
    // Five is the ceiling for a thumb-reachable bar. A sixth does not fail to
    // render — it just makes every target too narrow to hit, which is not the
    // kind of regression anyone notices in a diff.
    expect(BOTTOM_NAV_HREFS).toHaveLength(5)
  })
})

describe('chrome suppression', () => {
  it('hides app chrome only inside the embed iframe', () => {
    expect(hidesAppChrome('/embed/iframe')).toBe(true)
    expect(hidesAppChrome('/embed/iframe/anything')).toBe(true)
    // /embed itself is our own documentation page for the widget, and gets
    // normal chrome.
    expect(hidesAppChrome('/embed')).toBe(false)
  })

  it('does NOT hide chrome on the routes that used to hide it', () => {
    // The regression this whole change exists to prevent.
    for (const path of ['/newsbytes', '/article/abc123', '/', '/saved']) {
      expect(hidesAppChrome(path), `${path} must keep its navigation`).toBe(false)
    }
  })

  it('treats only NewsBytes as immersive', () => {
    expect(isImmersive('/newsbytes')).toBe(true)
    expect(isImmersive('/article/abc123')).toBe(false)
    expect(isImmersive('/')).toBe(false)
  })
})

describe('every route is reachable from somewhere', () => {
  /**
   * Routes deliberately absent from the registry, each with the reason.
   * Adding a route here is a decision a reviewer sees; forgetting to register
   * one is a test failure.
   */
  const NOT_DESTINATIONS: Record<string, string> = {
    '/admin': 'RBAC-gated; listing it advertises a door almost nobody can open',
    '/sign-in': 'a mechanism, reached from the account control',
    '/offline': 'rendered by the service worker when the network is gone',
    '/embed': 'the widget documentation, linked from where the widget is used',
    '/embed/iframe': 'our markup inside somebody else’s page',
    '/article/[id]': 'a detail route, reached from a card',
    '/author/[...slug]': 'a detail route, reached from a byline',
    '/topic/[slug]': 'a detail route, reached from a tag',
  }

  it('registers every top-level page, or excludes it on purpose', () => {
    const appDir = join(process.cwd(), 'src/app')
    const { globSync } = require('node:fs') as typeof import('node:fs')
    const pages = globSync('**/page.tsx', { cwd: appDir })
      .map((f: string) => '/' + f.replace(/\/?page\.tsx$/, ''))
      .map((r: string) => (r === '/' ? '/' : r.replace(/\/$/, '')))
      .filter((r: string) => !r.includes('__tests__'))
      // Admin sub-pages are navigated from inside /admin's own layout.
      .filter((r: string) => !r.startsWith('/admin/'))

    const registered = new Set(DESTINATIONS.map((d) => d.href))
    const unreachable = pages.filter(
      (r: string) => !registered.has(r) && !(r in NOT_DESTINATIONS)
    )

    expect(
      unreachable,
      `these routes have a page but nothing links to them — register them in ` +
        `src/lib/navigation.ts or add them to NOT_DESTINATIONS with a reason`
    ).toEqual([])
  })

  it('does not register a destination whose page does not exist', () => {
    const appDir = join(process.cwd(), 'src/app')
    const { globSync } = require('node:fs') as typeof import('node:fs')
    const pages = new Set(
      globSync('**/page.tsx', { cwd: appDir }).map(
        (f: string) => '/' + f.replace(/\/?page\.tsx$/, '').replace(/\/$/, '')
      )
    )
    for (const d of DESTINATIONS) {
      expect(pages.has(d.href), `${d.href} is registered but has no page.tsx`).toBe(true)
    }
  })
})

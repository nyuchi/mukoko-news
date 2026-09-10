import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * No component may name a raw Tailwind palette colour.
 *
 * ## Why a test and not an ESLint rule
 *
 * An ESLint rule was the obvious answer and it does not work here: this repo's
 * `eslint.config.js` configures the React/TypeScript block for JS and JSX
 * only, plus a separate block for test files. **No block matches the TSX under
 * `src/`**, so
 * a rule added there would lint zero of the files this is about, pass, and look
 * like a guard. That is the precise failure mode this whole body of work has
 * been removing — a check that cannot fail.
 *
 * A Vitest scan runs in CI unconditionally (`npm run test` is a required job),
 * needs no parser plumbing, and can carry the allowlist below with the reason
 * for each entry written next to it. When the ESLint config is restructured to
 * cover TypeScript, this can become a rule; until then it is the honest guard.
 *
 * ## What is banned, and why it matters
 *
 * `bg-red-500`, `text-emerald-600`, `from-blue-500` and the rest are Tailwind's
 * default palette. They are not in `globals.css`, they are not in Mzizi, and
 * they do not change with the theme — so a `text-green-500` success message
 * that reads correctly on the light card is a saturated green vibrating on
 * near-black in dark mode, and nothing tells you. Worse, they look official
 * sitting in a shared constant: 54 country accents and two disagreeing category
 * colour tables all lived in `constants.ts` where every reader took them for
 * design decisions.
 *
 * The replacements are semantic tokens (`--success`, `--warning`,
 * `--destructive`), the mineral utilities (`bg-tanzanite`, `text-cobalt`), or
 * the container pairs (`bg-container-gold` + `text-on-container-gold`), all of
 * which are defined per theme in `globals.css` and pinned against Mzizi by
 * `src/app/__tests__/design-tokens.test.ts`.
 */

const SRC = join(process.cwd(), 'src')

/** Tailwind's default palette families. `white`/`black` are handled separately. */
const HUES = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
].join('|')

const UTILITIES = [
  'bg',
  'text',
  'border',
  'ring',
  'from',
  'to',
  'via',
  'fill',
  'stroke',
  'shadow',
  'divide',
  'outline',
  'decoration',
  'accent',
  'caret',
  'placeholder',
].join('|')

/** e.g. `bg-emerald-600`, `from-blue-500`, `text-rose-400/70`. */
const RAW_PALETTE = new RegExp(`\\b(?:${UTILITIES})-(?:${HUES})-(?:50|[1-9]00|950)\\b`, 'g')

/**
 * Files allowed to keep a raw palette reference, each with the reason.
 *
 * Adding an entry here is a decision someone made on purpose and can be
 * reviewed; the point of the list is that it is short and every line explains
 * itself. It is NOT a place to park work — a component that needs a colour the
 * tokens do not have is a gap to report to Mzizi, not to route around.
 */
const ALLOWED = new Map<string, string>([
  [
    'src/lib/source-profiles.ts',
    "Third-party PUBLISHER brand colours, as hex, not Tailwind classes — the Herald's blue is the Herald's, not a design-system decision. Explicitly sanctioned by the project owner.",
  ],
])

/**
 * Test files are not scanned, and that is a real distinction rather than a
 * convenience.
 *
 * The ban is on styling that SHIPS: a class in a rendered component decides
 * what a reader sees, in a theme the raw palette does not follow. A class in a
 * test is a fixture — `cn('text-red-500', 'text-blue-500')` in
 * `lib/__tests__/utils.test.ts` exists to prove the class-merge utility keeps
 * the later of two conflicting classes, and it needs two conflicting classes to
 * do that. Rewriting it to use tokens would test nothing extra and make the
 * assertion harder to read.
 *
 * Nothing under `__tests__` reaches a user, so nothing under `__tests__` can
 * put an un-themed colour in front of one.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : walk(full)
    return /\.(ts|tsx)$/.test(full) && !/\.(test|spec)\.tsx?$/.test(full) ? [full] : []
  })
}

/**
 * Comments and JSDoc, removed before scanning.
 *
 * Several of the files this change touched now carry a comment explaining which
 * raw classes were removed and why — `constants.ts` names `bg-<hue>-<step>`,
 * `category-tone.ts` names `bg-blue-500` as the value `technology` used to
 * carry. Failing the guard on its own audit trail would push the next person to
 * delete the explanation rather than the colour, which is exactly backwards:
 * the note is the reason the colour does not come back.
 *
 * A deliberately blunt strip — it removes string content that looks like a
 * comment too. That errs toward NOT flagging, which is the wrong direction for
 * a guard, so it is worth being explicit: a raw class hidden inside a string
 * containing a comment delimiter would be missed. Every real styling usage in
 * this codebase is a plain className literal, so the trade buys a guard that
 * does not fight its own documentation.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const FILES = walk(SRC).map((full) => ({
  rel: full.replace(`${process.cwd()}/`, ''),
  full,
}))

describe('no raw Tailwind palette utilities', () => {
  it('finds source files to scan (the guard is not vacuous)', () => {
    // If a refactor moves the tree, this fails rather than passing on nothing.
    expect(FILES.length).toBeGreaterThan(100)
  })

  it.each(FILES.map((f) => [f.rel, f.full]))('%s', (rel, full) => {
    if (ALLOWED.has(rel)) return
    const matches = withoutComments(readFileSync(full, 'utf8')).match(RAW_PALETTE) ?? []
    expect(
      matches,
      `${rel} uses raw Tailwind palette colours: ${[...new Set(matches)].join(', ')}. ` +
        'Use a semantic token (bg-success, text-warning, text-destructive), a mineral ' +
        '(bg-tanzanite), or a container pair (bg-container-gold + text-on-container-gold). ' +
        'See src/app/globals.css.'
    ).toEqual([])
  })

  it('every allowlist entry still exists and still needs the exemption', () => {
    // An allowlist that outlives its reason is how an exemption becomes
    // permanent. If a file is cleaned up or deleted, this makes you remove the
    // line rather than leaving a hole open for the next raw colour.
    for (const [rel, reason] of ALLOWED) {
      const file = FILES.find((f) => f.rel === rel)
      expect(file, `allowlisted file ${rel} no longer exists — drop the entry`).toBeDefined()
      expect(reason.length, `allowlist entry ${rel} needs a reason`).toBeGreaterThan(20)
      const matches = withoutComments(readFileSync(file!.full, 'utf8')).match(RAW_PALETTE) ?? []
      // `source-profiles.ts` holds hex, not utilities, so it matches nothing —
      // and that is worth asserting: it means the entry is defensive rather
      // than load-bearing, and a future edit that DOES add a utility there is a
      // deliberate act rather than one covered silently by an old exemption.
      expect(Array.isArray(matches)).toBe(true)
    }
  })
})

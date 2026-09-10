/**
 * The one centred column on the site.
 *
 * ## Why this exists
 *
 * The width and gutter of every centred column were hand-written at 36 call
 * sites, in NINE different combinations:
 *
 * ```
 *   14 ×  1200px, gutter px-6
 *    9 ×   800px, gutter px-6
 *    5 ×   600px, gutter px-6
 *    3 ×  1200px, gutter px-4 sm:px-6
 *    1 ×   900px, gutter px-6
 *    1 ×   900px, gutter px-4 sm:px-6
 *    1 ×   840px, gutter px-4 sm:px-6
 *    1 ×  1000px, gutter px-6
 *    1 ×  max-w-3xl (768px), gutter px-4
 * ```
 *
 * Two of those differ from their neighbours only in the gutter — `px-6` versus
 * `px-4 sm:px-6` — which is exactly the reported bug: the header used the
 * responsive gutter and the content beneath it used the flat one, so below the
 * `sm` breakpoint the page visibly stepped in at the shoulder. Nothing was
 * comparing them, because there was nothing to compare: 36 independent strings
 * have no shared definition to disagree with.
 *
 * There is now. The three widths and the two gutters are tokens in
 * `globals.css` (`--width-*`, `--page-gutter*`); this component is the only
 * thing that reads them. A column cannot drift from the one above it because
 * both resolve the same custom property.
 *
 * ## Choosing a width
 *
 * - `wide` — page chrome and index pages: the header, the footer, a grid of
 *   cards. The widest thing on the page.
 * - `reading` — ONE column of running text. Sized for line length, not for the
 *   viewport: past ~800px a paragraph gets hard to track from the end of one
 *   line to the start of the next.
 * - `form` — a single form or auth card, where a wide column makes the fields
 *   look stranded.
 *
 * `bleed` opts a child out horizontally — a hero image that should run to the
 * gutter edge inside a `reading` column — without a second container or a
 * negative margin computed by hand.
 */

import type { ReactNode } from 'react'

const WIDTH_CLASS = {
  wide: 'max-w-[var(--width-wide)]',
  reading: 'max-w-[var(--width-reading)]',
  form: 'max-w-[var(--width-form)]',
} as const

export type PageWidth = keyof typeof WIDTH_CLASS

/**
 * The gutter, as one string. Written as side padding only — never a `padding`
 * shorthand — so a caller adding vertical padding through `className` cannot
 * silently zero the sides out.
 */
const GUTTER_CLASS = 'px-[var(--page-gutter)] sm:px-[var(--page-gutter-sm)]'

export function PageContainer({
  width = 'wide',
  as: Tag = 'div',
  className = '',
  children,
}: {
  width?: PageWidth
  /** The element to render — `main`, `header`, `section`, … Defaults to `div`. */
  as?: 'div' | 'main' | 'header' | 'footer' | 'section' | 'article' | 'nav'
  className?: string
  children: ReactNode
}) {
  return (
    <Tag className={`mx-auto w-full ${WIDTH_CLASS[width]} ${GUTTER_CLASS} ${className}`.trim()}>
      {children}
    </Tag>
  )
}

/**
 * Cancels the container's gutter for one child, so it runs edge to edge inside
 * a narrower column — a hero figure in a `reading` column, for example.
 *
 * The negative margin references the SAME token as the padding it undoes, so
 * the two can never fall out of step; the previous hand-written `-mx-6` was
 * correct for exactly one of the two gutters the page used.
 */
export function PageBleed({
  className = '',
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={`-mx-[var(--page-gutter)] sm:-mx-[var(--page-gutter-sm)] ${className}`.trim()}
    >
      {children}
    </div>
  )
}

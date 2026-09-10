'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * How far through the page the reader is, as a hairline across the top.
 *
 * Two things make this cheap enough to leave on every article view:
 *
 * 1. The scroll listener is `passive`, so it can never delay the scroll itself.
 * 2. It writes the width to a ref-held element via `style` rather than through
 *    React state, so a scroll does not re-render the article. The one piece of
 *    state here is `visible`, which flips at most twice per page.
 *
 * A progress bar that re-rendered a 2,000-word article on every scroll frame
 * would be a worse page than one with no progress bar, which is why this does
 * not use the obvious `useState(progress)`.
 */
export function ReadProgress() {
  const barRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const update = () => {
      const doc = document.documentElement
      const max = doc.scrollHeight - window.innerHeight
      // A page shorter than the viewport has no progress to report; showing a
      // permanently-full or permanently-empty bar states something false.
      if (max <= 0) {
        setVisible(false)
        return
      }
      setVisible(true)
      const pct = Math.min(100, Math.max(0, (window.scrollY / max) * 100))
      if (barRef.current) barRef.current.style.width = `${pct}%`
    }

    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update, { passive: true })
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  if (!visible) return null

  return (
    // `aria-hidden`: the bar duplicates information the scrollbar already gives
    // assistive technology, and announcing a percentage on every scroll frame
    // would be actively hostile to a screen-reader user.
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 bg-transparent"
    >
      <div ref={barRef} className="h-full w-0 bg-primary transition-[width] duration-150" />
    </div>
  )
}

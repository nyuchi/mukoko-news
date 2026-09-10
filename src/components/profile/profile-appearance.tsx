'use client'

import { useEffect, useState } from 'react'
import { SquareDashed } from 'lucide-react'

import {
  applyOutlinePreference,
  readOutlinePreference,
  storeOutlinePreference,
  type OutlinePreference,
} from '@/lib/appearance'

/**
 * Accessibility appearance settings.
 *
 * One control today: whether components draw a visible outline. The app's
 * default is that a card separates from the page by its FILL — outlining every
 * component makes the whole product look like a high-contrast theme and
 * flattens hierarchy, because when everything is boxed nothing is emphasised.
 * A reader who wants harder edges gets them here.
 *
 * Rendered for signed-out readers too: it is a rendering preference stored on
 * the device, and gating an accessibility control behind a sign-in would make
 * it unreachable for exactly the readers most likely to want it.
 *
 * ## Why the control can start "off" and be wrong for one frame — and does not
 *
 * The stored value is read in an effect, which is a paint too late. The
 * pre-paint bootstrap in `layout.tsx` has already set the ATTRIBUTE, so the
 * page itself is never wrong; this only syncs the switch to it, and it reads
 * from the same helper the bootstrap mirrors.
 */
export function ProfileAppearance() {
  const [outlines, setOutlines] = useState<OutlinePreference>('off')

  useEffect(() => {
    setOutlines(readOutlinePreference())
  }, [])

  function choose(next: OutlinePreference) {
    setOutlines(next)
    storeOutlinePreference(next)
    applyOutlinePreference(next, document.documentElement)
  }

  const on = outlines === 'on'

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-outline bg-surface">
      <h2 className="border-b border-elevated px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary">
        Accessibility
      </h2>

      <div className="flex items-start justify-between gap-4 px-4 py-4">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <SquareDashed className="h-4 w-4 text-secondary" aria-hidden="true" />
            <span className="font-medium">Component outlines</span>
          </div>
          <p id="outlines-hint" className="text-xs text-text-secondary">
            Draw a visible edge around cards, panels and chips. Off by default — they are
            separated by their background instead. Your device already turns this on
            automatically if you have asked your system for more contrast.
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-describedby="outlines-hint"
          onClick={() => choose(on ? 'off' : 'on')}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
            on ? 'bg-primary' : 'bg-elevated'
          }`}
        >
          <span className="sr-only">Component outlines</span>
          <span
            aria-hidden="true"
            className={`inline-block h-5 w-5 transform rounded-full bg-background transition-transform ${
              on ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </div>
  )
}

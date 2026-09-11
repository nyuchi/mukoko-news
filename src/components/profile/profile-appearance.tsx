'use client'

import { Check } from 'lucide-react'

import { useTheme, type Theme } from '@/components/theme-provider'
import { AppearancePreview } from '@/components/profile/appearance-preview'
import { type ContrastPreference } from '@/lib/appearance'

/**
 * Appearance: theme and component outlines, both picked by looking.
 *
 * ## Why these are previews and not a switch
 *
 * Outlines used to be a lone toggle with a paragraph explaining what it did,
 * and the theme was a *cycle button* somewhere else on the page that showed
 * only its current value — a reader had to tap it three times to find out what
 * the options even were, and never saw two of them side by side. Both are
 * purely visual settings, so the honest control is the thing itself: each
 * option renders a miniature of the app in that setting. "Dark" is a picture
 * of dark; "Outlines on" is a picture of a card with an edge.
 *
 * Putting them in one card is the other half of it. They are the same
 * decision — how the app looks — and they interact: outlines matter more in a
 * theme where the surface steps sit closer together. Two controls in two
 * places, one of them a cycle button labelled "Appearance", was three taps and
 * a guess.
 *
 * Rendered for signed-out readers too: both are rendering preferences stored
 * on the device, and gating an accessibility control behind a sign-in makes it
 * unreachable for the readers most likely to need it.
 *
 * ## Both come from `useTheme()`
 *
 * Contrast is part of the theme (owner direction 2026-09-11), so the provider
 * owns reading, storing and applying it and this component only renders the
 * choice. It used to hold its own state and write the document itself, which
 * meant nothing else in the app could ask what the setting was.
 *
 * The provider reads both in an effect, a paint too late — but the pre-paint
 * bootstrap in `layout.tsx` has already set the class and the attribute, so
 * the PAGE is never wrong; that read only syncs these controls to it.
 */

const THEMES: { value: Theme; label: string; hint: string }[] = [
  { value: 'light', label: 'Light', hint: 'Always light' },
  { value: 'dark', label: 'Dark', hint: 'Always dark' },
  { value: 'system', label: 'System', hint: 'Follows your device' },
]

export function ProfileAppearance() {
  // BOTH come from the theme, which is the point — contrast is part of the
  // theme, not a preference sitting beside it (owner direction 2026-09-11).
  // This component now only renders the choice; the provider owns reading it,
  // storing it and applying it to the document.
  const { theme, setTheme, contrast, resolvedContrast, setContrast } = useTheme()
  const outlines: ContrastPreference = contrast

  // What the THEME previews draw an edge with: the RESOLVED value, so on a
  // device that is asking for more contrast the `system` choice shows the
  // treatment the reader is actually getting rather than a guess. The provider
  // resolves it; this component never reads a media query of its own.
  const outlined = resolvedContrast === 'more'
  const previewTheme = theme === 'light' ? 'light' : 'dark'

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-outline bg-surface">
      <h2 className="border-b border-elevated px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary">
        Appearance
      </h2>

      <fieldset className="border-b border-elevated px-4 py-4">
        <legend className="mb-3 text-sm font-medium">Theme</legend>
        <div className="grid grid-cols-3 gap-3">
          {THEMES.map((t) => (
            <Option
              key={t.value}
              label={t.label}
              hint={t.hint}
              selected={theme === t.value}
              onSelect={() => setTheme(t.value)}
            >
              <AppearancePreview
                theme={t.value === 'light' ? 'light' : 'dark'}
                split={t.value === 'system'}
                outlined={outlined}
              />
            </Option>
          ))}
        </div>
      </fieldset>

      <fieldset className="px-4 py-4">
        <legend className="mb-1 text-sm font-medium">Contrast</legend>
        <p className="mb-3 text-xs text-text-secondary">
          Draws an edge around cards, panels and chips and brightens the smaller text.
          Choose System to follow your device&rsquo;s own contrast setting.
        </p>
        {/* Three options, mirroring the theme row above, and resolved the same
            way: the provider combines this choice with
            `matchMedia('(prefers-contrast: more)')` and stamps one attribute,
            so the site's setting wins in BOTH directions.

            It was two values under an unconditional media query, which meant a
            reader with the OS switch on got the treatment whatever the control
            said — "Off" was not off. A first pass made the query a third choice
            but only for the edges, so the text lift still ignored it. The whole
            treatment is behind this control now. */}
        <div className="grid grid-cols-3 gap-3">
          <Option
            label="Off"
            hint="Standard palette"
            selected={outlines === 'off'}
            onSelect={() => setContrast('off')}
          >
            <AppearancePreview theme={previewTheme} />
          </Option>
          <Option
            label="On"
            hint="Higher contrast"
            selected={outlines === 'on'}
            onSelect={() => setContrast('on')}
          >
            <AppearancePreview theme={previewTheme} outlined />
          </Option>
          <Option
            label="System"
            hint="Follows your device"
            selected={outlines === 'system'}
            onSelect={() => setContrast('system')}
          >
            <AppearancePreview theme={previewTheme} outlined="split" />
          </Option>
        </div>
      </fieldset>
    </div>
  )
}

/**
 * One choice: the preview, its name, and a check when it is the active one.
 *
 * A `radio` rather than a button — these are exclusive choices within a named
 * group, and the role is what lets a screen reader say "2 of 3" instead of
 * reading three unrelated buttons. The check mark carries the selected state
 * visually as well as through the ring, because a ring alone is a colour-only
 * signal.
 */
function Option({
  label,
  hint,
  selected,
  onSelect,
  children,
}: {
  label: string
  hint: string
  selected: boolean
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`group flex flex-col gap-2 rounded-xl p-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
        selected ? 'bg-elevated' : 'hover:bg-elevated/60'
      }`}
    >
      <span
        className={`block overflow-hidden rounded-lg ring-2 transition-colors ${
          selected ? 'ring-primary' : 'ring-control'
        }`}
      >
        {children}
      </span>
      <span className="flex min-w-0 items-center gap-1">
        <Check
          className={`h-3.5 w-3.5 shrink-0 text-primary ${selected ? '' : 'invisible'}`}
          aria-hidden="true"
        />
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium">{label}</span>
          <span className="block truncate text-[11px] text-text-tertiary">{hint}</span>
        </span>
      </span>
    </button>
  )
}

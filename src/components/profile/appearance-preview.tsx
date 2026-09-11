/**
 * A miniature of the app, drawn in a named theme.
 *
 * The point of a preview is that a reader picks by **looking**, not by reading
 * "Dark" and imagining it. So this is not an icon — it is the real thing at
 * 1/8 scale: a header bar, a card holding two text lines, and the page behind
 * both. The three surfaces it shows are the three the theme actually decides,
 * which is why a preview beats a moon glyph: it is the only control that can
 * show a reader that the card sits a step off the page.
 *
 * Colours are **literal hex, deliberately**. Everywhere else in this app a
 * colour comes from a token, and a hardcoded value is a bug. Here the whole
 * job is to render a theme the document is NOT currently in — a `bg-surface`
 * would paint the active theme in all three cards and the picker would show
 * the same picture three times. `appearance-preview.test.tsx` asserts every
 * value against the Mzizi snapshot, so they cannot drift from `globals.css`
 * without failing.
 */
export type PreviewTheme = 'light' | 'dark'

const PALETTE: Record<PreviewTheme, { page: string; card: string; line: string; dim: string }> = {
  // Mzizi `base` / `surface`, and the two text roles measured on the card.
  light: { page: '#F3F3F1', card: '#EEEEEC', line: '#2E2B27', dim: '#474139' },
  dark: { page: '#0E0D0C', card: '#131211', line: '#E8E8E4', dim: '#D4D4CF' },
}

/** Tanzanite, the brand mineral, per theme. */
const BRAND: Record<PreviewTheme, string> = { light: '#4B0082', dark: '#B388FF' }

/** Mzizi `border`, for the outlined variant. */
const BORDER: Record<PreviewTheme, string> = { light: '#E7E5E0', dark: '#2A2927' }

export function AppearancePreview({
  theme,
  outlined = false,
  /** Renders the light half and the dark half side by side, for "System". */
  split = false,
}: {
  theme: PreviewTheme
  /**
   * `true`/`false` draw the edge or leave it off. `'split'` draws BOTH halves
   * of the same theme — plain on the left, outlined on the right — which is the
   * only honest picture of the outline setting's own "System": whether it draws
   * an edge depends on a `prefers-contrast` query this component cannot read,
   * so committing to either picture would advertise the wrong one to half the
   * readers who see it. Same device as the theme row's split, one axis over.
   */
  outlined?: boolean | 'split'
  split?: boolean
}) {
  if (split) {
    const edged = outlined === true
    return (
      <span aria-hidden="true" className="flex h-14 w-full overflow-hidden rounded-lg">
        <span className="w-1/2">
          <Panel theme="light" outlined={edged} half />
        </span>
        <span className="w-1/2">
          <Panel theme="dark" outlined={edged} half />
        </span>
      </span>
    )
  }

  if (outlined === 'split') {
    return (
      <span aria-hidden="true" className="flex h-14 w-full overflow-hidden rounded-lg">
        <span className="w-1/2">
          <Panel theme={theme} outlined={false} half />
        </span>
        <span className="w-1/2">
          <Panel theme={theme} outlined half />
        </span>
      </span>
    )
  }

  return (
    <span aria-hidden="true" className="block h-14 w-full overflow-hidden rounded-lg">
      <Panel theme={theme} outlined={outlined} />
    </span>
  )
}

function Panel({
  theme,
  outlined,
  half = false,
}: {
  theme: PreviewTheme
  outlined: boolean
  half?: boolean
}) {
  const c = PALETTE[theme]
  const edge = outlined ? `1px solid ${BORDER[theme]}` : '1px solid transparent'

  return (
    <span
      className="flex h-full w-full flex-col gap-1 p-1.5"
      style={{ backgroundColor: c.page }}
    >
      {/* Header bar: the brand mineral, so a reader sees the accent too. */}
      <span
        className="block h-1.5 rounded-full"
        style={{ backgroundColor: BRAND[theme], width: half ? '70%' : '45%' }}
      />
      {/* The card. Its fill is what separates it from the page — the whole
          doctrine in one 40px box. */}
      <span
        className="flex flex-1 flex-col justify-center gap-1 rounded p-1"
        style={{ backgroundColor: c.card, border: edge }}
      >
        <span className="block h-1 rounded-full" style={{ backgroundColor: c.line, width: '80%' }} />
        <span className="block h-1 rounded-full" style={{ backgroundColor: c.dim, width: '55%' }} />
      </span>
    </span>
  )
}

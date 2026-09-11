import {
  BarChart3,
  Bookmark,
  Compass,
  FileText,
  Grid3x3,
  HelpCircle,
  Home,
  LineChart,
  Newspaper,
  Radio,
  Search,
  Shield,
  User,
  Zap,
  type LucideIcon,
} from 'lucide-react'

/**
 * Every place a reader can go, in one list.
 *
 * ## Why this file exists
 *
 * Four surfaces used to navigate this app — the header's dropdown, the mobile
 * bottom nav, the footer and `/profile` — and each carried its own
 * hand-written array. They had drifted: the header dropdown listed ten
 * destinations and omitted `/sources`, `/about`, `/terms`, `/privacy` and
 * `/publishers/claim`; the footer listed five, none of which were reading
 * surfaces; the bottom nav listed five more. So the app had **no surface at
 * all** that could take a reader to every page, and adding a page meant
 * remembering four files.
 *
 * `DESTINATIONS` is now the single list, grouped. The **drawer**
 * (`nav-sidebar.tsx`) renders all of it, so adding a page here reaches the
 * reader with no further edit; the bottom nav is the one space-constrained
 * surface left and names its own five picks by href, so a new page can never
 * silently displace a primary one. The header's dropdown is gone — it was a
 * second, shorter copy of this same list, which is the drift this file exists
 * to end.
 *
 * `/admin` is deliberately absent: it is RBAC-gated, and listing it for
 * everyone advertises a door almost nobody can open. `/sign-in`, `/offline`
 * and `/embed*` are absent for the same reason a sitemap omits them — they are
 * mechanisms, not destinations.
 */
export interface Destination {
  href: string
  label: string
  /**
   * The bottom bar's label. Set only where the full label does not fit a
   * 60px-wide slot — an explicit field rather than truncating `label` at
   * render time, because "Profile & settings" and "NewsBytes" want different
   * answers and a string-splitting rule gets one of them wrong.
   */
  shortLabel?: string
  /** One line, used where a surface has room to explain the destination. */
  description: string
  icon: LucideIcon
  group: NavGroupId
  /**
   * True when the page only makes sense for a signed-in reader. It is still
   * listed for everyone — the page itself handles the redirect, and hiding it
   * would mean an anonymous reader could not discover the feature exists.
   */
  needsAccount?: boolean
}

export type NavGroupId = 'read' | 'yours' | 'data' | 'publishers' | 'about'

/** Group headings, in the order a navigation surface should render them. */
export const NAV_GROUPS: { id: NavGroupId; label: string }[] = [
  { id: 'read', label: 'Read' },
  { id: 'yours', label: 'Yours' },
  { id: 'data', label: 'Open data' },
  { id: 'publishers', label: 'Publishers' },
  { id: 'about', label: 'About' },
]

export const DESTINATIONS: Destination[] = [
  {
    href: '/',
    label: 'Feed',
    description: 'Your front page, built from the countries and topics you follow',
    icon: Home,
    group: 'read',
  },
  {
    href: '/discover',
    label: 'Discover',
    description: 'Browse by country, category or newsroom',
    icon: Compass,
    group: 'read',
  },
  {
    href: '/newsbytes',
    label: 'NewsBytes',
    shortLabel: 'Bytes',
    description: 'Headlines as a vertical swipe feed',
    icon: Zap,
    group: 'read',
  },
  {
    href: '/categories',
    label: 'Categories',
    description: 'Every topic the corpus is classified into',
    icon: Grid3x3,
    group: 'read',
  },
  {
    href: '/sources',
    label: 'Sources',
    description: 'The newsrooms we aggregate, and how they are scored',
    icon: Radio,
    group: 'read',
  },
  {
    href: '/search',
    label: 'Search',
    description: 'Full-text search across every article',
    icon: Search,
    group: 'read',
  },
  {
    href: '/saved',
    label: 'Saved',
    description: 'Articles you kept for later',
    icon: Bookmark,
    group: 'yours',
  },
  {
    href: '/profile',
    label: 'Profile & settings',
    shortLabel: 'Profile',
    description: 'Your account, feed preferences, appearance and accessibility',
    icon: User,
    group: 'yours',
  },
  {
    href: '/insights',
    label: 'Insights',
    description: 'What the corpus looks like — volume, sources, countries, sentiment',
    icon: BarChart3,
    group: 'data',
  },
  {
    href: '/analytics',
    label: 'Analytics',
    description: 'Query the corpus yourself and export the answer',
    icon: LineChart,
    group: 'data',
    needsAccount: true,
  },
  {
    href: '/publishers/claim',
    label: 'Claim your newsroom',
    description: 'Verify that you publish a source we carry',
    icon: Shield,
    group: 'publishers',
  },
  {
    href: '/dashboard',
    label: 'Publisher dashboard',
    description: 'Your newsroom’s trust score, reach and feed submissions',
    icon: Newspaper,
    group: 'publishers',
    needsAccount: true,
  },
  {
    href: '/about',
    label: 'About',
    description: 'What Mukoko News is and who builds it',
    icon: FileText,
    group: 'about',
  },
  {
    href: '/help',
    label: 'Help',
    description: 'Guides and answers',
    icon: HelpCircle,
    group: 'about',
  },
  {
    href: '/terms',
    label: 'Terms',
    description: 'Terms of use',
    icon: FileText,
    group: 'about',
  },
  {
    href: '/privacy',
    label: 'Privacy',
    description: 'What we collect, and what we do not',
    icon: Shield,
    group: 'about',
  },
]

const BY_HREF = new Map(DESTINATIONS.map((d) => [d.href, d]))

/**
 * Look destinations up by href, in the order given.
 *
 * Throws on an unknown href rather than silently rendering a shorter bar. A
 * bottom nav quietly dropping from five items to four because someone renamed
 * a route is exactly the kind of failure that ships — this turns it into a
 * build-time crash in the test that renders the component.
 */
export function pick(...hrefs: string[]): Destination[] {
  return hrefs.map((href) => {
    const found = BY_HREF.get(href)
    if (!found) throw new Error(`navigation: no destination registered for "${href}"`)
    return found
  })
}

export function destinationsInGroup(group: NavGroupId): Destination[] {
  return DESTINATIONS.filter((d) => d.group === group)
}

/**
 * The island's two fixed ends (owner decision 2026-09-11).
 *
 * Everything BETWEEN these is contextual to the page. Two anchors rather than
 * a fixed bar of five, because the value of a floating island is that it
 * carries what the current page needs — but a control that moves under your
 * thumb between pages is worse than no control at all. So the way home and the
 * way to your account never move, and the middle is free to change.
 */
export const ISLAND_HOME_HREF = '/'
export const ISLAND_ACCOUNT_HREF = '/profile'

/**
 * What fills the middle when the page contributes nothing of its own.
 *
 * A reading surface with no actions of its own should still be navigation, not
 * a gap — so the island falls back to the three destinations a thumb reaches
 * for constantly. A page with actions (an article: like, save, share, open at
 * the publisher) replaces these via `useIslandActions`.
 */
export const ISLAND_DEFAULT_HREFS = ['/discover', '/newsbytes', '/saved'] as const

/**
 * The island at rest, end to end.
 *
 * Five is the ceiling for a thumb-reachable row, which is what caps the
 * contextual middle at three: two anchors plus three is the whole budget.
 */
export const BOTTOM_NAV_HREFS = [
  ISLAND_HOME_HREF,
  ...ISLAND_DEFAULT_HREFS,
  ISLAND_ACCOUNT_HREF,
] as const

/**
 * Routes that render no app chrome at all.
 *
 * Only the embed iframe qualifies: it is our markup inside somebody else's
 * page, so our navigation would be a foreign floating pill over their content.
 * **NewsBytes is deliberately NOT here.** It used to be, along with every
 * article page, which left a reader on the immersive feed with no visible way
 * back to anything — the single most common way to get stranded in this app.
 */
export function hidesAppChrome(pathname: string): boolean {
  return pathname === '/embed/iframe' || pathname.startsWith('/embed/iframe/')
}

/**
 * Routes whose chrome floats over full-bleed content rather than sitting on
 * the page background. The bottom bar stays put; it just needs to read against
 * a photo or video instead of a surface colour.
 */
export function isImmersive(pathname: string): boolean {
  return pathname === '/newsbytes'
}

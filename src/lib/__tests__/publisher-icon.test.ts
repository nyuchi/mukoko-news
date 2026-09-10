import { describe, it, expect } from 'vitest'
import {
  faviconServiceUrl,
  faviconSize,
  publisherDomain,
  publisherIconUrl,
  resolvePublisherIcon,
} from '@/lib/publisher-icon'
import { getExactProfileDomain, getSourceProfile } from '@/lib/source-profiles'

/** The original URL the image-worker proxy was asked to fetch. */
function proxiedTarget(url: string): string {
  const parsed = new URL(url)
  expect(parsed.origin).toBe('https://assets.mukoko.com')
  expect(parsed.pathname.startsWith('/i/')).toBe(true)
  return decodeURIComponent(parsed.pathname.slice(3))
}

describe('publisherDomain', () => {
  it('takes the host of an absolute http(s) URL', () => {
    expect(publisherDomain('https://herald.co.zw/some/article')).toBe('herald.co.zw')
    expect(publisherDomain('http://263chat.com')).toBe('263chat.com')
  })

  it('strips delivery subdomains so one publisher is one icon', () => {
    // www.herald.co.zw (the org record) and herald.co.zw (the article link) must
    // resolve to the same host, or the proxy caches the same icon twice.
    expect(publisherDomain('https://www.herald.co.zw/feed/')).toBe('herald.co.zw')
    expect(publisherDomain('https://feeds.newsday.co.zw/rss')).toBe('newsday.co.zw')
    expect(publisherDomain('https://m.news24.com')).toBe('news24.com')
    expect(publisherDomain('https://rss.iol.co.za/x')).toBe('iol.co.za')
  })

  it('keeps EDITORIAL subdomains — a country or section desk is its own masthead', () => {
    expect(publisherDomain('https://english.ahram.org.eg/rss.aspx')).toBe('english.ahram.org.eg')
    expect(publisherDomain('https://news.pindula.co.zw')).toBe('news.pindula.co.zw')
  })

  it('refuses anything that is not an absolute http(s) URL', () => {
    expect(publisherDomain('herald.co.zw')).toBeNull()
    expect(publisherDomain('/relative/path')).toBeNull()
    expect(publisherDomain('javascript:alert(1)')).toBeNull()
    expect(publisherDomain('data:image/png;base64,AAAA')).toBeNull()
    expect(publisherDomain('')).toBeNull()
    expect(publisherDomain(undefined)).toBeNull()
    expect(publisherDomain(null)).toBeNull()
  })

  it('refuses a host that is not a public publisher', () => {
    expect(publisherDomain('http://localhost:3000/x')).toBeNull()
    // Stripping `www.` must not leave a bare label behind.
    expect(publisherDomain('https://www.localhost')).toBeNull()
  })
})

describe('faviconSize', () => {
  it('rounds UP to a size the service actually renders', () => {
    expect(faviconSize(20)).toBe(32)
    expect(faviconSize(32)).toBe(32)
    expect(faviconSize(40)).toBe(64)
  })

  it('clamps a nonsense request instead of propagating it', () => {
    expect(faviconSize(0)).toBe(32)
    expect(faviconSize(-1)).toBe(32)
    expect(faviconSize(Number.NaN)).toBe(32)
    expect(faviconSize(4096)).toBe(256)
  })
})

describe('publisherIconUrl (privacy: never a direct third-party request)', () => {
  it('routes the favicon service through the Mukoko image proxy', () => {
    const url = publisherIconUrl('herald.co.zw', 32)
    // The BROWSER must only ever be pointed at assets.mukoko.com — this is the
    // whole privacy fix. A direct s2/favicons src would tell Google which
    // publisher each reader is reading, on every card of every page.
    expect(url.startsWith('https://assets.mukoko.com/i/')).toBe(true)
    expect(proxiedTarget(url)).toBe(faviconServiceUrl('herald.co.zw', 32))
  })

  it('never emits a bare favicon-service URL', () => {
    expect(publisherIconUrl('news24.com', 64)).not.toMatch(/^https:\/\/www\.google\.com/)
  })

  it('asks the proxy for a square, uncropped render', () => {
    const params = new URL(publisherIconUrl('iol.co.za', 32)).searchParams
    expect(params.get('w')).toBe('32')
    expect(params.get('h')).toBe('32')
    expect(params.get('fit')).toBe('contain')
  })

  it('percent-encodes the domain into the service URL', () => {
    expect(faviconServiceUrl('a b.com', 32)).toContain('domain=a%20b.com')
  })
})

describe('resolvePublisherIcon — resolution order', () => {
  const everything = {
    name: 'The Herald',
    logo: 'https://cdn.herald.co.zw/logo.png',
    organizationUrl: 'https://www.herald.co.zw',
    sourceUrl: 'https://www.herald.co.zw/feed/',
    articleUrl: 'https://www.herald.co.zw/story-123/',
  }

  it('1. prefers the organisation’s own logo over any derived favicon', () => {
    const icon = resolvePublisherIcon(everything, 32)
    expect(icon.origin).toBe('organization-logo')
    expect(proxiedTarget(icon.url!)).toBe('https://cdn.herald.co.zw/logo.png')
  })

  it('2. falls to the organisation’s own domain when there is no logo', () => {
    const icon = resolvePublisherIcon({ ...everything, logo: null }, 32)
    expect(icon.origin).toBe('organization-domain')
    expect(icon.domain).toBe('herald.co.zw')
  })

  it('3. falls to the feed source’s own URL when the organisation has none', () => {
    const icon = resolvePublisherIcon(
      { ...everything, logo: null, organizationUrl: undefined },
      32
    )
    expect(icon.origin).toBe('source-domain')
    expect(icon.domain).toBe('herald.co.zw')
  })

  it('4. falls to the article’s own link — its host IS the publisher', () => {
    const icon = resolvePublisherIcon(
      { name: 'Some Outlet', articleUrl: 'https://www.mmegi.bw/news/story' },
      32
    )
    expect(icon.origin).toBe('article-domain')
    expect(icon.domain).toBe('mmegi.bw')
  })

  it('5. falls to the brand table only on an EXACT name match', () => {
    const icon = resolvePublisherIcon({ name: 'techzim' }, 32)
    expect(icon.origin).toBe('profile-domain')
    expect(icon.domain).toBe('techzim.co.zw')
  })

  it('6. returns nothing when there is no publisher to point at', () => {
    expect(resolvePublisherIcon({ name: 'An Outlet With No Record' }, 32)).toEqual({
      url: null,
      domain: null,
      origin: null,
    })
    expect(resolvePublisherIcon({}, 32).url).toBeNull()
  })

  it('skips a tier whose URL is unusable rather than failing the whole chain', () => {
    const icon = resolvePublisherIcon(
      {
        name: 'Mmegi Online',
        organizationUrl: 'not-a-url',
        sourceUrl: 'javascript:alert(1)',
        articleUrl: 'https://www.mmegi.bw/rss.xml',
      },
      32
    )
    expect(icon.origin).toBe('article-domain')
    expect(icon.domain).toBe('mmegi.bw')
  })
})

describe('resolvePublisherIcon — never renders an unsafe or wrong icon', () => {
  it('rejects a logo with a dangerous scheme and derives instead', () => {
    for (const logo of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'vbscript:x']) {
      const icon = resolvePublisherIcon(
        { name: 'X', logo, organizationUrl: 'https://x.co.zw' },
        32
      )
      expect(icon.origin).toBe('organization-domain')
      expect(icon.url).not.toContain('javascript')
    }
  })

  it('rejects a root-relative logo — that would resolve against Mukoko’s own origin', () => {
    // `isValidImageUrl` admits "/x.png" for local assets; a PUBLISHER logo that
    // is root-relative is not the publisher's mark, it is ours.
    const icon = resolvePublisherIcon(
      { name: 'X', logo: '/mukoko-appicon.png', organizationUrl: 'https://x.co.zw' },
      32
    )
    expect(icon.origin).toBe('organization-domain')
  })

  it('does NOT substring-match a name onto an unrelated publisher', () => {
    // The bug this replaces: "National Geographic" and "Amnesty International"
    // both contain "Nation", so the old substring lookup served both the Daily
    // Nation's icon. 11 of the 38 live sources the old table matched were wrong
    // this way.
    for (const name of [
      'National Geographic',
      'Amnesty International',
      'The Standard Newspaper | Gambia',
      'The Patriotic Vanguard',
    ]) {
      expect(resolvePublisherIcon({ name }, 32).url).toBeNull()
    }
  })

  it('still resolves those publishers correctly from their own record', () => {
    expect(
      resolvePublisherIcon({
        name: 'The Standard Newspaper | Gambia',
        organizationUrl: 'https://standard.gm',
      }).domain
    ).toBe('standard.gm')
  })
})

describe('getExactProfileDomain', () => {
  it('matches exactly, case-insensitively, and trims', () => {
    expect(getExactProfileDomain('The Herald')).toBe('herald.co.zw')
    expect(getExactProfileDomain('  bbc  ')).toBe('bbc.com')
  })

  it('does not substring-match, unlike getSourceProfile', () => {
    // getSourceProfile still substring-matches — that is fine for picking an
    // avatar colour and wrong for picking whose logo to show, which is exactly
    // why the icon path has its own lookup.
    expect(getSourceProfile('National Geographic').domain).toBe('nation.africa')
    expect(getExactProfileDomain('National Geographic')).toBeNull()
  })

  it('returns null for an empty or missing name', () => {
    expect(getExactProfileDomain('')).toBeNull()
    expect(getExactProfileDomain('   ')).toBeNull()
    expect(getExactProfileDomain(undefined)).toBeNull()
    expect(getExactProfileDomain(null)).toBeNull()
  })
})

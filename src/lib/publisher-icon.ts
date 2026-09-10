/**
 * Resolve a publisher's icon from the ONE record that owns its identity.
 *
 * ## The problem this replaces
 *
 * `getFaviconUrl()` in `source-profiles.ts` could only answer for a publisher
 * that appeared in a ~20-entry hardcoded table. Measured on the live cluster
 * (2026-09-10): of **587 feed sources**, the table matched **38** — and it
 * matched them with a substring test, so **11 of those 38 were matched to the
 * WRONG publisher**. "National Geographic" and "Amnesty International" both
 * contain "Nation", so both were served Kenya's `nation.africa` icon; "The
 * Standard Newspaper | Gambia" was served Zimbabwe's `thestandard.co.zw`.
 * Everything else — 549 of 587 — fell through to coloured initials.
 *
 * A publisher's own domain is already on its own record. All **537**
 * organisations in `news.newsMediaOrganizations` carry an http(s) `url`, and all
 * 587 feed sources resolve to one, so a domain is derivable for **587 of 587**
 * (535 distinct hosts) without a table and without a guess.
 *
 * ## Nothing here is stored on an article
 *
 * Publisher identity — name, domain, logo, and above all verification — has
 * exactly one instance: the publisher record. This module RESOLVES that
 * reference at render time from values the read layer already carries. It never
 * writes, and nothing it produces is persisted onto `news.articles`. A logo
 * copied across 63,832 documents would outlive the record it was copied from,
 * which is the same failure mode as a copied trust flag.
 *
 * ## It never invents a publisher
 *
 * Every tier below derives the domain from a URL that IS the publisher's own —
 * its record's homepage, its feed endpoint, or the article's own link. When none
 * of those is available the answer is `null` and the caller draws initials. A
 * missing icon is a known gap; a wrong icon is a false attribution rendered next
 * to someone else's reporting, which is the bug this file exists to remove.
 */

import { imageProxyUrl } from '@/lib/image'
import { getExactProfileDomain } from '@/lib/source-profiles'
import { isValidImageUrl } from '@/lib/utils'

/** Which tier of the resolution order answered. Exposed for tests and debugging. */
export type PublisherIconOrigin =
  | 'organization-logo'
  | 'organization-domain'
  | 'source-domain'
  | 'article-domain'
  | 'profile-domain'

export interface PublisherIconInput {
  /**
   * The organisation's own logo, from `news.newsMediaOrganizations.logo`.
   *
   * Zero of 537 records carry one today (532 absent, 5 explicitly null, measured
   * 2026-09-10). It is still the first tier because it is the only tier that is
   * the publisher's actual mark rather than a third party's rendering of it: the
   * day the pipeline fills that field, every card upgrades with no code change
   * and the favicon service drops out of the path entirely.
   */
  logo?: string | null
  /** The organisation's own homepage (`newsMediaOrganizations.url`). */
  organizationUrl?: string | null
  /** The feed source's own site or feed URL (`feedSources.sourceUrl ?? feedUrl`). */
  sourceUrl?: string | null
  /** The article's own link. Its host is by definition the publisher's. */
  articleUrl?: string | null
  /** Display name. Used only for the last-resort brand table and for initials. */
  name?: string | null
}

export interface ResolvedPublisherIcon {
  /** A URL safe to put in an `<img src>`, or null when the caller must draw initials. */
  url: string | null
  /** The publisher host the icon was derived from, or null. */
  domain: string | null
  /** Which tier answered, or null when none did. */
  origin: PublisherIconOrigin | null
}

/**
 * Subdomains that address a DELIVERY channel rather than a newsroom.
 *
 * Stripping these folds `www.herald.co.zw` and `herald.co.zw` onto one icon
 * request (and so onto one proxy cache entry). Editorial subdomains are
 * deliberately NOT stripped: `english.ahram.org.eg` and `za.ign.com` are real
 * desks with their own identity, the same rule the pipeline's `host_key` follows
 * when it decides whether two feed records are one publisher.
 */
const DELIVERY_SUBDOMAIN = /^(?:www\d?|feeds?|rss|m|amp)\./

/**
 * The sizes the favicon service actually renders. Asking for anything else gets
 * silently rounded there, which would fragment the proxy cache across sizes that
 * return identical bytes.
 */
const FAVICON_SIZES = [16, 32, 64, 128, 256] as const

/** Smallest supported render at or above `requested`. */
export function faviconSize(requested: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return 32
  return FAVICON_SIZES.find((s) => s >= requested) ?? FAVICON_SIZES[FAVICON_SIZES.length - 1]
}

/**
 * The publisher host behind a URL, or null.
 *
 * Only absolute http(s) URLs answer. A bare domain, a relative path, a
 * `javascript:` href or anything unparseable returns null rather than being
 * coerced — these values are publisher-controlled and reach an `<img src>`.
 */
export function publisherDomain(url: string | null | undefined): string | null {
  const trimmed = url?.trim()
  if (!trimmed) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  const host = parsed.hostname.toLowerCase().replace(DELIVERY_SUBDOMAIN, '')
  // A hostname with no dot is not a public publisher (`localhost`, an intranet
  // name); one left empty by the strip is not a host at all.
  return host && host.includes('.') ? host : null
}

/**
 * The favicon service URL for a domain.
 *
 * This is Google's `s2/favicons`, which is why the result MUST be proxied (see
 * `publisherIconUrl`): called from the page it would report to Google which
 * publisher every reader is reading, on every card, on every page view.
 */
export function faviconServiceUrl(domain: string, size: number): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${faviconSize(size)}`
}

/**
 * The URL a browser should actually request for a publisher's favicon.
 *
 * Routed through the Mukoko image worker (`assets.mukoko.com/i/*`) — the same
 * proxy every article image already goes through. Three things follow from that:
 *
 * 1. **The reader never talks to the favicon service.** The worker fetches it
 *    server-side, so no reader IP, user-agent, cookie or `Referer` reaches
 *    Google. What is left is that Mukoko's worker asks for icons of publishers
 *    Mukoko carries — a fact already public on `/sources` — with no reader
 *    attached to any of it.
 * 2. **It is one fetch per publisher, not per reader.** The worker caches at the
 *    edge and in R2 with `max-age=2592000, immutable`, so a 587-source catalogue
 *    costs a few hundred upstream requests in total instead of one per card per
 *    reader, on networks where every request is metered.
 * 3. **It is same-origin-ish and image-typed.** The worker's content-type
 *    allowlist admits png/jpeg/webp/avif/gif and rejects SVG, so a publisher
 *    logo that turns out to be an SVG fails closed to initials rather than
 *    rendering markup.
 *
 * A publisher-hosted `/favicon.ico` is deliberately NOT tried: `image/x-icon` is
 * not on the worker's allowlist, so it would 400 on every source.
 */
export function publisherIconUrl(domain: string, size: number): string {
  const px = faviconSize(size)
  return imageProxyUrl(faviconServiceUrl(domain, px), {
    width: px,
    height: px,
    // `contain` never crops: a wordmark that is not square keeps its shape.
    fit: 'contain',
    // Icons are tiny and mostly flat colour; the extra quality costs bytes that
    // round to nothing and stops small glyphs turning to mush.
    quality: 90,
  })
}

/**
 * Resolve a publisher's icon, in the order that puts the publisher's OWN record
 * first and a guess last.
 *
 *   1. the organisation's own `logo`
 *   2. the domain of the organisation's own homepage
 *   3. the domain of the feed source's own URL
 *   4. the domain of the article's own link
 *   5. the brand table, on an EXACT name match only
 *   6. nothing — the caller draws initials
 *
 * Tier 5 is exact-match only on purpose. The old substring rule is what served
 * Amnesty International the Daily Nation's icon; with tiers 2-4 answering for
 * 587 of 587 live sources it is now only reachable from a caller that has a name
 * and nothing else (the embed widget's ticker, a test), and there a wrong icon is
 * still worse than initials.
 */
export function resolvePublisherIcon(
  input: PublisherIconInput,
  size = 32
): ResolvedPublisherIcon {
  // A logo is a publisher-controlled URL heading for an `<img src>`; validate it
  // with the repo's guard before it can get there.
  const logo = input.logo?.trim()
  if (logo && isValidImageUrl(logo) && /^https?:\/\//i.test(logo)) {
    return {
      // Proxied like every other remote image: same optimisation, same cache,
      // and no third-party host learning who viewed the card.
      url: imageProxyUrl(logo, {
        width: faviconSize(size),
        height: faviconSize(size),
        fit: 'contain',
        quality: 90,
      }),
      domain: publisherDomain(logo),
      origin: 'organization-logo',
    }
  }

  const tiers: Array<[PublisherIconOrigin, string | null | undefined]> = [
    ['organization-domain', input.organizationUrl],
    ['source-domain', input.sourceUrl],
    ['article-domain', input.articleUrl],
  ]
  for (const [origin, candidate] of tiers) {
    const domain = publisherDomain(candidate)
    if (domain) return { url: publisherIconUrl(domain, size), domain, origin }
  }

  // Exact-match only — `getExactProfileDomain`, never the substring matcher
  // `getSourceProfile` uses for colours. See the tier-5 note above.
  const fromTable = getExactProfileDomain(input.name)
  if (fromTable) {
    return { url: publisherIconUrl(fromTable, size), domain: fromTable, origin: 'profile-domain' }
  }

  return { url: null, domain: null, origin: null }
}

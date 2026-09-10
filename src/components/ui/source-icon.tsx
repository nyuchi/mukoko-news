"use client";

import { useState } from "react";
import Image from "next/image";
import { resolvePublisherIcon } from "@/lib/publisher-icon";
import { getSourceColors, getSourceInitials } from "@/lib/source-profiles";

/**
 * The fields the icon resolver needs off whatever the caller is rendering.
 *
 * Structural, not `Article`, so the same helper serves an article, a feed-source
 * row on `/sources`, and the embed widget's ticker — and so that
 * `sourceIconProps` below can start reading `article.publisher` the moment the
 * publisher-resolution work lands, without every call site changing again.
 */
export interface PublisherIconFields {
  source: string;
  /** The publisher's own website, resolved on read from its record. */
  source_url?: string | null;
  /** The article's own link — its host is by definition the publisher's. */
  original_url?: string | null;
  /**
   * The resolved publishing organisation, when the read layer carries one.
   * Typed structurally and optionally so this compiles both before and after
   * `Article.publisher` exists.
   */
  publisher?: { url?: string; logo?: string } | null;
}

/**
 * Spread this into `<SourceIcon>` / `<SourceBadge>` from anything article-shaped.
 *
 * It exists so the ORDER of preference lives in one place: when the publisher
 * organisation is present it outranks the feed source, because the organisation
 * record is the single instance of publisher identity and one masthead routinely
 * holds several feed-source records.
 */
export function sourceIconProps(item: PublisherIconFields) {
  return {
    source: item.source,
    logo: item.publisher?.logo,
    organizationUrl: item.publisher?.url,
    sourceUrl: item.source_url,
    articleUrl: item.original_url,
  };
}

interface SourceIconProps {
  /** Display name. Drives the initials and the avatar colour. */
  source: string;
  /** The organisation's own logo, when its record carries one. */
  logo?: string | null;
  /** The organisation's own homepage. */
  organizationUrl?: string | null;
  /** The feed source's own site or feed URL. */
  sourceUrl?: string | null;
  /** The article's own link. */
  articleUrl?: string | null;
  size?: number;
  showBorder?: boolean;
  className?: string;
}

export function SourceIcon({
  source,
  logo,
  organizationUrl,
  sourceUrl,
  articleUrl,
  size = 20,
  showBorder = true,
  className = "",
}: SourceIconProps) {
  const [imageError, setImageError] = useState(false);

  // Request at 2x so the icon is sharp on the phone screens most of this
  // audience reads on; the resolver rounds to a size the service renders.
  const icon = resolvePublisherIcon(
    { name: source, logo, organizationUrl, sourceUrl, articleUrl },
    size * 2
  );
  const colors = getSourceColors(source);
  const initials = getSourceInitials(source);

  // A publisher with no derivable domain, or an icon the proxy could not fetch
  // (404, WAF block, a logo that turned out to be an SVG), falls back to
  // initials. A missing icon is a gap; a broken one is a hole in the layout.
  const showInitials = !icon.url || imageError;

  return (
    <div
      className={`flex items-center justify-center overflow-hidden ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: showInitials ? colors.primary : 'transparent',
        // Mzizi `--border` rather than a hardcoded rgba black: the old value was
        // invisible in dark mode and too heavy in light.
        border: showBorder ? '1px solid var(--border)' : 'none',
      }}
    >
      {showInitials ? (
        <span
          className="font-bold text-white"
          style={{ fontSize: size * 0.45 }}
        >
          {initials.substring(0, 2)}
        </span>
      ) : (
        <Image
          src={icon.url!}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          className="rounded-full"
          onError={() => setImageError(true)}
          // Already sized and optimised by the image worker; Vercel's optimizer
          // would be a second hop for 32 square pixels.
          unoptimized
        />
      )}
    </div>
  );
}

interface SourceBadgeProps {
  source: string;
  logo?: string | null;
  organizationUrl?: string | null;
  sourceUrl?: string | null;
  articleUrl?: string | null;
  iconSize?: number;
  className?: string;
}

export function SourceBadge({
  source,
  logo,
  organizationUrl,
  sourceUrl,
  articleUrl,
  iconSize = 16,
  className = "",
}: SourceBadgeProps) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <SourceIcon
        source={source}
        logo={logo}
        organizationUrl={organizationUrl}
        sourceUrl={sourceUrl}
        articleUrl={articleUrl}
        size={iconSize}
        showBorder={false}
      />
      <span className="text-xs font-medium text-text-secondary truncate">
        {source}
      </span>
    </div>
  );
}

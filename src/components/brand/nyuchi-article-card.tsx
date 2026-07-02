"use client";

// ── INFRASTRUCTURE HARNESS (auto-wired) ──
// Every brand component participates in observability, motion, a11y,
// and health monitoring via the harness. Zero manual config.
import { useNyuchiHarness } from "@/lib/harness";

import * as React from "react";
import Link from "next/link";
import {
  Clock,
  BookOpen,
  CheckCircle,
  AlertTriangle,
  HelpCircle,
  type BrandIcon,
} from "@/lib/icons";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════
   NYUCHI ARTICLE CARD — News Brand Component

   Canonical source: mzizi_db → component_documents (node 3,
   collection brand, name nyuchi-article-card). "News article card
   extending nyuchi-listing-card with factcheck badge, source
   attribution, journalist byline, and read time."

   Documented deviations from the canonical source (upstreamable):
   - fixed duplicate className on the hero variant root
   - `loading` added to the props interface (destructured upstream
     but never declared)
   - entry animation (animStyle) is actually applied to the root
   - optional `href` renders the card as a next/link (whole-card nav)
   - `sourceSlot` / `footer` ReactNode slots so apps can inject a
     richer source badge (favicon) and engagement row
   - images are expected pre-proxied (imageProxyUrl) + lazy
   ═══════════════════════════════════════════════════════════════ */

type FactCheckStatus = "verified" | "disputed" | "unverified" | "false" | "pending";

const factCheckConfig: Record<FactCheckStatus, { label: string; color: string; icon: BrandIcon }> = {
  verified: { label: "Verified", color: "var(--status-success, #64FFDA)", icon: CheckCircle },
  disputed: { label: "Disputed", color: "var(--status-warning, #FFD740)", icon: AlertTriangle },
  unverified: { label: "Unverified", color: "var(--status-neutral, #6B6B66)", icon: HelpCircle },
  false: { label: "False", color: "var(--status-error, #FF5252)", icon: AlertTriangle },
  pending: { label: "Checking", color: "var(--color-cobalt,#00B0FF)", icon: Clock },
};

interface NyuchiArticleCardProps {
  loading?: boolean;
  title: string;
  excerpt?: string;
  /** Image URL — pass an already-proxied URL (imageProxyUrl) */
  image?: string;
  sourceName?: string;
  sourceVerified?: boolean;
  authorName?: string;
  publishedAt?: string;
  readTime?: string;
  category?: string;
  factCheckStatus?: FactCheckStatus;
  viewCount?: number;
  variant?: "row" | "compact" | "hero";
  /** Whole-card navigation target (internal routes use next/link) */
  href?: string;
  /** Rich source attribution slot (e.g. favicon SourceBadge) — replaces sourceName text */
  sourceSlot?: React.ReactNode;
  /** Footer slot rendered below the meta row (e.g. engagement bar) */
  footer?: React.ReactNode;
  /** Index in a list — used for stagger animation delay */
  index?: number;
  onClick?: () => void;
  className?: string;
}

function NyuchiArticleCard({
  loading = false,
  title,
  excerpt,
  image,
  sourceName,
  sourceVerified,
  authorName,
  publishedAt,
  readTime,
  category,
  factCheckStatus,
  variant = "row",
  href,
  sourceSlot,
  footer,
  index,
  onClick,
  className,
}: NyuchiArticleCardProps) {
  const { motion, observabilityAttrs } = useNyuchiHarness("article-card");
  const animStyle = React.useMemo(
    () =>
      motion.prefersReduced
        ? {}
        : {
            animation: `nyuchi-fade-slide-up ${motion.enterDuration}ms ${motion.enterEasing} both`,
            animationDelay: index != null ? `${motion.staggerDelay(index)}ms` : "0ms",
          },
    [motion, index]
  );

  if (loading) {
    return (
      <div
        data-slot="nyuchi-article-card"
        {...observabilityAttrs}
        data-loading
        role="article"
        className="animate-pulse rounded-[var(--radius-card,14px)] bg-card p-4 ring-1 ring-foreground/10 space-y-3"
      >
        <div className="flex gap-3">
          <div className="size-20 shrink-0 rounded-[var(--radius-inner,7px)] bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-3/4 rounded bg-muted" />
            <div className="h-2.5 w-full rounded bg-muted" />
            <div className="h-2.5 w-1/2 rounded bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  const fcConfig = factCheckStatus ? factCheckConfig[factCheckStatus] : null;
  const FcIcon = fcConfig?.icon;

  // Wraps the variant body in a next/link (internal), anchor (external),
  // or plain div (onClick), carrying the shared data attributes.
  const wrap = (body: React.ReactNode, classes: string) => {
    // role="article" only on the non-interactive wrapper — putting it on an
    // anchor would override the link role for assistive tech (canonical bug).
    const sharedAttrs = {
      "data-slot": "nyuchi-article-card",
      "data-variant": variant,
      ...observabilityAttrs,
    };
    if (href) {
      const linkClasses = cn(
        classes,
        "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      );
      if (href.startsWith("/")) {
        return (
          <Link {...sharedAttrs} href={href} aria-label={`Read article: ${title}`} className={linkClasses} style={animStyle}>
            {body}
          </Link>
        );
      }
      return (
        <a {...sharedAttrs} href={href} aria-label={`Read article: ${title}`} className={linkClasses} style={animStyle}>
          {body}
        </a>
      );
    }
    return (
      <div
        {...sharedAttrs}
        role="article"
        onClick={onClick}
        className={cn(classes, onClick && "cursor-pointer")}
        style={animStyle}
      >
        {body}
      </div>
    );
  };

  if (variant === "hero") {
    return wrap(
      <>
        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="absolute inset-0 size-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
        <div className="relative z-10">
          {category && (
            <span className="mb-2 inline-flex rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
              {category}
            </span>
          )}
          <h3 className="font-serif text-lg font-bold leading-snug text-white">{title}</h3>
          <div className="mt-2 flex items-center gap-3 text-xs text-white/80">
            {sourceSlot || (sourceName && <span>{sourceName}</span>)}
            {publishedAt && <span>{publishedAt}</span>}
            {readTime && (
              <span className="flex items-center gap-1">
                <BookOpen className="size-3" />
                {readTime}
              </span>
            )}
          </div>
          {footer}
        </div>
      </>,
      "relative flex min-h-[200px] flex-col justify-end overflow-hidden rounded-[var(--radius-card,14px)] p-5"
    );
  }

  if (variant === "compact") {
    return wrap(
      <>
        {image && (
          <div className="aspect-video overflow-hidden bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image}
              alt=""
              loading="lazy"
              className="size-full object-cover transition-transform duration-300 group-hover/article:scale-105"
            />
          </div>
        )}
        <div className="p-4">
          {category && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary">
              {category}
            </span>
          )}
          <h4 className="mt-1 line-clamp-2 text-sm font-semibold text-foreground group-hover/article:underline decoration-2 underline-offset-2">
            {title}
          </h4>
          {excerpt && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{excerpt}</p>}
          <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
            {sourceSlot || <span>{sourceName || authorName}</span>}
            <div className="flex items-center gap-2">
              {publishedAt && <span>{publishedAt}</span>}
              {readTime && <span>{readTime}</span>}
              {fcConfig && FcIcon && <FcIcon className="size-3" style={{ color: fcConfig.color }} />}
            </div>
          </div>
          {footer}
        </div>
      </>,
      "group/article flex flex-col overflow-hidden rounded-[var(--radius-card,14px)] bg-card ring-1 ring-foreground/10 hover:shadow-md transition-shadow"
    );
  }

  return wrap(
    <>
      <div className="min-w-0 flex-1">
        {category && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary">
            {category}
          </span>
        )}
        <h4 className="line-clamp-2 text-sm font-semibold text-foreground group-hover/article:underline decoration-2 underline-offset-2">
          {title}
        </h4>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
          {sourceSlot ||
            (sourceName && (
              <span className="flex items-center gap-1">
                {sourceName}
                {sourceVerified && <CheckCircle className="size-2.5 text-[var(--status-success)]" />}
              </span>
            ))}
          {publishedAt && <span>· {publishedAt}</span>}
          {readTime && (
            <span className="flex items-center gap-1">
              <BookOpen className="size-3" />
              {readTime}
            </span>
          )}
        </div>
        {fcConfig && FcIcon && (
          <span className="mt-1 flex items-center gap-1 text-[10px] font-medium" style={{ color: fcConfig.color }}>
            <FcIcon className="size-3" />
            {fcConfig.label}
          </span>
        )}
        {footer}
      </div>
      {image && (
        <div className="size-16 shrink-0 overflow-hidden rounded-[var(--radius-inner,7px)] bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="" loading="lazy" className="size-full object-cover" />
        </div>
      )}
    </>,
    "group/article flex items-center gap-3 rounded-[var(--radius-card,14px)] bg-card py-3 px-4 ring-1 ring-foreground/10 hover:shadow-md transition-shadow"
  );
}

export { NyuchiArticleCard };
export type { NyuchiArticleCardProps, FactCheckStatus };

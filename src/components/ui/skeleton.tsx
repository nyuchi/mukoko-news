"use client";

import { cn } from "@/lib/utils";
import { MukokoSpinner } from "@/components/ui/mukoko-spinner";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-elevated",
        className
      )}
      aria-hidden="true"
    />
  );
}

export function HeroCardSkeleton() {
  return (
    <div className="relative rounded-2xl overflow-hidden bg-surface" aria-hidden="true">
      <div className="relative h-[280px] sm:h-[340px] md:h-[400px] w-full">
        <Skeleton className="absolute inset-0 rounded-none" />
        <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-6">
          <Skeleton className="h-4 w-20 mb-4" />
          <Skeleton className="h-8 w-full mb-2" />
          <Skeleton className="h-8 w-3/4 mb-4" />
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-2/3 mb-4" />
          <div className="flex items-center gap-4">
            <Skeleton className="h-5 w-5 rounded-full" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ArticleCardSkeleton() {
  return (
    <div className="rounded-xl overflow-hidden bg-surface" aria-hidden="true">
      <Skeleton className="h-[160px] w-full rounded-none" />
      <div className="p-4">
        <Skeleton className="h-3 w-16 mb-2" />
        <Skeleton className="h-5 w-full mb-1" />
        <Skeleton className="h-5 w-4/5 mb-3" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-12" />
        </div>
      </div>
    </div>
  );
}

export function CompactCardSkeleton() {
  return (
    <div className="p-4 rounded-xl bg-surface border-l-4 border-elevated" aria-hidden="true">
      <Skeleton className="h-3 w-16 mb-2" />
      <Skeleton className="h-5 w-full mb-1" />
      <Skeleton className="h-5 w-3/4 mb-3" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-4 w-4 rounded-full" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}

export function CategoryChipSkeleton() {
  return <Skeleton className="h-8 w-20 rounded-full" />;
}

export function FeedPageSkeleton() {
  return (
    <div className="py-6 space-y-8" aria-label="Loading content" role="status" aria-live="polite">
      {/* Hero skeleton */}
      <HeroCardSkeleton />

      {/* Top Stories skeleton */}
      <section>
        <Skeleton className="h-6 w-28 mb-4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <ArticleCardSkeleton key={i} />
          ))}
        </div>
      </section>

      {/* Quick Reads skeleton */}
      <section>
        <Skeleton className="h-6 w-28 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <CompactCardSkeleton key={i} />
          ))}
        </div>
      </section>
    </div>
  );
}

export function InsightsPageSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-[var(--width-wide)] px-[var(--page-gutter)] sm:px-[var(--page-gutter-sm)] py-[var(--page-block)]"
      aria-label="Loading insights"
      role="status"
      aria-live="polite"
    >
      {/* Header */}
      <div className="mb-8">
        <Skeleton className="h-9 w-48 mb-3" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-surface rounded-2xl p-6 border border-outline">
            <Skeleton className="h-8 w-8 rounded-full mx-auto mb-3" />
            <Skeleton className="h-8 w-20 mx-auto mb-2" />
            <Skeleton className="h-4 w-16 mx-auto" />
          </div>
        ))}
      </div>

      {/* Trending grid */}
      <Skeleton className="h-6 w-40 mb-4" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-surface rounded-xl p-4 border border-outline">
            <Skeleton className="h-8 w-8 mb-3" />
            <Skeleton className="h-5 w-24 mb-2" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Same column as the article it stands in for.
 *
 * It was `max-w-3xl` (768px) against the article's 800px, with a 16px gutter
 * against the article's 24px, so every article visibly jumped sideways the
 * moment it loaded. Both now read `--width-reading` and `--page-gutter`, so
 * they cannot disagree.
 */
export function ArticlePageSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-[var(--width-reading)] px-[var(--page-gutter)] sm:px-[var(--page-gutter-sm)] py-[var(--page-block-reading)]"
      role="status"
      aria-live="polite"
      aria-label="Loading article"
    >
      {/* Back link */}
      <Skeleton className="mb-6 h-10 w-24 rounded-full" />

      {/* Category chip — a chip, so `--touch-chip` and pill-shaped. */}
      <Skeleton className="mb-4 h-[var(--touch-chip)] w-24 rounded-full" />

      {/* Headline. Two lines at the real thing's height: the article sets
          text-3xl rising to 2.75rem/1.15 from `md`, so a flat h-10 (40px) was
          short by a third on desktop and the page jumped when it resolved. */}
      <Skeleton className="mb-2 h-9 w-full md:h-[3.15rem]" />
      <Skeleton className="mb-6 h-9 w-4/5 md:h-[3.15rem]" />

      {/* Byline row — avatar, name, date. */}
      <div className="mb-6 flex items-center gap-3">
        <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="mb-1.5 h-4 w-32" />
          <Skeleton className="h-3 w-44" />
        </div>
      </div>

      {/* Hero well, and where the mark sits.
          The spinner goes here rather than above the column because this is
          where the eye already is, and because a loading indicator stacked on
          top would push every bar below it down — so the skeleton would not
          stand in for the article's geometry, which is its whole job. It is
          decorative: this container already announces. */}
      <div className="relative mb-6 aspect-[16/9] w-full overflow-hidden rounded-[var(--radius-card)] bg-elevated">
        <span className="absolute inset-0 flex items-center justify-center">
          <MukokoSpinner size={56} />
        </span>
      </div>

      {/* AI summary card */}
      <div className="mb-8 rounded-[var(--radius-card)] border border-outline bg-card p-4">
        <Skeleton className="mb-3 h-3 w-28" />
        <Skeleton className="mb-2 h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
      </div>

      {/* Body copy. Ragged by design — uniform full-width bars read as a table,
          not as prose. */}
      <div className="mb-8 space-y-3">
        {["w-full", "w-full", "w-5/6", "w-full", "w-11/12", "w-full", "w-2/3"].map((w, i) => (
          <Skeleton key={`line-${i}`} className={`h-4 ${w}`} />
        ))}
      </div>

      {/* "Read the original" CTA — the real one is a hero-sized pill. */}
      <Skeleton className="mb-8 h-[var(--touch-hero)] w-52 rounded-full" />

      {/* Source provenance panel */}
      <div className="rounded-[var(--radius-card)] border border-outline bg-card p-4">
        <Skeleton className="mb-3 h-3 w-36" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      </div>
    </div>
  );
}

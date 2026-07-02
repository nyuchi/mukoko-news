"use client";

import { cn } from "@/lib/utils";

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
      className="max-w-[1200px] mx-auto px-6 py-8"
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
          <div key={i} className="bg-surface rounded-2xl p-6 border border-elevated">
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
          <div key={i} className="bg-surface rounded-xl p-4 border border-elevated">
            <Skeleton className="h-8 w-8 mb-3" />
            <Skeleton className="h-5 w-24 mb-2" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ArticlePageSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8" aria-label="Loading article" role="status" aria-live="polite">
      {/* Back button */}
      <Skeleton className="h-10 w-24 mb-6" />

      {/* Category */}
      <Skeleton className="h-6 w-20 mb-4" />

      {/* Title */}
      <Skeleton className="h-10 w-full mb-2" />
      <Skeleton className="h-10 w-3/4 mb-6" />

      {/* Meta */}
      <div className="flex items-center gap-4 mb-6">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div>
          <Skeleton className="h-4 w-24 mb-1" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>

      {/* Image */}
      <Skeleton className="h-[300px] w-full rounded-xl mb-6" />

      {/* Content */}
      <div className="space-y-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}

"use client";

import { Skeleton, ArticleCardSkeleton } from "./skeleton";

export function DiscoverPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[var(--width-wide)] px-[var(--page-gutter)] sm:px-[var(--page-gutter-sm)] py-[var(--page-block)]" aria-label="Loading content" role="status" aria-live="polite">
      {/* Header skeleton */}
      <div className="mb-10">
        <Skeleton className="h-9 w-40 mb-2" />
        <Skeleton className="h-5 w-96" />
      </div>

      {/* Search bar skeleton */}
      <Skeleton className="h-14 w-full rounded-2xl mb-12" />

      {/* Trending Topics skeleton */}
      <div className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-5 w-20" />
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-full" />
          ))}
        </div>
      </div>

      {/* Countries skeleton */}
      <div className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-5 w-20" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </div>

      {/* Categories skeleton */}
      <div className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-5 w-20" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </div>

      {/* Recent Articles skeleton */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-5 w-20" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <ArticleCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function NewsBytesSkeleton() {
  return (
    <div className="h-screen flex items-center justify-center bg-black" aria-label="Loading content" role="status" aria-live="polite">
      <div className="w-full max-w-[400px] mx-auto">
        <Skeleton className="h-[70vh] w-full rounded-2xl" />
        <div className="flex justify-center gap-4 mt-4">
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-12 w-12 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/** Matches /search, which is `--width-wide`. It was 1000px against the page's 1200px. */
export function SearchPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[var(--width-wide)] px-[var(--page-gutter)] sm:px-[var(--page-gutter-sm)] py-[var(--page-block)]" aria-label="Loading search results" role="status" aria-live="polite">
      {/* Search header skeleton */}
      <Skeleton className="h-14 w-full rounded-2xl mb-8" />

      {/* Results count skeleton */}
      <Skeleton className="h-5 w-48 mb-6" />

      {/* Results skeleton */}
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="p-4 bg-surface rounded-xl">
            <Skeleton className="h-5 w-16 mb-2" />
            <Skeleton className="h-6 w-full mb-2" />
            <Skeleton className="h-6 w-3/4 mb-3" />
            <Skeleton className="h-4 w-full mb-1" />
            <Skeleton className="h-4 w-5/6 mb-3" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

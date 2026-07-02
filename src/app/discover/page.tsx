import { Suspense } from "react";
import DiscoverClient from "./discover-client";
import { getArticlesAction, getCategoriesAction, getSourcesAction } from "@/lib/actions/feed";
import { DiscoverPageSkeleton } from "@/components/ui/discover-skeleton";
import type { Article, Category } from "@/lib/api";

// ISR: the default (unfiltered) Discover view is served as cached HTML;
// filtered views (?category= / ?country=) are fetched client-side as before.
export const revalidate = 300;

export default async function DiscoverPage() {
  let initialArticles: Article[] | null = null;
  let initialCategories: Category[] | null = null;
  let initialSources: Awaited<ReturnType<typeof getSourcesAction>> | null = null;

  // Failures degrade gracefully: null props make the client component fetch on
  // mount and show an explicit error state (with retry) if that also fails.
  const [articlesResult, categoriesResult, sourcesResult] = await Promise.allSettled([
    getArticlesAction({ limit: 50 }),
    getCategoriesAction(),
    getSourcesAction(),
  ]);

  if (articlesResult.status === "fulfilled") {
    initialArticles = articlesResult.value.articles;
  } else {
    console.error("[DiscoverPage] Failed to prefetch articles:", articlesResult.reason);
  }
  if (categoriesResult.status === "fulfilled") {
    initialCategories = categoriesResult.value;
  }
  if (sourcesResult.status === "fulfilled") {
    initialSources = sourcesResult.value;
  }

  return (
    // Suspense keeps the server shell statically renderable even though the
    // client component reads useSearchParams()
    <Suspense fallback={<DiscoverPageSkeleton />}>
      <DiscoverClient
        initialArticles={initialArticles}
        initialCategories={initialCategories}
        initialSources={initialSources}
      />
    </Suspense>
  );
}

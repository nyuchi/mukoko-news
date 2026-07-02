import InsightsClient, { type Stats, type TrendingCategory } from "./insights-client";
import {
  getStatsAction,
  getTrendingCategoriesAction,
  getTrendingAuthorsAction,
} from "@/lib/actions/feed";

// ISR: insights are aggregate stats — 5 minutes of staleness is fine, and the
// cached HTML paints immediately instead of a client-side spinner.
export const revalidate = 300;

export default async function InsightsPage() {
  // Failures degrade gracefully: null props make the client component fetch on
  // mount and show an explicit error state (with retry) if that also fails.
  const [statsResult, trendingResult, authorsResult] = await Promise.allSettled([
    getStatsAction(),
    getTrendingCategoriesAction(8),
    getTrendingAuthorsAction(5),
  ]);

  const initialStats: Stats | null =
    statsResult.status === "fulfilled" ? statsResult.value.database : null;
  const initialTrending: TrendingCategory[] | null =
    trendingResult.status === "fulfilled" ? trendingResult.value : null;
  // Raw payload — normalised in the client (authors can be schema.org objects).
  const initialAuthors: unknown[] | null =
    authorsResult.status === "fulfilled" ? authorsResult.value.trending_authors : null;

  if (statsResult.status === "rejected") {
    console.error("[InsightsPage] Failed to prefetch stats:", statsResult.reason);
  }

  return (
    <InsightsClient
      initialStats={initialStats}
      initialTrending={initialTrending}
      initialAuthors={initialAuthors}
    />
  );
}

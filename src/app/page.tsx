import HomeClient from "./home-client";
import { getSectionedFeedAction, getCategoriesAction, type SectionedFeed } from "@/lib/actions/feed";
import { DEFAULT_FEED_COUNTRIES } from "@/lib/constants";
import type { Category } from "@/lib/api";

// ISR: serve cached HTML with real feed content on first paint; regenerate at
// most every 3 minutes (news staleness budget). Client-side refetch still
// covers users whose stored preferences differ from the defaults.
export const revalidate = 180;

export default async function HomePage() {
  let initialFeed: SectionedFeed | null = null;
  let initialCategories: Category[] | null = null;

  // Fetch failures (or a missing MONGODB_URI at build time) degrade gracefully:
  // the client component falls back to fetching on mount, exactly as before.
  const [feedResult, categoriesResult] = await Promise.allSettled([
    getSectionedFeedAction({ countries: DEFAULT_FEED_COUNTRIES }),
    getCategoriesAction(),
  ]);

  if (feedResult.status === "fulfilled") {
    initialFeed = feedResult.value;
  } else {
    console.error("[HomePage] Failed to prefetch initial feed:", feedResult.reason);
  }
  if (categoriesResult.status === "fulfilled") {
    initialCategories = categoriesResult.value;
  } else {
    console.error("[HomePage] Failed to prefetch categories:", categoriesResult.reason);
  }

  return <HomeClient initialFeed={initialFeed} initialCategories={initialCategories} />;
}

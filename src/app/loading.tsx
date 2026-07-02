import { FeedPageSkeleton } from "@/components/ui/skeleton";

// Route-level loading UI for the home feed (and fallback for child routes
// without their own loading.tsx) — shown while the server page streams.
export default function HomeLoading() {
  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6">
      <FeedPageSkeleton />
    </div>
  );
}

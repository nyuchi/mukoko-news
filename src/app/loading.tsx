import { FeedPageSkeleton } from "@/components/ui/skeleton";

// Route-level loading UI for the home feed (and fallback for child routes
// without their own loading.tsx) — shown while the server page streams.
export default function HomeLoading() {
  return (
    <div className="mx-auto w-full max-w-[var(--width-wide)] px-[var(--page-gutter)] sm:px-[var(--page-gutter-sm)] py-[var(--page-block)]">
      <FeedPageSkeleton />
    </div>
  );
}

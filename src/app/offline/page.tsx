import Link from 'next/link';
import type { Metadata } from 'next';
import { WifiOff, Bookmark, Newspaper } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Offline',
  robots: { index: false, follow: false },
};

// Fully static — this page is precached by the service worker (public/sw.js)
// and served as the last-resort fallback for navigations while offline.
export const dynamic = 'force-static';

export default function OfflinePage() {
  return (
    <div className="max-w-[800px] mx-auto px-6 py-16 text-center">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
        <WifiOff className="h-10 w-10 text-primary" aria-hidden="true" />
      </div>

      <h1 className="mb-2 text-3xl font-bold text-foreground">You&rsquo;re offline</h1>
      <p className="mx-auto mb-10 max-w-md text-text-secondary">
        No connection right now &mdash; previously read articles are still available. Anything you
        opened while online stays readable in the hive.
      </p>

      <div className="mx-auto mb-10 grid max-w-md grid-cols-1 gap-4 text-left sm:grid-cols-2">
        <div className="flex items-start gap-3 rounded-xl bg-surface p-4">
          <Newspaper className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-sm text-text-secondary">
            Articles you opened while online are cached and stay readable.
          </p>
        </div>
        <div className="flex items-start gap-3 rounded-xl bg-surface p-4">
          <Bookmark className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-sm text-text-secondary">
            Fresh stories will load as soon as your connection returns.
          </p>
        </div>
      </div>

      <Link
        href="/"
        className="inline-block rounded-xl bg-primary px-6 py-2.5 font-medium text-on-primary transition-opacity hover:opacity-90"
      >
        Back to the feed
      </Link>
    </div>
  );
}

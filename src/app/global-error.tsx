'use client';

import { useEffect } from 'react';
// global-error replaces the root layout when active, so the global styles
// imported there must be re-imported here for the mineral tokens to apply.
import './globals.css';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[GlobalError]', error);
  }, [error]);

  // global-error must render its own <html> and <body> — it replaces the root layout.
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="w-full max-w-md rounded-card border border-border bg-surface p-8 text-center">
            <h2 className="font-serif text-xl font-semibold text-foreground">
              Something went wrong loading Mukoko News
            </h2>
            <p className="mt-2 text-sm text-text-secondary">
              Please try again — the hive is buzzing back to life.
            </p>
            <button
              type="button"
              onClick={() => reset()}
              // TODO(on-primary): switch to text-on-primary when tokens land
              className="mt-6 rounded-button bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary/90"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}

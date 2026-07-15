'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[RootError]', error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
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
          className="mt-6 rounded-button bg-primary px-6 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

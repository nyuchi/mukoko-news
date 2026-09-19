"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";

/**
 * What a reader sees when they reach the end of an allowance.
 *
 * ## It states what they HAVE HAD, not only what they cannot have
 *
 * This is the one thing that separates a wall from a breakage. A gate a reader
 * has never reached can afford to say "sign in for this" — they lost nothing.
 * An allowance is different: the reader was using the product a second ago and
 * it stopped, so a bare "sign in" reads as the site failing rather than as a
 * boundary they crossed. Naming the fifty articles they already read makes the
 * same sentence an account of a thing that worked, and the ask reasonable.
 *
 * ## It never hides anything that is a secret
 *
 * It cannot: this renders over a payload the server already sent (see the
 * CONVERSION-not-confidentiality note in `@/lib/metering`). So it is styled as
 * what it is — an invitation on top of the page — and never claims the content
 * is unavailable, which would be a false statement about our own response.
 *
 * ## The return trip is the whole conversion
 *
 * `returnTo` is the reader's current path, so signing up puts them back on the
 * article or the search they were mid-way through. A sign-up that lands on the
 * home feed asks someone to find their way back to what they wanted, and most
 * will not.
 */
export function MeterWall({
  title,
  had,
  promise,
  action = "Create a free account",
  returnTo,
}: {
  /** The headline. Short, and about the boundary rather than the failure. */
  title: string;
  /** What the reader has already had — the sentence that makes this fair. */
  had: string;
  /** What an account changes. Specific and checkable, never "more features". */
  promise: string;
  action?: string;
  /** Override the return path. Defaults to where the reader currently is. */
  returnTo?: string;
}) {
  const pathname = usePathname();
  const target = returnTo ?? pathname ?? "/";
  const signIn = `/sign-in?returnTo=${encodeURIComponent(target)}`;

  return (
    <section
      aria-labelledby="meter-wall-heading"
      className="rounded-2xl border border-outline bg-container-tanzanite p-6 text-on-container-tanzanite"
    >
      <h2
        id="meter-wall-heading"
        className="flex items-center gap-2 text-lg font-bold"
      >
        <Lock className="h-5 w-5" aria-hidden="true" />
        {title}
      </h2>
      <p className="mt-2 text-sm opacity-90">{had}</p>
      <p className="mt-1 text-sm opacity-90">{promise}</p>
      <Link
        href={signIn}
        className="mt-5 inline-flex min-h-[var(--density-touch)] items-center justify-center rounded-[var(--radius-button,12px)] bg-primary px-6 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-container-tanzanite"
      >
        {action}
      </Link>
      <p className="mt-3 text-xs opacity-80">
        Free, and you&apos;ll come straight back to this page.
      </p>
    </section>
  );
}

"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { AppIcon } from "@/components/ui/app-icon";
import { useLegal } from "@/contexts/legal-context";
import { AGGREGATOR_STATEMENT, LEGAL_LAST_UPDATED } from "@/lib/legal";
import { hidesAppChrome } from "@/lib/navigation";

/**
 * Routes the gate never covers.
 *
 * `/terms` and `/privacy` are the load-bearing pair: the gate asks a reader to
 * accept two documents, so covering the documents would leave them agreeing to
 * text they were physically prevented from reading. That is not a nicety — a
 * consent screen you cannot read past is not consent.
 *
 * `/embed/*` is our markup inside somebody else's page. A modal demanding that
 * a weather site's visitors accept OUR terms, over THEIR content, is somewhere
 * between rude and broken; the embed links out to us, and the gate meets them
 * when they arrive.
 *
 * `/offline` is the service worker's fallback — there is nothing behind it to
 * gate, and no network to reach the terms with.
 */
function isExempt(pathname: string): boolean {
  return (
    pathname === "/terms" ||
    pathname === "/privacy" ||
    pathname === "/offline" ||
    pathname === "/embed" ||
    pathname.startsWith("/embed/") ||
    hidesAppChrome(pathname)
  );
}

/**
 * The first-run welcome: what Mukoko is, and the terms, before anything else.
 *
 * ## It is a client overlay, not a server gate, and that is the whole design
 *
 * The page underneath is rendered and delivered normally. Nothing about the
 * response changes, no route becomes dynamic, and every prerendered and
 * ISR-cached surface stays exactly as cacheable as it was. The gate is added
 * over the top in the browser, after an effect has read storage.
 *
 * That ordering is not a shortcut, it is the requirement. `robots.txt` here
 * deliberately courts search engines and answer engines, and for an aggregator
 * that indexed traffic IS the asset — a gate rendered server-side would serve
 * every crawler a consent dialog in place of the article and quietly delete the
 * product from search. It also means a reader on a slow connection sees the
 * news first and the dialog a moment later, rather than a blank page holding a
 * modal.
 *
 * ## What it asks, and what it stores
 *
 * One decision, one button. Declining is not a button because declining means
 * not using the service, and a "Decline" that navigates a reader off a news
 * site they chose to open is theatre. The Terms say the same thing in words:
 * *"If you do not agree, please do not use the service."*
 *
 * What is stored is `LEGAL_VERSION`, not `true` — see `@/lib/legal` for why a
 * boolean cannot support ever changing the terms again.
 */
export function WelcomeGate() {
  const { resolved, accepted, accept } = useLegal();
  const pathname = usePathname() ?? "/";
  const panelRef = useRef<HTMLDivElement>(null);
  const exempt = isExempt(pathname);
  const open = resolved && !accepted && !exempt;

  // Scroll lock. Without it the page scrolls behind the dialog on every phone,
  // which reads as the gate being decorative.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Focus trap. Deliberately no Escape handler: Escape closes a dialog you may
  // dismiss, and this is not one — wiring it would hand every reader a
  // one-key bypass and make the whole screen a suggestion.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusables = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

    focusables()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    panel.ownerDocument.addEventListener("keydown", onKeyDown);
    return () => panel.ownerDocument.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-[var(--scrim)] p-0 sm:items-center sm:p-4"
      // The scrim is not a dismiss target. A tap-to-close backdrop on a consent
      // screen is a bypass that looks like a mistake.
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-gate-title"
        aria-describedby="welcome-gate-body"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-raised p-6 shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-center gap-3">
          <AppIcon size={36} />
          <div>
            <p className="font-serif text-lg font-semibold lowercase leading-none text-foreground">
              mukoko
            </p>
            <p className="mt-1 text-xs text-text-tertiary">
              Pan-African news, in one place
            </p>
          </div>
        </div>

        <h2
          id="welcome-gate-title"
          className="mt-5 text-xl font-bold text-foreground"
        >
          Before you start reading
        </h2>

        <div
          id="welcome-gate-body"
          className="mt-3 space-y-3 leading-relaxed text-text-secondary"
        >
          {/* The position leads, because it is the thing readers most often get
              wrong about a service like this — and because every term that
              follows is a consequence of it. */}
          <p>{AGGREGATOR_STATEMENT}</p>
          <p>
            We show you the headline, a short extract and a link. Reading the
            article in full means going to the newsroom that wrote it, and
            photographs stay credited to whoever supplied them.
          </p>
          <p>
            To use Mukoko News you need to agree to our{" "}
            <Link href="/terms" className="font-medium text-primary underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link
              href="/privacy"
              className="font-medium text-primary underline"
            >
              Privacy Policy
            </Link>
            . Both are short, both are in plain language, and you can read them
            now — this screen will be waiting when you come back.
          </p>
        </div>

        <button
          type="button"
          onClick={accept}
          className="mt-6 min-h-[var(--density-touch)] w-full rounded-xl bg-primary px-6 font-medium text-on-primary transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          I agree — start reading
        </button>

        <p className="mt-3 text-center text-xs text-text-tertiary">
          Version of {LEGAL_LAST_UPDATED}. We&rsquo;ll ask again only if these
          change materially.
        </p>
      </div>
    </div>
  );
}

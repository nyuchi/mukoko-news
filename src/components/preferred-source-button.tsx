"use client";

import { useCallback, useRef, useState } from "react";
import { Star } from "lucide-react";
import { BASE_URL } from "@/lib/constants";

/**
 * Google "Preferred Sources" control.
 *
 * Google ships two integrations: a drop-in script that renders Google's own
 * button (`https://news.google.com/swg/js/v1/publisher.js` +
 * `<div google-add-preferred-source-btn>`), and an ES-module API
 * (`publisher.mjs` → `preferredSource.init()` / `.addPreferredSource()`) for
 * publishers who want their own design. Both ship the SAME bundle — measured
 * 2026-09-10: publisher.js is 38,455 bytes on the wire (Brotli) / 138,068
 * uncompressed, publisher.mjs 38,370 / 137,787. Google's own button also pulls
 * a 1,478-byte logo from gstatic. So choosing the "advanced" route costs
 * nothing extra in bytes; it only buys design control.
 *
 * What it does NOT cost is what drives this implementation. Mukoko's readers
 * buy data by the bundle. ~40 KB of third-party JavaScript on every page, for a
 * control almost nobody will press, is a real charge against a real budget. So
 * nothing is loaded up front:
 *
 *   - The rendered baseline is a plain anchor to Google's no-JS deeplink
 *     (https://www.google.com/preferences/source?q=<domain>). Zero bytes, works
 *     with JavaScript disabled, works if Google's CDN is unreachable, works
 *     behind a blocker.
 *   - The module is fetched only on genuine intent — pointer-enter, focus, or
 *     touch-start on this one control — and only once per page.
 *   - A click is intercepted ONLY if the module has finished loading and the
 *     API is actually present. Otherwise the anchor navigates as normal. There
 *     is no state in which pressing this does nothing.
 *
 * Honesty constraint: being chosen as a preferred source is a PERSONALISED
 * signal. It changes what the reader who opted in sees in Top Stories, AI Mode
 * and AI Overviews. It is not a ranking boost, and it does not affect anyone
 * else's results. The copy must never imply otherwise.
 */

const MODULE_URL = "https://news.google.com/swg/js/v1/publisher.mjs";

/** Domain-or-subdomain only — Google does not accept a subdirectory. */
function preferredSourceDomain(): string {
  try {
    return new URL(BASE_URL).hostname;
  } catch {
    return "news.mukoko.com";
  }
}

type PreferredSourceApi = {
  init?: (opts: { theme?: "light" | "dark"; lang?: string }) => void;
  addPreferredSource: () => void;
};

export function PreferredSourceButton({ className = "" }: { className?: string }) {
  const domain = preferredSourceDomain();
  const deeplink = `https://www.google.com/preferences/source?q=${encodeURIComponent(domain)}`;
  const apiRef = useRef<PreferredSourceApi | null>(null);
  const loadingRef = useRef(false);
  const [ready, setReady] = useState(false);

  // Fetch Google's module on intent, never on mount. Failure is silent by
  // design: the anchor href is the fallback, so a blocked or broken CDN just
  // means the reader gets the deeplink instead of the in-page flow.
  const warm = useCallback(() => {
    if (loadingRef.current || apiRef.current) return;
    loadingRef.current = true;
    import(/* webpackIgnore: true */ MODULE_URL)
      .then((mod: { preferredSource?: PreferredSourceApi }) => {
        const api = mod?.preferredSource;
        if (!api || typeof api.addPreferredSource !== "function") return;
        try {
          const dark = document.documentElement.classList.contains("dark");
          api.init?.({ theme: dark ? "dark" : "light", lang: "en" });
        } catch {
          /* init is optional; the trigger still works without it */
        }
        apiRef.current = api;
        setReady(true);
      })
      .catch(() => {
        /* deliberately silent — the deeplink still works */
      });
  }, []);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      // Never swallow a modified click: the reader asked for a new tab.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const api = apiRef.current;
      if (!api) return; // not loaded → let the href navigate
      try {
        api.addPreferredSource();
        e.preventDefault();
      } catch {
        /* fall through to the href */
      }
    },
    []
  );

  return (
    <a
      href={deeplink}
      target="_blank"
      rel="noopener noreferrer"
      onPointerEnter={warm}
      onTouchStart={warm}
      onFocus={warm}
      onClick={onClick}
      data-preferred-source-ready={ready ? "true" : "false"}
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 text-on-primary font-medium transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background min-h-[var(--density-touch,47px)] ${className}`}
    >
      <Star className="w-5 h-5" aria-hidden="true" />
      Choose Mukoko News in Google
    </a>
  );
}

/**
 * The full block: control plus the explanation of what the reader is actually
 * agreeing to. Kept together so the claim and the button cannot drift apart.
 */
export function PreferredSourceCard() {
  return (
    <section
      aria-labelledby="preferred-source-heading"
      className="p-5 bg-surface rounded-xl"
    >
      <h2 id="preferred-source-heading" className="font-semibold text-foreground mb-2">
        See more of our reporting in Google
      </h2>
      <p className="text-sm text-text-secondary leading-relaxed mb-4">
        Google lets you name the publications you want to hear from. Choose Mukoko
        News and your own Top Stories, AI Mode and AI Overviews will show more of
        what we publish. It changes what <em>you</em> see — nobody else&rsquo;s
        results move, and you can undo it in Google at any time.
      </p>
      <PreferredSourceButton />
    </section>
  );
}

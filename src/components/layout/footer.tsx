"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { AppIcon } from "@/components/ui/app-icon";
import { SUPPORT_URL } from "@/lib/constants";
import { hidesAppChrome, isImmersive, pick } from "@/lib/navigation";

/**
 * The footer's own short list: the pages a reader looks for at the foot of a
 * page specifically, which is not the same set as "everywhere they can go".
 * Named by href so `pick()` throws if one is renamed.
 */
const FOOTER_HREFS = ["/about", "/help", "/terms", "/privacy"] as const;

// Mukoko News configuration
const APP_CONFIG = {
  name: "mukoko news",
  tagline: "Pan-African Digital News",
  mukokoUrl: "https://mukoko.com",
  copyrightHolder: "Nyuchi Africa",
};

/**
 * The footer: brand, legal, attribution.
 *
 * It briefly carried the app's **full site map** — sixteen destinations in a
 * five-column grid. That fixed a real problem (no surface could reach every
 * page) in the wrong place: at the foot of the page it is a long scroll from
 * wherever the reader is, it collapsed to two columns of sixteen links on a
 * phone, and reaching it meant scrolling past the content you were reading.
 *
 * The map now lives in the navigation drawer (`nav-sidebar.tsx`), one tap from
 * the header on every route. What is left here is what a footer is actually
 * for: who made this, the legal pages, and the theme control.
 *
 * The four links below are a deliberate short list, not a subset that will
 * drift — they come from the same registry through `pick()`, which throws on
 * an unknown href.
 */
export function Footer() {
  const pathname = usePathname();

  // Hidden on the immersive feed and inside the embed iframe — the two places
  // where a page-foot block of links is not part of the design. Every other
  // route gets it, and the bottom nav pill is on all of them regardless, so
  // hiding the footer here never leaves a reader without a way out.
  if (hidesAppChrome(pathname) || isImmersive(pathname)) {
    return null;
  }

  return (
    <footer className="mt-20 border-t border-elevated py-12">
      <div className="mx-auto w-full max-w-[var(--width-wide)] px-[var(--page-gutter)] sm:px-[var(--page-gutter-sm)]">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          <div className="flex items-center gap-3">
            <AppIcon size={28} className="shadow-sm" />
            <span className="text-xl font-bold text-primary">{APP_CONFIG.name}</span>
            <span className="hidden font-serif text-sm italic text-text-secondary sm:inline">
              &ldquo;{APP_CONFIG.tagline}&rdquo;
            </span>
          </div>

          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            {pick(...FOOTER_HREFS).map((d) => (
              <Link
                key={d.href}
                href={d.href}
                className="text-sm text-text-secondary transition-colors hover:text-foreground"
                aria-current={pathname === d.href ? "page" : undefined}
              >
                {d.label}
              </Link>
            ))}
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-text-secondary transition-colors hover:text-foreground"
            >
              Support
            </a>
          </nav>

          <div className="flex items-center gap-4 whitespace-nowrap text-xs text-text-tertiary">
            <ThemeToggle />
            <span>
              A{" "}
              <Link
                href={APP_CONFIG.mukokoUrl}
                className="font-medium text-secondary hover:underline"
              >
                Mukoko
              </Link>{" "}
              Product
            </span>
            <span>
              © {new Date().getFullYear()} {APP_CONFIG.copyrightHolder}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

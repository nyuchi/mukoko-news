"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { AppIcon } from "@/components/ui/app-icon";
import { SUPPORT_URL } from "@/lib/constants";
import {
  DESTINATIONS,
  NAV_GROUPS,
  hidesAppChrome,
  isImmersive,
} from "@/lib/navigation";

// Mukoko News configuration
const APP_CONFIG = {
  name: "mukoko news",
  tagline: "Pan-African Digital News",
  mukokoUrl: "https://mukoko.com",
  copyrightHolder: "Nyuchi Africa",
};

/**
 * The footer, and the app's full site map.
 *
 * It used to carry five links — About, Help, Support, Terms, Privacy — none of
 * which is a reading surface. Combined with a header dropdown that omitted five
 * pages and a five-slot bottom bar, that left the app with **no surface at all**
 * that could take a reader to every page it has. The footer is the natural home
 * for that: it is the one piece of chrome with room for the whole list, and it
 * is where a reader who has run out of ideas looks.
 *
 * The groups come from `@/lib/navigation`, which every navigating surface now
 * reads, so a new page appears here without anyone remembering to add it.
 *
 * Support is the one entry that is not a route: it is an Intercom-hosted site,
 * so it gets the new-tab + `noopener` treatment rather than a client-side
 * transition.
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
        {/* Site map */}
        <nav
          aria-label="All pages"
          className="grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-3 lg:grid-cols-5"
        >
          {NAV_GROUPS.map((group) => (
            <div key={group.id}>
              <h2 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
                {group.label}
              </h2>
              <ul className="space-y-2">
                {DESTINATIONS.filter((d) => d.group === group.id).map((d) => (
                  <li key={d.href}>
                    <Link
                      href={d.href}
                      className="text-sm text-text-secondary transition-colors hover:text-foreground"
                      aria-current={pathname === d.href ? "page" : undefined}
                    >
                      {d.label}
                    </Link>
                  </li>
                ))}
                {group.id === "about" && (
                  <li>
                    <a
                      href={SUPPORT_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-text-secondary transition-colors hover:text-foreground"
                    >
                      Support
                    </a>
                  </li>
                )}
              </ul>
            </div>
          ))}
        </nav>

        {/* Brand + attribution */}
        <div className="mt-12 flex flex-col items-center justify-between gap-6 border-t border-elevated pt-8 md:flex-row">
          <div className="flex items-center gap-3">
            <AppIcon size={28} className="shadow-sm" />
            <span className="text-xl font-bold text-primary">{APP_CONFIG.name}</span>
            <span className="hidden font-serif text-sm italic text-text-secondary sm:inline">
              &ldquo;{APP_CONFIG.tagline}&rdquo;
            </span>
          </div>

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

"use client";

import { useState, useEffect, useSyncExternalStore, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PanelLeft, PanelLeftClose, RotateCw, Search, Zap } from "lucide-react";
import { UserAvatar } from "./user-avatar";
import { DateTimeWeather } from "./datetime-weather";
import { AppIcon } from "@/components/ui/app-icon";
import { useSidebar } from "@/contexts/sidebar-context";
import { hidesAppChrome } from "@/lib/navigation";

const navLinks = [
  { href: "/", label: "Feed" },
  { href: "/discover", label: "Discover" },
  { href: "/newsbytes", label: "NewsBytes" },
];

// Static page titles mapping
const pageTitles: Record<string, string> = {
  "/": "Feed",
  "/discover": "Discover",
  "/newsbytes": "NewsBytes",
  "/categories": "Categories",
  "/insights": "Open Data & Insights",
  "/analytics": "Analytics",
  "/search": "Search",
  "/saved": "Saved Articles",
  "/profile": "Profile",
  "/about": "About",
  "/help": "Help Center",
  "/terms": "Terms of Service",
  "/privacy": "Privacy Policy",
};

// Create a subscription for H1 element changes
function createH1Subscription(pathname: string) {
  return function subscribeToH1(callback: () => void) {
    // Check static title first - no subscription needed
    if (pageTitles[pathname]) {
      return () => {};
    }

    // For dynamic pages, observe DOM changes
    const observer = new MutationObserver(callback);
    observer.observe(document.body, { childList: true, subtree: true });

    // Also trigger after a delay for initial render
    const timer = setTimeout(callback, 100);

    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  };
}

function getPageTitleSnapshot(pathname: string): string | null {
  // Check static mapping first
  const staticTitle = pageTitles[pathname];
  if (staticTitle) return staticTitle;

  // For dynamic pages, get from H1
  if (typeof window === "undefined") return null;
  const h1 = document.querySelector("h1");
  return h1?.textContent || null;
}

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [isScrolled, setIsScrolled] = useState(false);
  const { open: isSidebarOpen, isDocked, toggle: toggleSidebar } = useSidebar();
  // The docked sidebar carries the masthead itself, so the header repeating
  // it puts the same wordmark on screen twice, at two different heights.
  const sidebarOwnsBrand = isSidebarOpen && isDocked;
  const isNewsBytes = pathname === "/newsbytes";
  // Our markup inside somebody else's page has no sidebar to toggle.
  const showSidebarToggle = !hidesAppChrome(pathname);
  // The date/time + weather strip is masthead furniture for the reading
  // surfaces. It is suppressed on the two chrome-less routes: NewsBytes is a
  // full-bleed immersive reader whose header is a gradient scrim, and the
  // embed iframe is a widget rendered inside somebody else's page — neither
  // should carry our masthead, and the embed must not make a cross-origin
  // weather call on a host that never asked for one.
  const showDateTimeWeather = !isNewsBytes && !pathname.startsWith("/embed");

  // The scrolled title is a REFRESH control now, not a menu. It used to be
  // both — one tap opened a page list, a second tap refreshed — which meant
  // the same button did two unrelated things depending on hidden state. The
  // page list moved to the drawer, so this does the one job its tooltip
  // always claimed.
  const handleTitleClick = () => {
    router.refresh();
  };

  // Memoize the subscription function based on pathname
  const subscribeToH1 = useMemo(() => createH1Subscription(pathname), [pathname]);

  // Get page title snapshot
  const getSnapshot = useMemo(() => () => getPageTitleSnapshot(pathname), [pathname]);

  // Use useSyncExternalStore for page title - React 19 compliant
  const pageTitle = useSyncExternalStore(
    subscribeToH1,
    getSnapshot,
    () => pageTitles[pathname] || null // Server snapshot
  );

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      data-app-header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        isNewsBytes
          ? "bg-gradient-to-b from-black/60 via-black/30 to-transparent"
          : isScrolled
            ? "bg-background/70 backdrop-blur-xl border-b border-elevated/50 shadow-sm"
            : ""
      }`}
    >
      {/* The header's column comes from the same `--width-wide` /
          `--page-gutter` tokens as the content beneath it. It previously used
          `px-4 sm:px-6` while most page bodies used a flat `px-6`, so below the
          `sm` breakpoint the header sat 8px wider than the article under it and
          the page visibly stepped in at the shoulder. NewsBytes is full-bleed
          by design and opts out of the max-width only. */}
      {/* Two bands, not one. The toggle belongs to the SHELL's left edge —
          hard against the sidebar it opens — while the masthead belongs to the
          centred reading column. They used to be a single centred container,
          which put ~580px of empty header between the docked sidebar and the
          control that closes it ("this versus this is too far apart", owner
          review 2026-09-11). */}
      <div className="flex w-full items-center gap-1 pl-[var(--page-gutter)] sm:gap-2 sm:pl-[var(--page-gutter-sm)]">
        {/* The sidebar toggle owns the FAR LEFT of the header.
            ------------------------------------------------------------------
            It briefly lived in the actions pill on the right, grouped with
            search and the account control. That was wrong twice over: the
            left edge is where every desktop app puts this control, and — once
            the sidebar docks and the page insets — it is the edge the sidebar
            itself occupies, so the toggle sits directly against the thing it
            toggles.

            The icon is `PanelLeft`, the standard sidebar glyph, not the
            hamburger it was. A hamburger promises a menu that drops down and
            goes away; this reveals a column that stays. `PanelLeftClose` when
            open, so the icon states what the next tap does rather than what
            is currently true. */}
        {showSidebarToggle && (
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
            aria-expanded={isSidebarOpen}
            aria-controls="nav-sidebar"
            title={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
            className={`mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors sm:mr-2 sm:h-11 sm:w-11 ${
              isNewsBytes
                ? "text-white hover:bg-white/20"
                : "text-text-secondary hover:bg-elevated hover:text-foreground"
            }`}
          >
            {isSidebarOpen ? (
              <PanelLeftClose className="h-5 w-5" aria-hidden="true" />
            ) : (
              <PanelLeft className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        )}

        <div
          className={`flex min-w-0 flex-1 items-center justify-between py-3 pr-[var(--page-gutter)] sm:py-4 sm:pr-[var(--page-gutter-sm)] ${
            isNewsBytes ? "" : "mx-auto max-w-[var(--width-wide)]"
          }`}
        >
        {/* The masthead, and the scrolled page title it cross-fades with.
            ------------------------------------------------------------------
            A one-cell GRID, not a `relative` box with two `absolute` children.
            Both layers sit in `col-start-1 row-start-1`, so they still stack
            and cross-fade in place — but the container now has the WIDTH of
            the wider of them instead of zero.

            Zero width is what centred the wordmark. Absolutely positioned
            children contribute nothing to their parent's size, so this was a
            0px flex item between the toggle and the actions pill; with
            `justify-between` distributing the free space, a zero-width middle
            item lands in the MIDDLE of the header, and the wordmark — which
            overflowed it — ran out from there and straight under the pill.
            Owner report 2026-09-11: "the wordmark needs to be left not
            centered". In flow it is the first item in the row, so it starts at
            the left edge and the pill can no longer sit on top of it.

            `min-w-0` + `truncate` is the other half: with a real width the
            lockup now takes part in shrinking, so a narrow phone ellipsises
            the wordmark rather than pushing the pill off the header. */}
        <div className="grid min-h-8 min-w-0 shrink items-center justify-items-start">
          {/* Logo - visible when not scrolled */}
          {/* Hidden while the sidebar is docked open: it carries the masthead
              there, and two "mukoko news" lockups on one screen at two
              different heights is what owner review called the heading being
              "out of context across the whole". */}
          <Link
            href="/"
            className={`col-start-1 row-start-1 flex min-w-0 items-center gap-2 transition-opacity duration-300 ${
              sidebarOwnsBrand || (isScrolled && pageTitle)
                ? "opacity-0 pointer-events-none"
                : "opacity-100"
            }`}
            aria-hidden={sidebarOwnsBrand || undefined}
            tabIndex={sidebarOwnsBrand ? -1 : undefined}
          >
            <AppIcon size={32} />
            <span
              className={`truncate font-serif font-semibold lowercase text-[16px] sm:text-[20px] ${
                isNewsBytes ? "text-white" : "text-primary"
              }`}
            >
              mukoko news
            </span>
          </Link>

          {/* Page title dropdown - visible when scrolled */}
          {pageTitle && (
            <div
              className={`col-start-1 row-start-1 min-w-0 transition-opacity duration-300 ${
                isScrolled ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            >
              <button
                onClick={handleTitleClick}
                className={`flex min-w-0 items-center gap-2 transition-colors ${
                  isNewsBytes ? "text-white" : "text-primary hover:text-primary/80"
                }`}
                title="Refresh this page"
                aria-label={`Refresh ${pageTitle}`}
              >
                <AppIcon size={32} />
                <span className="font-serif font-semibold lowercase text-[16px] sm:text-[20px] truncate max-w-[100px] sm:max-w-[160px]">
                  {pageTitle.toLowerCase()}
                </span>
                <RotateCw className="w-4 h-4 shrink-0" aria-hidden="true" />
              </button>

            </div>
          )}
        </div>

        {/* Nav Links */}
        <nav aria-label="Primary" className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm font-medium transition-colors ${
                pathname === link.href
                  ? "text-primary"
                  : "text-text-secondary hover:text-foreground"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Actions - pill-shaped icon group with touch targets */}
        <div className={`flex items-center rounded-full p-0.5 sm:p-1 gap-0.5 sm:gap-1 flex-shrink-0 ${
          isNewsBytes ? "bg-black/40 backdrop-blur-md" : "bg-primary"
        }`}>
          <Link
            href="/search"
            className={`flex items-center justify-center w-9 h-9 sm:w-11 sm:h-11 rounded-full transition-colors ${
              isNewsBytes
                ? "bg-white/10 hover:bg-white/20"
                : "bg-background/10 hover:bg-background/20"
            }`}
            aria-label="Search"
          >
            <Search className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </Link>
          <Link
            href="/newsbytes"
            className={`flex items-center justify-center w-9 h-9 sm:w-11 sm:h-11 rounded-full transition-colors ${
              isNewsBytes
                ? "bg-white/20 hover:bg-white/30"
                : "bg-background/10 hover:bg-background/20"
            }`}
            aria-label="NewsBytes"
          >
            <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </Link>
          <UserAvatar onDark={isNewsBytes} />
          </div>
        </div>
      </div>

      {/* Masthead strip: the reader's local date/time and current conditions.
          A second row of the SAME sticky header, so it travels with the
          chrome and is measured by the existing [data-app-header] observer in
          home-client.tsx rather than needing its own offset. Its height is
          reserved by the strip itself (min-h + an invisible clock
          placeholder), so it cannot shift the page once the data lands. */}
      {showDateTimeWeather && (
        <div className="mx-auto w-full max-w-[var(--width-wide)] px-[var(--page-gutter)] pb-2 sm:px-[var(--page-gutter-sm)] sm:pb-3">
          <DateTimeWeather />
        </div>
      )}

    </header>
  );
}

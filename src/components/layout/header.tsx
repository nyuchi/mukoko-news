"use client";

import { useState, useEffect, useSyncExternalStore, useMemo, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, RotateCw, Search, Zap } from "lucide-react";
import { UserAvatar } from "./user-avatar";
import { DateTimeWeather } from "./datetime-weather";
import { NavSidebar } from "./nav-sidebar";
import { AppIcon } from "@/components/ui/app-icon";

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
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const isNewsBytes = pathname === "/newsbytes";
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
      <div
        className={`mx-auto flex w-full items-center justify-between px-[var(--page-gutter)] py-3 sm:px-[var(--page-gutter-sm)] sm:py-4 ${
          isNewsBytes ? "" : "max-w-[var(--width-wide)]"
        }`}
      >
        {/* Logo / Page Title with Dropdown - fixed height container */}
        <div className="min-w-0 flex-shrink relative h-8">
          {/* Logo - visible when not scrolled */}
          <Link
            href="/"
            className={`absolute top-1/2 -translate-y-1/2 left-0 flex items-center gap-2 transition-all duration-300 ${
              isScrolled && pageTitle ? "opacity-0 pointer-events-none" : "opacity-100"
            }`}
          >
            <AppIcon size={32} />
            <span
              className={`font-serif font-semibold lowercase text-[16px] sm:text-[20px] whitespace-nowrap ${
                isNewsBytes ? "text-white" : "text-primary"
              }`}
            >
              mukoko news
            </span>
          </Link>

          {/* Page title dropdown - visible when scrolled */}
          {pageTitle && (
            <div
              className={`absolute top-1/2 -translate-y-1/2 left-0 transition-all duration-300 ${
                isScrolled ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            >
              <button
                onClick={handleTitleClick}
                className={`flex items-center gap-2 transition-colors ${
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
          {/* Opens the full navigation drawer. It sits in the actions pill
              rather than at the far left because that is the edge a thumb
              already reaches for on this header — search, bytes and the
              account control are all here. */}
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setIsMenuOpen(true)}
            aria-label="Open menu"
            aria-haspopup="dialog"
            aria-expanded={isMenuOpen}
            className={`flex items-center justify-center w-9 h-9 sm:w-11 sm:h-11 rounded-full transition-colors ${
              isNewsBytes
                ? "bg-white/10 hover:bg-white/20"
                : "bg-background/10 hover:bg-background/20"
            }`}
          >
            <Menu className="w-4 h-4 sm:w-5 sm:h-5 text-white" aria-hidden="true" />
          </button>
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

      <NavSidebar
        open={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        returnFocusRef={menuButtonRef}
      />
    </header>
  );
}

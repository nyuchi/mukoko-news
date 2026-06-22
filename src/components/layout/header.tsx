"use client";

import { useState, useEffect, useSyncExternalStore, useMemo, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search, Zap, User, ChevronDown, Compass, Bookmark, BarChart3, HelpCircle, Settings } from "lucide-react";
import { AppIcon } from "@/components/ui/app-icon";

const navLinks = [
  { href: "/", label: "Feed" },
  { href: "/discover", label: "Discover" },
  { href: "/newsbytes", label: "NewsBytes" },
];

// All navigable pages for the dropdown
const allPages = [
  { href: "/", label: "Feed", icon: Zap },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/newsbytes", label: "NewsBytes", icon: Zap },
  { href: "/categories", label: "Categories", icon: BarChart3 },
  { href: "/insights", label: "Insights", icon: BarChart3 },
  { href: "/saved", label: "Saved", icon: Bookmark },
  { href: "/search", label: "Search", icon: Search },
  { href: "/profile", label: "Profile", icon: Settings },
  { href: "/help", label: "Help", icon: HelpCircle },
];

// Static page titles mapping
const pageTitles: Record<string, string> = {
  "/": "Feed",
  "/discover": "Discover",
  "/newsbytes": "NewsBytes",
  "/categories": "Categories",
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
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isNewsBytes = pathname === "/newsbytes";

  // Handle title button click - toggle dropdown or refresh if already open
  const handleTitleClick = () => {
    if (isDropdownOpen) {
      // If dropdown is open, close it and force refresh current page
      setIsDropdownOpen(false);
      router.refresh();
    } else {
      setIsDropdownOpen(true);
    }
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

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isDropdownOpen]);

  // Close dropdown on route change
  useEffect(() => {
    setIsDropdownOpen(false);
  }, [pathname]);

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
      <div className={`mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between ${
        isNewsBytes ? "" : "max-w-[1200px]"
      }`}>
        {/* Logo / Page Title with Dropdown - fixed height container */}
        <div className="min-w-0 flex-shrink relative h-8" ref={dropdownRef}>
          {/* Logo - visible when not scrolled */}
          <Link
            href="/"
            className={`absolute top-1/2 -translate-y-1/2 left-0 flex items-center gap-2 transition-all duration-300 ${
              isScrolled && pageTitle ? "opacity-0 pointer-events-none" : "opacity-100"
            }`}
          >
            <AppIcon size={32} className="shadow-sm" />
            <span
              className={`text-[16px] sm:text-[20px] font-bold whitespace-nowrap ${
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
                aria-expanded={isDropdownOpen}
                aria-haspopup="true"
                title={isDropdownOpen ? "Refresh page" : "Navigate to page"}
              >
                <AppIcon size={32} className="shadow-sm" />
                <span className="text-[16px] sm:text-[20px] font-bold truncate max-w-[100px] sm:max-w-[160px]">
                  {pageTitle.toLowerCase()}
                </span>
                <ChevronDown
                  className={`w-4 h-4 transition-transform duration-200 shrink-0 ${
                    isDropdownOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {/* Dropdown Menu */}
              {isDropdownOpen && (
                <div
                  className={`absolute top-full left-0 mt-2 w-56 rounded-xl shadow-lg border overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 ${
                    isNewsBytes
                      ? "bg-black/90 backdrop-blur-xl border-white/10"
                      : "bg-surface border-elevated"
                  }`}
                >
                  <nav className="py-2">
                    {allPages.map((page) => {
                      const Icon = page.icon;
                      const isActive = pathname === page.href;
                      return (
                        <Link
                          key={page.href}
                          href={page.href}
                          className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
                            isNewsBytes
                              ? isActive
                                ? "bg-white/20 text-white"
                                : "text-white/80 hover:bg-white/10 hover:text-white"
                              : isActive
                                ? "bg-primary/10 text-primary"
                                : "text-foreground hover:bg-elevated"
                          }`}
                          onClick={() => setIsDropdownOpen(false)}
                        >
                          <Icon className="w-4 h-4" />
                          <span className="font-medium">{page.label}</span>
                          {isActive && (
                            <span className={`ml-auto w-1.5 h-1.5 rounded-full ${
                              isNewsBytes ? "bg-white" : "bg-primary"
                            }`} />
                          )}
                        </Link>
                      );
                    })}
                  </nav>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Nav Links */}
        <nav className="hidden md:flex items-center gap-8">
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
          <Link
            href="/profile"
            className={`flex items-center justify-center w-9 h-9 sm:w-11 sm:h-11 rounded-full transition-colors overflow-hidden ${
              isNewsBytes
                ? "bg-white/10 hover:bg-white/20"
                : "bg-background/20 hover:bg-background/30"
            }`}
            aria-label="Profile"
          >
            <User className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </Link>
        </div>
      </div>
    </header>
  );
}

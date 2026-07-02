"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Compass, Zap, Bookmark, User } from "lucide-react";

const navItems = [
  { href: "/", label: "Feed", icon: Home },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/newsbytes", label: "Bytes", icon: Zap },
  { href: "/saved", label: "Saved", icon: Bookmark },
  { href: "/profile", label: "Profile", icon: User },
];

export function BottomNav() {
  const pathname = usePathname();

  // Hide on NewsBytes (fullscreen experience), article pages, and embed iframe
  // Regex anchored with $ to match exactly /article/{id}, not sub-routes like /article/{id}/comments
  if (pathname === "/newsbytes" || pathname === "/embed/iframe" || /^\/article\/[^/]+$/.test(pathname)) {
    return null;
  }

  return (
    // Floating pill, lifted clear of the iOS/Android home-indicator swipe zone
    // via env(safe-area-inset-bottom) (requires viewport-fit=cover, set in
    // layout.tsx). 16px radius per the card doctrine.
    <nav
      className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)_+_0.75rem)] left-4 right-4 z-50 md:hidden mx-auto max-w-md rounded-2xl border border-border bg-background/90 backdrop-blur-xl shadow-lg"
      aria-label="Main navigation"
    >
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 py-2 rounded-xl transition-colors min-w-[60px] min-h-12 ${
                isActive
                  ? "text-primary"
                  : "text-text-tertiary hover:text-foreground"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className={`w-5 h-5 ${isActive ? "stroke-[2.5]" : ""}`} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

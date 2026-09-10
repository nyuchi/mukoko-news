"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  BOTTOM_NAV_HREFS,
  hidesAppChrome,
  isImmersive,
  pick,
} from "@/lib/navigation";

const navItems = pick(...BOTTOM_NAV_HREFS);

/**
 * The mobile navigation bar.
 *
 * ## It is on every route now
 *
 * It used to return `null` on `/newsbytes` and on every article page, on the
 * reasoning that both are immersive. The result was that the two surfaces a
 * reader is most likely to arrive on from a share link were the two with no
 * visible way out: the only route back was the browser's own back gesture, or
 * knowing to tap the wordmark. TikTok — the reference for both surfaces — keeps
 * its bar up over fullscreen video and moves the *content* actions to a side
 * rail instead. That is what this app does now: the bar is constant, and
 * `/newsbytes` and the article page carry their own action rails clear of it.
 *
 * The only route with no bar is the embed iframe, which is our markup rendered
 * inside somebody else's page.
 *
 * ## Shape
 *
 * A floating **pill** (`rounded-full`), not a docked bar. It floats because
 * this is a web app rather than an installed one: there is no OS-drawn tab bar
 * to sit flush against, and a full-width bar welded to the bottom of a browser
 * viewport collides with the browser's own toolbar and the home-indicator
 * gesture zone. Floating it clear of both, with `env(safe-area-inset-bottom)`,
 * is the adaptation — `viewport-fit=cover` in `layout.tsx` is what makes that
 * inset non-zero.
 */
export function BottomNav() {
  const pathname = usePathname();

  if (hidesAppChrome(pathname)) {
    return null;
  }

  // Over full-bleed video the translucent page background has nothing to sit
  // against, so the pill carries its own dark ground and a hairline. On the
  // reading surfaces it stays translucent and picks up the page beneath it.
  const immersive = isImmersive(pathname);

  return (
    <nav
      className={`fixed bottom-[calc(env(safe-area-inset-bottom,0px)_+_0.75rem)] left-4 right-4 z-50 mx-auto max-w-md rounded-full border shadow-lg backdrop-blur-xl md:hidden ${
        immersive
          ? "border-white/15 bg-black/70"
          : "border-outline bg-background/90"
      }`}
      aria-label="Main navigation"
    >
      <div className="flex h-16 items-center justify-around px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-12 min-w-[60px] flex-col items-center justify-center gap-0.5 rounded-full px-3 py-2 transition-colors ${
                isActive
                  ? immersive
                    ? "text-white"
                    : "text-primary"
                  : immersive
                    ? "text-white/70 hover:text-white"
                    : "text-text-tertiary hover:text-foreground"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className={`h-5 w-5 ${isActive ? "stroke-[2.5]" : ""}`} />
              {/* `shortLabel` where the full name does not fit a 60px slot. */}
              <span className="text-[10px] font-medium">
                {item.shortLabel ?? item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

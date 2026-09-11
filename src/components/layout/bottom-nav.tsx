"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useIsland, type IslandAction } from "@/contexts/island-context";
import {
  ISLAND_ACCOUNT_HREF,
  ISLAND_DEFAULT_HREFS,
  ISLAND_HOME_HREF,
  hidesAppChrome,
  isImmersive,
  pick,
} from "@/lib/navigation";

const [home] = pick(ISLAND_HOME_HREF);
const [account] = pick(ISLAND_ACCOUNT_HREF);
const defaultMiddle = pick(...ISLAND_DEFAULT_HREFS);

/**
 * The floating island.
 *
 * ## Every device, not just the phone
 *
 * It used to be `md:hidden` — a phone bar, with a separate action bar taking
 * the bottom edge on desktop. Two components doing one job, and only one of
 * them ever visible, which is how the desktop bar shipped left-anchored and
 * with an invisible Share button for a week without anyone noticing. There is
 * one island now and it is on every screen (owner decision 2026-09-11).
 *
 * ## Fixed ends, contextual middle
 *
 * `[ Feed | …the page's own actions… | Profile ]`
 *
 * The two ends never move: a control that shifts under your thumb between
 * pages is worse than no control. Everything between belongs to the page —
 * an article puts like, save, share and open-at-the-publisher there through
 * `useIslandActions`. A page that contributes nothing falls back to the three
 * destinations a thumb reaches for constantly, so the island is never a gap.
 *
 * ## Where it sits on a desktop
 *
 * Centred on the CONTENT COLUMN, not the viewport — when the sidebar is docked
 * the island shifts right with the page, so it stays over what you are reading
 * instead of straddling the sidebar's edge. That offset is a CSS rule keyed off
 * `data-sidebar` (see `globals.css`), the same mechanism that insets the shell,
 * because it has to be right on the first paint after a reload.
 *
 * ## Shape
 *
 * A **pill** (`rounded-full`), not a docked bar. It floats because this is a
 * web app rather than an installed one: there is no OS-drawn tab bar to sit
 * flush against, and a full-width bar welded to the bottom of a browser
 * viewport collides with the browser's own toolbar and the home-indicator
 * gesture zone. `env(safe-area-inset-bottom)` is what clears the latter, and
 * `viewport-fit=cover` in `layout.tsx` is what makes that inset non-zero.
 */
export function BottomNav() {
  const pathname = usePathname();
  const { actions } = useIsland();

  if (hidesAppChrome(pathname)) {
    return null;
  }

  // Over full-bleed video the translucent page background has nothing to sit
  // against, so the island carries its own dark ground and a hairline. On the
  // reading surfaces it stays translucent and picks up the page beneath it.
  const immersive = isImmersive(pathname);

  const middle: IslandAction[] =
    actions && actions.length > 0
      ? actions
      : defaultMiddle.map((d) => ({
          id: d.href,
          label: d.shortLabel ?? d.label,
          icon: d.icon,
          href: d.href,
        }));

  const slots: IslandAction[] = [
    { id: home.href, label: home.shortLabel ?? home.label, icon: home.icon, href: home.href },
    ...middle,
    {
      id: account.href,
      label: account.shortLabel ?? account.label,
      icon: account.icon,
      href: account.href,
    },
  ];

  return (
    <nav
      id="bottom-island"
      className={`fixed bottom-[calc(env(safe-area-inset-bottom,0px)_+_0.75rem)] left-4 right-4 z-50 mx-auto max-w-md rounded-full border shadow-lg backdrop-blur-xl ${
        immersive
          ? "border-white/15 bg-black/70"
          : "border-outline bg-background/90"
      }`}
      aria-label="Main navigation"
    >
      <div className="flex h-16 items-center justify-around px-2">
        {slots.map((slot) => (
          <IslandSlot
            key={slot.id}
            slot={slot}
            immersive={immersive}
            isCurrent={!!slot.href && !slot.external && pathname === slot.href}
          />
        ))}
      </div>
    </nav>
  );
}

/**
 * One slot. A link when it goes somewhere, a button when it does something.
 *
 * Both shapes are the same box so the island's rhythm does not change when an
 * article swaps three destinations for three actions — the reader should see
 * the contents change, not the furniture.
 */
function IslandSlot({
  slot,
  immersive,
  isCurrent,
}: {
  slot: IslandAction;
  immersive: boolean;
  isCurrent: boolean;
}) {
  const Icon = slot.icon;

  // `active` is a pressed state (liked, saved); `isCurrent` is the route you
  // are on. They look the same deliberately — both mean "this one, now" — but
  // they are announced differently, as `aria-pressed` and `aria-current`.
  const lit = isCurrent || slot.active;

  const tone = (() => {
    if (slot.emphasis === "primary") return "text-primary";
    if (slot.emphasis === "success") return "text-success";
    if (slot.emphasis === "destructive") return "text-destructive";
    if (lit) return immersive ? "text-white" : "text-primary";
    return immersive
      ? "text-white/70 hover:text-white"
      : "text-text-tertiary hover:text-foreground";
  })();

  const className = `flex min-h-12 min-w-[60px] flex-col items-center justify-center gap-0.5 rounded-full px-3 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tone}`;

  const body = (
    <>
      <Icon
        className={`h-5 w-5 ${lit ? "stroke-[2.5]" : ""} ${slot.active ? "fill-current" : ""}`}
        aria-hidden="true"
      />
      <span className="text-[10px] font-medium tabular-nums">
        {slot.count !== undefined ? slot.count : slot.label}
      </span>
    </>
  );

  if (slot.href) {
    if (slot.external) {
      return (
        <a
          href={slot.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={slot.ariaLabel ?? slot.label}
          className={className}
        >
          {body}
        </a>
      );
    }
    return (
      <Link
        href={slot.href}
        aria-current={isCurrent ? "page" : undefined}
        aria-label={slot.ariaLabel}
        className={className}
      >
        {body}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={slot.onSelect}
      aria-pressed={slot.active !== undefined ? slot.active : undefined}
      aria-label={slot.ariaLabel ?? slot.label}
      className={className}
    >
      {body}
    </button>
  );
}

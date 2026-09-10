"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";

import { AppIcon } from "@/components/ui/app-icon";
import { SUPPORT_URL } from "@/lib/constants";
import { DESTINATIONS, NAV_GROUPS } from "@/lib/navigation";

/**
 * The app's full navigation, as a collapsible drawer.
 *
 * ## Why it moved here from the footer
 *
 * The site map was a five-column grid at the foot of the page. On a phone that
 * is a long scroll away from wherever the reader actually is, and it collapsed
 * to two columns of sixteen links — a wall, not a menu. Worse, it was only
 * reachable by scrolling *past* the content, so the one surface that could
 * reach every page was the one a reader had to give up on the page to find.
 *
 * A drawer is reachable in one tap from the header on every route, opens over
 * whatever the reader is looking at, and closes back to it.
 *
 * ## It does not fight the bottom bar
 *
 * The floating nav pill is `z-50`; this is `z-[60]`, so an open drawer covers
 * it rather than being punched through by it. The two are not competing
 * surfaces: the pill is the five destinations a thumb reaches constantly, the
 * drawer is everything. Closed, this renders a scrim and panel that are both
 * `pointer-events-none` and fully transparent, so it cannot intercept a tap
 * meant for the page.
 *
 * ## Accessibility
 *
 * A modal dialog, and treated as one: `aria-modal`, focus moved into the panel
 * on open and returned to the trigger on close, Tab cycled within the panel,
 * Escape and a scrim click both close, and the page behind it cannot scroll.
 * The close button is the first thing focus lands on — a reader who opened it
 * by accident gets out with one more keystroke.
 */
export function NavSidebar({
  open,
  onClose,
  /** Focus returns here on close — the button that opened the drawer. */
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Close on navigation. Without this the drawer stays open over the page the
  // reader just asked for, which reads as the tap not having worked.
  //
  // Keyed off a REMEMBERED pathname rather than a `[pathname]` dependency: an
  // effect with that dependency also runs on mount, so a drawer mounted open
  // would close itself immediately. That cannot happen today (this mounts
  // closed), but it is the kind of thing a later `defaultOpen` would trip over
  // silently.
  const lastPathRef = useRef(pathname);
  useEffect(() => {
    if (lastPathRef.current === pathname) return;
    lastPathRef.current = pathname;
    if (open) onClose();
  }, [pathname, open, onClose]);

  // Escape closes, and Tab is trapped inside the panel.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  // Move focus in on open, hand it back on close, and lock the page behind.
  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = overflow;
      const target = returnFocusRef?.current ?? previouslyFocused;
      target?.focus?.();
    };
  }, [open, returnFocusRef]);

  return (
    <>
      {/* Scrim. `--scrim` is the Mzizi backdrop step, so this matches every
          other overlay in the app rather than hand-rolling an opacity. */}
      <div
        className={`fixed inset-0 z-[60] bg-[var(--scrim)] transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden="true"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="All pages"
        // `inert` is what actually takes the closed panel out of the tab order
        // and the accessibility tree — a transform alone leaves every link
        // focusable off-screen, which is how a keyboard reader ends up
        // tabbing into an invisible menu. React 19 takes it as a boolean, and
        // `undefined` (not `false`) is what omits the attribute: the attribute
        // is inert by PRESENCE, so `inert={false}` would render `inert=""` and
        // permanently disable the panel.
        inert={!open || undefined}
        onKeyDown={onKeyDown}
        className={`fixed inset-y-0 left-0 z-[60] flex w-[min(88vw,22rem)] flex-col bg-popover shadow-2xl transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <Link href="/" className="flex min-w-0 items-center gap-2">
            <AppIcon size={28} />
            <span className="truncate font-serif text-lg font-semibold lowercase text-primary">
              mukoko news
            </span>
          </Link>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-elevated hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="All pages" className="flex-1 overflow-y-auto overscroll-contain px-2 py-3">
          {NAV_GROUPS.map((group) => {
            const items = DESTINATIONS.filter((d) => d.group === group.id);
            if (items.length === 0) return null;

            return (
              <div key={group.id} className="mb-4 last:mb-0">
                <h2 className="px-3 pb-1 font-mono text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
                  {group.label}
                </h2>
                <ul>
                  {items.map((d) => {
                    const Icon = d.icon;
                    const isActive = pathname === d.href;
                    return (
                      <li key={d.href}>
                        <Link
                          href={d.href}
                          aria-current={isActive ? "page" : undefined}
                          onClick={onClose}
                          className={`flex min-h-[var(--touch-a11y)] items-center gap-3 rounded-xl px-3 transition-colors ${
                            isActive
                              ? "bg-primary/10 text-primary"
                              : "text-foreground hover:bg-elevated"
                          }`}
                        >
                          <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                          <span className="truncate text-sm font-medium">{d.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                  {group.id === "about" && (
                    <li>
                      <a
                        href={SUPPORT_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-h-[var(--touch-a11y)] items-center gap-3 rounded-xl px-3 text-foreground transition-colors hover:bg-elevated"
                      >
                        {/* No icon: it leaves the app, and an icon here would
                            make it read as one more in-app destination. */}
                        <span className="w-5 shrink-0" aria-hidden="true" />
                        <span className="truncate text-sm font-medium">Support</span>
                      </a>
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </nav>

        {/* No theme control here on purpose. It lives in the footer and on
            /profile → Appearance; a third copy would also make `ThemeProvider`
            a hard requirement of the HEADER, since this panel is mounted (and
            closed) on every route — which is exactly how the header test
            started throwing "useTheme must be used within a ThemeProvider". */}
        <div className="border-t border-border px-4 py-3">
          <span className="text-xs text-text-tertiary">
            © {new Date().getFullYear()} Nyuchi Africa
          </span>
        </div>
      </div>
    </>
  );
}

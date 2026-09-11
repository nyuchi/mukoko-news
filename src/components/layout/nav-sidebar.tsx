"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";

import { AppIcon } from "@/components/ui/app-icon";
import { useSidebar } from "@/contexts/sidebar-context";
import { SUPPORT_URL } from "@/lib/constants";
import { DESTINATIONS, NAV_GROUPS, hidesAppChrome } from "@/lib/navigation";

/**
 * The app's full navigation, as a sidebar.
 *
 * ## Docked, not a dropdown
 *
 * From `lg` up this is a real sidebar: it holds layout space (the shell is
 * inset by `--sidebar-width`), it does not close when a destination is chosen,
 * and it survives navigation and reload. A reader opens it once and moves
 * around the app with it there, which is the entire difference between a
 * sidebar and a menu — a menu that closes on every click is a dropdown, and
 * this was one until an owner review said so.
 *
 * Below `lg` there is no room for a 17rem column beside the content, so it
 * overlays: scrim, focus trap, scroll lock, closes on navigation. Those four
 * belong to the overlay ONLY. Docked, a focus trap would strand a keyboard
 * reader inside a panel that is simply part of the page, and a scroll lock
 * would freeze a document that nothing is covering.
 *
 * ## One DOM tree, not two
 *
 * The two modes are the same markup reshaped by responsive classes plus an
 * `isDocked` flag, never two subtrees taking turns behind `lg:hidden`. jsdom
 * applies no media queries, so both would render in every test and each
 * `getByRole` would match twice — the same trap `ArticleActionBar` documents.
 *
 * The landmark role changes with the mode, and that is correct rather than
 * clever: docked it is a `navigation` region the reader can Tab through as
 * part of the page; overlaid it is a modal `dialog` that owns focus until
 * dismissed. Announcing a docked sidebar as a modal dialog would be a lie.
 */
export function NavSidebar() {
  const pathname = usePathname();
  const { open, isDocked, close } = useSidebar();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Our markup inside somebody else's page gets no app chrome at all.
  const suppressed = hidesAppChrome(pathname);

  // Close on navigation — OVERLAY ONLY. Docked, staying open across pages is
  // the feature; closing would make it the dropdown this replaced.
  //
  // Keyed off a REMEMBERED pathname rather than a `[pathname]` dependency: an
  // effect with that dependency also runs on mount, so a sidebar restored from
  // storage as open would immediately close itself on first paint.
  const lastPathRef = useRef(pathname);
  useEffect(() => {
    if (lastPathRef.current === pathname) return;
    lastPathRef.current = pathname;
    if (open && !isDocked) close();
  }, [pathname, open, isDocked, close]);

  // Escape closes and Tab is trapped — again overlay only.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (isDocked) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
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
    [close, isDocked]
  );

  // Move focus in on open and lock the page behind — overlay only. Focus is
  // deliberately NOT moved when docking: the reader did not open a dialog,
  // they revealed a column, and yanking focus out of the article they were
  // reading to do it would be hostile.
  useEffect(() => {
    if (!open || isDocked) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open, isDocked]);

  if (suppressed) return null;

  // `inert` takes the closed panel out of the tab order and the accessibility
  // tree — a transform alone leaves every link focusable off-screen, which is
  // how a keyboard reader ends up tabbing into an invisible menu. It must be
  // `undefined` (not `false`) when it should be absent: the attribute is inert
  // by PRESENCE, so `inert={false}` renders `inert=""` and permanently
  // disables the panel.
  const inert = !open || undefined;

  return (
    <>
      {/* Scrim — overlay only. Docked there is nothing to dim, and a scrim
          over the page the sidebar sits beside would be nonsense. */}
      <div
        className={`fixed inset-0 z-[60] bg-[var(--scrim)] transition-opacity duration-200 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden="true"
        onClick={close}
      />

      <div
        ref={panelRef}
        id="nav-sidebar"
        // Docked it is part of the page; overlaid it owns focus. See the
        // docblock — this is the honest announcement in each mode, not a
        // shortcut.
        role={isDocked ? "navigation" : "dialog"}
        aria-modal={isDocked ? undefined : "true"}
        aria-label="All pages"
        inert={inert}
        onKeyDown={onKeyDown}
        className={`fixed inset-y-0 left-0 z-[60] flex w-[min(88vw,var(--sidebar-width))] flex-col border-r border-border bg-popover shadow-2xl transition-transform duration-200 ease-out lg:z-30 lg:w-[var(--sidebar-width)] lg:shadow-none ${
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
          {/* Overlay only: docked, the header's own toggle is the way out and
              is always visible, so a second close control would be one more
              thing in the tab order doing the same job. */}
          <button
            ref={closeButtonRef}
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-elevated hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav
          aria-label={isDocked ? undefined : "All pages"}
          className="flex-1 overflow-y-auto overscroll-contain px-2 py-3"
        >
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
                          // Docked, choosing a page does NOT close the sidebar
                          // — that is the whole point. The overlay closes via
                          // the pathname effect above, so this handler exists
                          // only to make the tap feel immediate rather than
                          // waiting for the route to commit.
                          onClick={isDocked ? undefined : close}
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
            closed) on every route. */}
        <div className="border-t border-border px-4 py-3">
          <span className="text-xs text-text-tertiary">
            © {new Date().getFullYear()} Nyuchi Africa
          </span>
        </div>
      </div>
    </>
  );
}

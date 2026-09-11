'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpCircle, RefreshCw, X } from 'lucide-react';

/**
 * Bump this when NEXT_PUBLIC_BUILD_ID / the Vercel commit SHA are unavailable
 * and you need to force clients onto a new service-worker cache version.
 */
const SW_FALLBACK_VERSION = 'v1';

/**
 * Versioned service-worker URL. The `v` param does double duty: a new value
 * gives the browser a new script URL (triggering an update install) and the
 * worker derives its cache-name version from it. On Vercel,
 * NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA changes per deploy when system env vars
 * are exposed; NEXT_PUBLIC_BUILD_ID wins if set explicitly.
 */
export function getServiceWorkerUrl(): string {
  const buildId =
    process.env.NEXT_PUBLIC_BUILD_ID ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    SW_FALLBACK_VERSION;
  return `/sw.js?v=${encodeURIComponent(buildId)}`;
}

/**
 * The version a waiting worker would upgrade you TO.
 *
 * Read off the waiting worker's own script URL rather than from
 * `process.env`: the env var is baked into the bundle that is ALREADY
 * running, so it names the version you are leaving, not the one you are
 * getting. `getServiceWorkerUrl` puts the build id in `?v=`, and the waiting
 * registration's `scriptURL` is the incoming build's copy of it.
 *
 * Commit SHAs are shortened the way every git UI shortens them; anything else
 * (a `VERSION`-style tag, the `v1` fallback) is shown as written. Returns null
 * when there is nothing trustworthy to show — a version line that says
 * "unknown" is worse than no version line.
 */
export function incomingVersion(scriptUrl: string | undefined | null): string | null {
  if (!scriptUrl) return null;
  let raw: string | null = null;
  try {
    raw = new URL(scriptUrl, 'https://example.invalid').searchParams.get('v');
  } catch {
    return null;
  }
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;
  // A 40-char hex SHA is unreadable in a toast; 7 is what git shows.
  if (/^[0-9a-f]{7,40}$/i.test(trimmed)) return trimmed.slice(0, 7);
  return trimmed.length > 24 ? null : trimmed;
}

interface ServiceWorkerRegisterProps {
  /** Injectable for tests — jsdom's window.location.reload is not stubbable. */
  reloadPage?: () => void;
}

/**
 * Registers /sw.js in production and shows a subtle "Update available" banner
 * when a new service worker is waiting. Accepting posts {type:'SKIP_WAITING'}
 * to the waiting worker; the page reloads once on controllerchange (guarded
 * against double reloads). Dependency-free by design.
 */
export function ServiceWorkerRegister({ reloadPage }: ServiceWorkerRegisterProps) {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const container = navigator.serviceWorker;
    let cancelled = false;

    // Single-reload guard: controllerchange fires when the new worker takes
    // over (after SKIP_WAITING); reload exactly once to pick up new assets.
    const onControllerChange = () => {
      if (reloadingRef.current) return;
      reloadingRef.current = true;
      if (reloadPage) reloadPage();
      else window.location.reload();
    };
    container.addEventListener('controllerchange', onControllerChange);

    const register = async () => {
      try {
        const registration = await container.register(getServiceWorkerUrl());
        if (cancelled) return;

        // A worker may already be waiting from a previous visit.
        if (registration.waiting && container.controller) {
          setWaitingWorker(registration.waiting);
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // 'installed' + an existing controller ⇒ an update is waiting
            // (no controller means this is the very first install — nothing
            // to prompt about).
            if (!cancelled && installing.state === 'installed' && container.controller) {
              setWaitingWorker(installing);
            }
          });
        });
      } catch {
        // Registration failed (unsupported / blocked) — the app still works,
        // just without offline support.
      }
    };

    if (document.readyState === 'complete') {
      void register();
    } else {
      window.addEventListener('load', register, { once: true });
    }

    return () => {
      cancelled = true;
      container.removeEventListener('controllerchange', onControllerChange);
      window.removeEventListener('load', register);
    };
  }, [reloadPage]);

  const applyUpdate = useCallback(() => {
    // The worker's message handler calls self.skipWaiting(); the resulting
    // controllerchange triggers the guarded reload above.
    waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
  }, [waitingWorker]);

  if (!waitingWorker || dismissed) return null;

  const version = incomingVersion(waitingWorker.scriptURL);

  return (
    /* A card at the BOTTOM LEFT, in the sidebar's own column when it is docked
       (owner direction 2026-09-11). It was a centred pill floating over the
       middle of the page, which put it straight over whatever you were
       reading — and an update is never so urgent that it should take the
       reading surface. The sidebar's foot is chrome; this belongs with the
       chrome. Below `lg` it stacks above the island using the one clearance
       token every pinned surface reads. */
    <div
      role="status"
      className="fixed left-4 z-50 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-outline bg-popover p-4 shadow-lg backdrop-blur-xl bottom-[var(--bottom-nav-clearance)] lg:bottom-4 lg:w-[calc(var(--sidebar-width)-2rem)]"
    >
      <div className="flex items-start gap-3">
        <ArrowUpCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Update available</p>
          {/* Naming the target build is the point of the card: "an update is
              available" tells you nothing you can check afterwards, and a
              reader who refreshes has no way to confirm they got it. */}
          {version ? (
            <p className="mt-0.5 truncate font-mono text-xs text-text-secondary">
              Upgrading to {version}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-text-secondary">
              A newer version is ready to install.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss update notification"
          className="-mr-1 -mt-1 shrink-0 rounded-xl p-2 text-text-tertiary transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        onClick={applyUpdate}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Refresh now
      </button>
    </div>
  );
}

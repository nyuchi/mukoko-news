'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

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

  return (
    <div
      role="status"
      className="fixed left-4 right-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-border bg-background/95 p-3 pl-4 shadow-lg backdrop-blur-xl bottom-[calc(env(safe-area-inset-bottom,0px)_+_5.75rem)] md:bottom-6"
    >
      <p className="flex-1 text-sm text-foreground">Update available</p>
      <button
        type="button"
        onClick={applyUpdate}
        className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Refresh
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss update notification"
        className="rounded-xl p-2 text-text-tertiary transition-colors hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

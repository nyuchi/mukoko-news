"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════
   NYUCHI COMPONENT HARNESS — Zero-Config Infrastructure Wiring

   Canonical source: mzizi_db → component_documents (node 1,
   collection styling-libs, name nyuchi-harness). Adopted for
   Mukoko News with no behavioural changes.

   The vertical spine that connects N3, N4, and N5 to
   infrastructure. Every brand component (N3), safety gate (N4),
   and resilience wrapper (N5) uses the harness for:

   - Observability (scoped logging, render timing, health reporting)
   - Accessibility (LiveRegion auto-mount, announce(), focus ring)
   - Motion (enter animations, reduced-motion, stagger)

   N2 (primitives) does NOT use the harness — raw building blocks.
   N1 (tokens) does NOT use the harness — pure data.

   TWO USAGE PATTERNS:

   1. NyuchiHarness — declarative wrapper for page sections:
      <NyuchiHarness name="events-feed" skeleton={<FeedSkeleton />}>
        <EventsFeed />
      </NyuchiHarness>

   2. useNyuchiHarness — imperative hook for N3/N4/N5 components:
      const { log, motion, announce } = useNyuchiHarness("listing-card")
   ═══════════════════════════════════════════════════════════════ */

// ─── SCOPED LOGGER (from observability) ────────────────────
// Each component gets its own logger prefixed with the component name.

interface ScopedLogger {
  debug: (message: string, data?: Record<string, unknown>) => void;
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, error?: Error, data?: Record<string, unknown>) => void;
}

function createScopedLogger(componentName: string): ScopedLogger {
  const prefix = `[nyuchi:${componentName}]`;
  return {
    debug: (msg, data) => console.debug(`${prefix} ${msg}`, data || ""),
    info: (msg, data) => console.info(`${prefix} ${msg}`, data || ""),
    warn: (msg, data) => console.warn(`${prefix} ${msg}`, data || ""),
    error: (msg, err, data) => console.error(`${prefix} ${msg}`, err || "", data || ""),
  };
}

// ─── MOTION CONFIG (from nyuchi-motion) ────────────────────
// Provides the correct duration/easing for the current user preference.

interface MotionConfig {
  /** Whether user prefers reduced motion */
  prefersReduced: boolean;
  /** Duration for entry animations (0 if reduced motion) */
  enterDuration: number;
  /** Duration for exit animations */
  exitDuration: number;
  /** CSS easing for entry */
  enterEasing: string;
  /** CSS easing for exit */
  exitEasing: string;
  /** Get stagger delay for item at index in a list */
  staggerDelay: (index: number) => number;
  /** CSS class for entry animation */
  enterClass: string;
}

function getMotionConfig(): MotionConfig {
  const prefersReduced =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  return {
    prefersReduced,
    enterDuration: prefersReduced ? 0 : 200,
    exitDuration: prefersReduced ? 0 : 100,
    enterEasing: prefersReduced ? "linear" : "cubic-bezier(0, 0, 0.2, 1)",
    exitEasing: prefersReduced ? "linear" : "cubic-bezier(0.4, 0, 1, 1)",
    staggerDelay: (index: number) => (prefersReduced ? 0 : Math.min(index, 8) * 50),
    enterClass: prefersReduced ? "" : "nyuchi-animate-in",
  };
}

// ─── ANNOUNCER (from nyuchi-a11y) ──────────────────────────
// Imperative screen reader announcements for dynamic content.

interface Announcer {
  /** Announce a message to screen readers (polite — waits for current speech) */
  announce: (message: string) => void;
  /** Announce urgently (assertive — interrupts current speech) */
  announceUrgent: (message: string) => void;
  /** The live region element to render (must be in the DOM) */
  LiveRegion: React.ReactNode;
}

function useAnnouncer(): Announcer {
  const [message, setMessage] = React.useState("");
  const [politeness, setPoliteness] = React.useState<"polite" | "assertive">("polite");
  const portalRef = React.useRef<HTMLDivElement | null>(null);

  // Auto-mount LiveRegion via a shared DOM node — components no longer
  // need to render <LiveRegion /> themselves.
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    let el = document.getElementById("nyuchi-live-region");
    if (!el) {
      el = document.createElement("div");
      el.id = "nyuchi-live-region";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.setAttribute("aria-atomic", "true");
      el.className = "sr-only";
      document.body.appendChild(el);
    }
    portalRef.current = el as HTMLDivElement;
    return () => {
      /* keep mounted — shared across components */
    };
  }, []);

  const announce = React.useCallback((msg: string) => {
    setMessage("");
    setPoliteness("polite");
    requestAnimationFrame(() => {
      setMessage(msg);
      if (portalRef.current) {
        portalRef.current.setAttribute("aria-live", "polite");
        portalRef.current.textContent = msg;
      }
    });
  }, []);

  const announceUrgent = React.useCallback((msg: string) => {
    setMessage("");
    setPoliteness("assertive");
    requestAnimationFrame(() => {
      setMessage(msg);
      if (portalRef.current) {
        portalRef.current.setAttribute("aria-live", "assertive");
        portalRef.current.textContent = msg;
      }
    });
  }, []);

  const LiveRegion = React.useMemo(
    () => (
      <div
        role="status"
        aria-live={politeness}
        aria-atomic="true"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          margin: -1,
          padding: 0,
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {message}
      </div>
    ),
    [message, politeness]
  );

  return { announce, announceUrgent, LiveRegion };
}

// ─── HEALTH REPORTER ───────────────────────────────────────
// Reports component health via structured log events (the N8
// assurance monitor picks these up).

type HealthStatus = "healthy" | "degraded" | "error" | "loading";

interface HealthReporter {
  reportHealthy: () => void;
  reportDegraded: (reason?: string) => void;
  reportError: (error: Error) => void;
  reportLoading: () => void;
}

function useHealthReporter(componentName: string): HealthReporter {
  const log = React.useMemo(() => createScopedLogger(componentName), [componentName]);

  return React.useMemo(
    () => ({
      reportHealthy: () => log.debug("status: healthy"),
      reportDegraded: (reason?: string) =>
        log.warn(`status: degraded${reason ? ` — ${reason}` : ""}`),
      reportError: (error: Error) => log.error("status: error", error),
      reportLoading: () => log.debug("status: loading"),
    }),
    [log]
  );
}

// ─── TOKEN VERIFIER ────────────────────────────────────────
// Dev-only check that CSS custom properties are present.

function useTokenVerifier(componentName: string) {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (typeof window === "undefined") return;

    const root = document.documentElement;
    const style = getComputedStyle(root);

    const requiredTokens = [
      "--color-malachite",
      "--color-cobalt",
      "--color-tanzanite",
      "--color-gold",
      "--color-terracotta",
      "--radius-card",
      "--radius-inner",
      "--radius-pill",
    ];

    const missing = requiredTokens.filter((token) => {
      const value = style.getPropertyValue(token).trim();
      return !value;
    });

    if (missing.length > 0) {
      console.warn(
        `[nyuchi:${componentName}] Missing CSS tokens: ${missing.join(", ")}. ` +
          `Check src/app/globals.css defines the mineral palette and radii.`
      );
    }
  }, [componentName]);
}

// ─── OBSERVABILITY (domain-gated) ────────────────────────────
// Design portal backlinks and observability only render on allowed domains.
// This protects privacy: no tracking on unauthorized domains.

export const INTERNAL_DOMAINS = ["nyuchi.com", "mukoko.com", "localhost"];

function isObservabilityAllowedDomain(): boolean {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname;
  return INTERNAL_DOMAINS.some((d) => hostname === d || hostname.endsWith("." + d));
}

function getObservabilityAttrs(componentName: string): Record<string, string> {
  if (!isObservabilityAllowedDomain()) return {};
  return { "data-portal": `https://mzizi.dev/components/${componentName}` };
}

// ─── useNyuchiHarness HOOK ──────────────────────────────
// The imperative API for leaf components.

export interface ComponentHarnessResult {
  /** Scoped observability logger */
  log: ScopedLogger;
  /** Motion configuration respecting user preferences */
  motion: MotionConfig;
  /** Screen reader announcer */
  announce: (message: string) => void;
  announceUrgent: (message: string) => void;
  /** Health reporter */
  health: HealthReporter;
  /** Live region element (render this in the component) */
  LiveRegion: React.ReactNode;
  /** Render timing tracker — call at start of render */
  trackRenderStart: () => void;
  /** Render timing tracker — call at end of render (useEffect) */
  trackRenderEnd: () => void;
  /** Domain-gated observability attributes for root element (data-portal) */
  observabilityAttrs: Record<string, string>;
}

export function useNyuchiHarness(componentName: string): ComponentHarnessResult {
  const log = React.useMemo(() => createScopedLogger(componentName), [componentName]);
  const motion = React.useMemo(() => getMotionConfig(), []);
  const { announce, announceUrgent, LiveRegion } = useAnnouncer();
  const health = useHealthReporter(componentName);
  const renderStartRef = React.useRef(0);

  // Token verification (dev only)
  useTokenVerifier(componentName);

  // Report healthy on mount
  React.useEffect(() => {
    health.reportHealthy();
    log.debug("mounted");
    return () => {
      log.debug("unmounted");
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const trackRenderStart = React.useCallback(() => {
    renderStartRef.current = performance.now();
  }, []);

  const trackRenderEnd = React.useCallback(() => {
    if (renderStartRef.current > 0) {
      const duration = Math.round((performance.now() - renderStartRef.current) * 100) / 100;
      if (duration > 16) {
        // Only log slow renders (>1 frame)
        log.warn(`slow render: ${duration}ms`, { duration });
      }
    }
  }, [log]);

  const observabilityAttrs = React.useMemo(
    () => getObservabilityAttrs(componentName),
    [componentName]
  );
  return {
    log,
    motion,
    announce,
    announceUrgent,
    health,
    LiveRegion,
    trackRenderStart,
    trackRenderEnd,
    observabilityAttrs,
  };
}

// ─── NyuchiHarness COMPONENT ───────────────────────────────
// The declarative wrapper for page sections.
// Provides error boundary + skeleton + observability + motion.

interface NyuchiHarnessProps {
  /** Unique name for this section (used in logs and health reports) */
  name: string;
  /** Content to render */
  children: React.ReactNode;
  /** Whether the section is loading */
  loading?: boolean;
  /** Custom skeleton for loading state */
  skeleton?: React.ReactNode;
  /** Custom fallback for error state */
  fallback?: React.ReactNode;
  /** Whether errors should bubble up instead of being caught */
  critical?: boolean;
  /** Animate entry */
  animate?: boolean;
  className?: string;
}

interface HarnessState {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

class NyuchiHarnessBoundary extends React.Component<NyuchiHarnessProps, HarnessState> {
  private log: ScopedLogger;
  private renderStart = 0;

  constructor(props: NyuchiHarnessProps) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0 };
    this.log = createScopedLogger(props.name);
  }

  static getDerivedStateFromError(error: Error): Partial<HarnessState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    this.log.error("render crash", error, {
      retryCount: this.state.retryCount,
      componentStack: error.stack?.split("\n").slice(0, 5),
    });
  }

  componentDidMount() {
    this.trackRender();
    this.log.debug("mounted");
  }

  componentDidUpdate() {
    this.trackRender();
  }

  componentWillUnmount() {
    this.log.debug("unmounted");
  }

  private trackRender() {
    if (this.renderStart > 0) {
      const duration = Math.round((performance.now() - this.renderStart) * 100) / 100;
      if (duration > 16) {
        this.log.warn(`slow render: ${duration}ms`);
      }
    }
  }

  private handleRetry = () => {
    this.log.info(`retry attempt ${this.state.retryCount + 1}`);
    this.setState((prev) => ({ hasError: false, error: null, retryCount: prev.retryCount + 1 }));
  };

  render() {
    this.renderStart = performance.now();
    const { name, children, loading, skeleton, fallback, critical, animate, className } =
      this.props;

    // Loading state
    if (loading) {
      return (
        <div
          data-slot="nyuchi-harness"
          data-section={name}
          data-status="loading"
          className={className}
          role="status"
          aria-label={`${name} loading`}
        >
          {skeleton || (
            <div className="animate-pulse rounded-[var(--radius-card,14px)] bg-card p-4 ring-1 ring-foreground/10">
              <div className="h-4 w-2/3 rounded-[var(--radius-inner,7px)] bg-foreground/[0.06]" />
              <div className="mt-2 h-3 w-full rounded-[var(--radius-inner,7px)] bg-foreground/[0.06]" />
              <div className="mt-2 h-3 w-1/2 rounded-[var(--radius-inner,7px)] bg-foreground/[0.06]" />
            </div>
          )}
        </div>
      );
    }

    // Error state
    if (this.state.hasError) {
      if (critical) throw this.state.error;

      return (
        <div
          data-slot="nyuchi-harness"
          data-section={name}
          data-status="error"
          data-retry-count={this.state.retryCount}
          className={className}
          role="alert"
          aria-label={`${name} error`}
        >
          {fallback || (
            <div className="flex flex-col items-center rounded-[var(--radius-card,14px)] bg-card px-6 py-6 text-center ring-1 ring-foreground/10">
              <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-[var(--color-terracotta,#D4A574)]/10">
                <span className="text-lg text-[var(--color-terracotta,#D4A574)]">!</span>
              </div>
              <p className="text-sm font-medium text-foreground">{name} could not load</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {this.state.error?.message || "An unexpected error occurred"}
              </p>
              <button
                onClick={this.handleRetry}
                className={cn(
                  "mt-4 flex h-9 items-center gap-2 rounded-full px-4 text-xs font-medium transition-colors",
                  "border border-border text-foreground hover:bg-foreground/[0.05]"
                )}
              >
                Try Again{this.state.retryCount > 0 ? ` (${this.state.retryCount})` : ""}
              </button>
            </div>
          )}
        </div>
      );
    }

    // Healthy state — render with optional entry animation
    return (
      <div
        data-slot="nyuchi-harness"
        data-section={name}
        data-status="healthy"
        className={cn(animate && "nyuchi-animate-in", className)}
      >
        {children}
      </div>
    );
  }
}

export function NyuchiHarness(props: NyuchiHarnessProps) {
  return <NyuchiHarnessBoundary {...props} />;
}

export type { NyuchiHarnessProps, ScopedLogger, MotionConfig, HealthReporter, HealthStatus };

"use client";

import { Component, type ReactNode, type ErrorInfo } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Report error to backend error tracking endpoint
 * Sends error details to the ObservabilityService for monitoring and debugging
 */
async function reportErrorToBackend(
  error: Error,
  componentStack: string | null | undefined
): Promise<void> {
  // Report in production, or in staging if explicitly enabled via env var
  const isProduction = process.env.NODE_ENV === "production";
  const enableInStaging = process.env.NEXT_PUBLIC_ENABLE_ERROR_REPORTING === "true";

  if (!isProduction && !enableInStaging) {
    return;
  }

  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL ||
    "https://mukoko-news-api.fly.dev";

  try {
    const response = await fetch(`${apiUrl}/api/errors`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        error: error.message,
        stack: error.stack,
        componentStack: componentStack,
        url: typeof window !== "undefined" ? window.location.href : undefined,
        userAgent:
          typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      console.warn("[ErrorBoundary] Failed to report error:", response.status);
    }
  } catch (reportError) {
    // Silently fail - don't break the app if error reporting fails
    console.warn("[ErrorBoundary] Error reporting failed:", reportError);
  }
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error with context for debugging
    console.error("[ErrorBoundary] Caught error:", error.message);
    console.error("[ErrorBoundary] Component stack:", errorInfo.componentStack);

    // Report error to backend for production monitoring
    reportErrorToBackend(error, errorInfo.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="p-4 rounded-lg bg-surface text-text-secondary text-center">
            <p>Something went wrong loading this content.</p>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

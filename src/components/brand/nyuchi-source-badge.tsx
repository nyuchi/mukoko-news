"use client";

// ── INFRASTRUCTURE HARNESS (auto-wired) ──
import { useNyuchiHarness } from "@/lib/harness";

import * as React from "react";
import { Newspaper, CheckCircle, AlertCircle, HelpCircle, type BrandIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════
   NYUCHI SOURCE BADGE — News Source Credibility Indicator

   Canonical source: mzizi_db → component_documents (node 3,
   collection brand, name nyuchi-source-badge). "News source
   credibility indicator badge tied to verification tier. Maps to
   news.feedSources / news.newsMediaOrganizations verification
   status. Used inline on article cards and in source attribution."
   ═══════════════════════════════════════════════════════════════ */

type SourceCredibility = "verified" | "community" | "unverified" | "disputed";

const credibilityConfig: Record<SourceCredibility, { color: string; icon: BrandIcon; label: string }> = {
  verified: { color: "var(--status-success)", icon: CheckCircle, label: "Verified Source" },
  community: { color: "var(--color-terracotta)", icon: CheckCircle, label: "Community Source" },
  unverified: { color: "var(--status-neutral)", icon: HelpCircle, label: "Unverified Source" },
  disputed: { color: "var(--status-error)", icon: AlertCircle, label: "Disputed Source" },
};

interface NyuchiSourceBadgeProps {
  loading?: boolean;
  sourceName: string;
  credibility?: SourceCredibility;
  showLabel?: boolean;
  className?: string;
}

function NyuchiSourceBadge({
  loading = false,
  sourceName,
  credibility = "unverified",
  showLabel = false,
  className,
}: NyuchiSourceBadgeProps) {
  const { observabilityAttrs } = useNyuchiHarness("source-badge");

  if (loading) {
    return (
      <div
        data-slot="nyuchi-source-badge"
        {...observabilityAttrs}
        data-loading
        role="status"
        className="animate-pulse inline-flex items-center gap-1.5"
      >
        <div className="size-4 rounded-full bg-muted" />
        <div className="h-2.5 w-12 rounded bg-muted" />
      </div>
    );
  }

  const config = credibilityConfig[credibility];
  const Icon = config.icon;
  return (
    <span
      data-slot="nyuchi-source-badge"
      {...observabilityAttrs}
      role="status"
      className={cn("inline-flex items-center gap-1.5 text-xs", className)}
      title={config.label}
    >
      <Newspaper className="size-3 text-muted-foreground" />
      <span className="font-medium text-foreground">{sourceName}</span>
      <Icon className="size-3" style={{ color: config.color }} />
      {showLabel && (
        <span className="text-[10px]" style={{ color: config.color }}>
          {config.label}
        </span>
      )}
    </span>
  );
}

export { NyuchiSourceBadge };
export type { NyuchiSourceBadgeProps, SourceCredibility };

"use client";

// ── INFRASTRUCTURE HARNESS (auto-wired) ──
import { useNyuchiHarness } from "@/lib/harness";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Users, Phone, ShieldCheck, Award, Ban, Flower2 } from "@/lib/icons";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════
   MUKOKO VERIFIED BADGE — Brand Identity Component

   Canonical source: mzizi_db → component_documents (node 3,
   collection brand, name nyuchi-verified-badge). Adopted verbatim
   (icons resolve via the @/lib/icons shim).

   Three-axis trust model (nyuchi_platform_db):

   AXIS 1 — STATUS (identity.person.mit_status)
     Platform lifecycle. Independent of verification.
     pre_verification | living | liveness_pending |
     suspended | presumed_ancestral | verified_ancestral

   AXIS 2 — VERIFICATION TIER (system.verification_tier)
     Identity ladder. How real are you?
     Level 0: Unverified — no badge
     Level 1: Community  — Terracotta — +0.10
     Level 2: OTP        — Cobalt     — +0.10 (cumulative 0.20)
     Level 3: Government — Gold       — +0.10 (cumulative 0.30)
     Level 4: Licensed   — Tanzanite  — +0.20 (cumulative 0.50)

   AXIS 3 — TRUST SCORE (computed output)
     trust = sum(tier_increments up to current level) + status_modifier
     Suspended/ancestral = fixed at status modifier (trust frozen)

   The badge renders based on TIER (which mineral check you see)
   but respects STATUS (dimmed if suspended, memorial if ancestral).
   ═══════════════════════════════════════════════════════════════ */

/** Verification tier codes from system.verification_tier.tier_code */
type VerificationTier = "unverified" | "community" | "otp" | "government" | "licensed";

/** Platform status from identity.person.mit_status */
type PlatformStatus =
  | "pre_verification"
  | "living"
  | "liveness_pending"
  | "suspended"
  | "presumed_ancestral"
  | "verified_ancestral";

/** Full tier configuration mapping to system.verification_tier */
const TIER_CONFIG = {
  unverified: {
    level: 0,
    mineral: null,
    label: "Unverified",
    trustIncrement: 0.0,
    cumulativeTrust: 0.0,
    fg: "transparent",
    bg: "transparent",
    icon: null,
  },
  community: {
    level: 1,
    mineral: "Terracotta",
    label: "Community Verified",
    trustIncrement: 0.1,
    cumulativeTrust: 0.1,
    fg: "var(--color-terracotta)",
    bg: "color-mix(in srgb, var(--color-terracotta) 15%, transparent)",
    icon: Users,
  },
  otp: {
    level: 2,
    mineral: "Cobalt",
    label: "Contact Verified",
    trustIncrement: 0.1,
    cumulativeTrust: 0.2,
    fg: "var(--color-cobalt)",
    bg: "color-mix(in srgb, var(--color-cobalt) 15%, transparent)",
    icon: Phone,
  },
  government: {
    level: 3,
    mineral: "Gold",
    label: "Government Verified",
    trustIncrement: 0.1,
    cumulativeTrust: 0.3,
    fg: "var(--color-gold)",
    bg: "color-mix(in srgb, var(--color-gold) 15%, transparent)",
    icon: ShieldCheck,
  },
  licensed: {
    level: 4,
    mineral: "Tanzanite",
    label: "Licensed Professional",
    trustIncrement: 0.2,
    cumulativeTrust: 0.5,
    fg: "var(--color-tanzanite)",
    bg: "color-mix(in srgb, var(--color-tanzanite) 15%, transparent)",
    icon: Award,
  },
} as const;

/** Status overlay configuration from system.platform_status_trust */
const STATUS_OVERLAY = {
  pre_verification: { modifier: 0.0, active: true, overlay: null },
  living: { modifier: 0.0, active: true, overlay: null },
  liveness_pending: { modifier: 0.0, active: true, overlay: null },
  suspended: { modifier: -0.05, active: false, overlay: "suspended" as const },
  presumed_ancestral: { modifier: 0.05, active: false, overlay: "ancestral" as const },
  verified_ancestral: { modifier: 0.05, active: false, overlay: "ancestral" as const },
} as const;

const badgeSizeVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-full transition-opacity",
  {
    variants: {
      size: {
        sm: "size-3.5" /* Inline with text — next to names */,
        md: "size-[18px]" /* Default — cards, headers */,
        lg: "size-6" /* Profile pages */,
        xl: "size-8" /* Verification detail views */,
      },
    },
    defaultVariants: { size: "md" },
  }
);

const iconSizeMap = { sm: 10, md: 12, lg: 16, xl: 20 } as const;

interface NyuchiVerifiedBadgeProps extends VariantProps<typeof badgeSizeVariants> {
  /** Verification tier code (system.verification_tier.tier_code) */
  tier: VerificationTier;
  /** Platform status (identity.person.mit_status). Affects badge appearance. */
  status?: PlatformStatus;
  /** Show tooltip with tier name on hover */
  showTooltip?: boolean;
  /** Render skeleton placeholder while verification status is loading */
  loading?: boolean;
  className?: string;
}

function NyuchiVerifiedBadge({
  tier,
  status = "living",
  size = "md",
  showTooltip = true,
  loading = false,
  className,
}: NyuchiVerifiedBadgeProps) {
  const { observabilityAttrs } = useNyuchiHarness("verified-badge");

  if (loading) {
    return (
      <span
        data-slot="nyuchi-verified-badge"
        {...observabilityAttrs}
        data-loading
        className="inline-flex size-4 animate-pulse rounded-full bg-muted"
      />
    );
  }

  const config = TIER_CONFIG[tier];
  const statusConfig = STATUS_OVERLAY[status];
  const iconSize = iconSizeMap[size || "md"];

  /* Level 0 = no badge */
  if (!config.icon || tier === "unverified") return null;

  /* Suspended: show ban overlay instead of tier icon */
  if (statusConfig.overlay === "suspended") {
    return (
      <span
        data-slot="nyuchi-verified-badge"
        data-tier={tier}
        data-status="suspended"
        {...observabilityAttrs}
        aria-label="Account Suspended"
        title={showTooltip ? "Account Suspended" : undefined}
        className={cn(badgeSizeVariants({ size }), "opacity-40", className)}
        style={{ backgroundColor: "color-mix(in srgb, var(--status-neutral) 15%, transparent)" }}
      >
        <Ban width={iconSize} height={iconSize} strokeWidth={2.5} color="var(--status-neutral)" />
      </span>
    );
  }

  /* Ancestral: show memorial flower with dimmed tier color */
  if (statusConfig.overlay === "ancestral") {
    return (
      <span
        data-slot="nyuchi-verified-badge"
        data-tier={tier}
        data-status={status}
        {...observabilityAttrs}
        aria-label={`${config.label} — Memorial`}
        title={showTooltip ? `${config.label} — Memorial` : undefined}
        className={cn(badgeSizeVariants({ size }), "opacity-60", className)}
        style={{ backgroundColor: config.bg }}
      >
        <Flower2 width={iconSize} height={iconSize} strokeWidth={2} style={{ color: config.fg }} />
      </span>
    );
  }

  /* Active: show full tier badge */
  const Icon = config.icon;
  return (
    <span
      data-slot="nyuchi-verified-badge"
      data-tier={tier}
      data-level={config.level}
      data-trust={config.cumulativeTrust}
      {...observabilityAttrs}
      aria-label={config.label}
      title={showTooltip ? `${config.label} · Trust ${config.cumulativeTrust}` : undefined}
      className={cn(badgeSizeVariants({ size }), className)}
      style={{ backgroundColor: config.bg }}
    >
      <Icon width={iconSize} height={iconSize} strokeWidth={2.5} style={{ color: config.fg }} />
    </span>
  );
}

/* ── Utility: compute trust score on the client ──────────────── */
function computeTrustScore(tier: VerificationTier, status: PlatformStatus): number {
  const statusConfig = STATUS_OVERLAY[status];

  // Suspended/ancestral = fixed at modifier only
  if (!statusConfig.active) return statusConfig.modifier;

  // Active = cumulative tier score + status modifier
  return TIER_CONFIG[tier].cumulativeTrust + statusConfig.modifier;
}

export { NyuchiVerifiedBadge, computeTrustScore, TIER_CONFIG, STATUS_OVERLAY };
export type { NyuchiVerifiedBadgeProps, VerificationTier, PlatformStatus };

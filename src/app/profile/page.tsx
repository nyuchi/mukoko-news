"use client";

import Link from "next/link";
import {
  User,
  Moon,
  Sun,
  Monitor,
  ChevronRight,
  HelpCircle,
  FileText,
  Shield,
  Loader2,
  LogOut,
  Bookmark,
  BadgeCheck,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { useEffect, useState } from "react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { getMyProfileAction } from "@/lib/actions/profile";
import type { MyProfile } from "@/lib/mongodb/identity";
import { ProfileIdentity } from "@/components/profile/profile-identity";
import { ProfilePreferences } from "@/components/profile/profile-preferences";
import { ProfileOrganizations } from "@/components/profile/profile-organizations";
import { ProfileAppearance } from "@/components/profile/profile-appearance";
import { ProfileNavigation } from "@/components/profile/profile-navigation";
import { ProfileAdminLink } from "@/components/profile/profile-admin-link";

function ProfileContent() {
  const { user, loading, signOut } = useAuth();
  const isLoggedIn = !!user;
  // The canonical profile record — richer than the session claims (the picture
  // lives on profile-images.mukoko.com and interests are not in the token).
  const [profile, setProfile] = useState<MyProfile | null>(null);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    let active = true;
    getMyProfileAction()
      .then((p) => {
        if (active) setProfile(p);
      })
      // Fail-soft: the page still renders from the session claims.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user]);



  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  // ── Signed-out: one entry point into the hosted AuthKit flow via /sign-in ──
  if (!isLoggedIn) {
    return (
      <div className="mx-auto w-full max-w-[var(--width-form)] px-[var(--page-gutter)] sm:px-[var(--page-gutter-sm)] py-[var(--page-block-reading)]">
        <div className="text-center mb-10">
          <div className="w-20 h-20 bg-container-tanzanite rounded-full flex items-center justify-center mx-auto mb-6">
            <User className="w-10 h-10 text-on-container-tanzanite" />
          </div>
          <h1 className="font-serif text-2xl font-bold mb-2">Welcome to mukoko</h1>
          <p className="text-text-secondary mb-6">
            Sign in to save articles, personalize your feed, and sync across devices.
          </p>
          <Link
            href="/sign-in?returnTo=/profile"
            className="inline-block px-6 py-3 bg-primary text-on-primary font-medium rounded-xl hover:opacity-90 transition-opacity"
          >
            Sign in or create account
          </Link>
        </div>

        <ProfileAppearance />
        {/* The full site map. It is on the signed-OUT branch too: an anonymous
            reader who taps Profile from the bottom bar is the reader most
            likely to be looking for a way around the app, not for an account. */}
        <ProfileNavigation />
        <AboutCard />
        <Footer />
      </div>
    );
  }

  // ── Signed-in ──
  return (
    <div className="mx-auto w-full max-w-[var(--width-form)] px-[var(--page-gutter)] sm:px-[var(--page-gutter-sm)] py-[var(--page-block-reading)]">
      {/* Name and picture come from identity.persons, falling back to the
          session claims until the record is populated. */}
      <ProfileIdentity
        firstName={profile?.givenName ?? user.firstName}
        lastName={profile?.familyName ?? user.lastName}
        email={user.email}
        pictureUrl={profile?.picture ?? user.profilePictureUrl}
      />

      {/* The settings that were missing entirely: countries + interests. */}
      <ProfilePreferences signedIn initialInterests={profile?.interests} />

      {/* Staff entry point to /admin. Nothing in the app linked there before, so
          the console was reachable only by typing the URL. Renders nothing for
          non-staff — and this is a link, not a gate: /admin re-derives the tier
          server-side on every request. */}
      <ProfileAdminLink />

      {/* Entity memberships, shown as the entity-scoped capabilities they are.
          Renders nothing when there are none. */}
      <ProfileOrganizations />

      <ProfileAppearance />

      {/* The full site map — see ProfileNavigation for why it lives here. */}
      <ProfileNavigation signedIn />

      {/* Publisher tools — the Tier-2 claim entry point. */}
      <div className="bg-surface border border-outline rounded-2xl overflow-hidden mb-6">
        <h2 className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary border-b border-elevated">
          Publisher
        </h2>
        <Link
          href="/dashboard"
          className="flex items-center justify-between px-4 py-4 hover:bg-elevated transition-colors"
        >
          <div className="flex items-center gap-3">
            <BadgeCheck className="w-5 h-5 text-secondary" />
            <div>
              <span className="font-medium block">Publisher dashboard</span>
              <span className="text-xs text-text-tertiary">
                Manage your publication, feeds and verification
              </span>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-text-tertiary" />
        </Link>
      </div>

      <div className="bg-surface border border-outline rounded-2xl overflow-hidden">
        <h2 className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary border-b border-elevated">
          Settings
        </h2>

        <Link
          href="/saved"
          className="w-full flex items-center justify-between px-4 py-4 hover:bg-elevated transition-colors"
        >
          <div className="flex items-center gap-3">
            <Bookmark className="w-5 h-5" />
            <span className="font-medium">Saved Articles</span>
          </div>
          <ChevronRight className="w-4 h-4 text-text-tertiary" />
        </Link>
      </div>

      <button
        onClick={() => signOut({ returnTo: "/" })}
        className="mt-6 w-full flex items-center justify-center gap-2 px-6 py-3 bg-surface border border-outline text-foreground font-medium rounded-xl hover:bg-elevated transition-colors"
      >
        <LogOut className="w-4 h-4" />
        Sign out
      </button>

      <Footer />
    </div>
  );
}


function AboutCard() {
  const links = [
    { href: "/help", label: "Help Center", icon: HelpCircle },
    { href: "/terms", label: "Terms of Service", icon: FileText },
    { href: "/privacy", label: "Privacy Policy", icon: Shield },
  ];
  return (
    <div className="bg-surface border border-outline rounded-2xl overflow-hidden mt-6">
      <h2 className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary border-b border-elevated">
        About
      </h2>
      {links.map((l, i) => (
        <Link
          key={l.href}
          href={l.href}
          className={`flex items-center justify-between px-4 py-4 hover:bg-elevated transition-colors ${
            i < links.length - 1 ? "border-b border-elevated" : ""
          }`}
        >
          <div className="flex items-center gap-3">
            <l.icon className="w-5 h-5" />
            <span className="font-medium">{l.label}</span>
          </div>
          <ChevronRight className="w-4 h-4 text-text-tertiary" />
        </Link>
      ))}
    </div>
  );
}

function Footer() {
  return (
    <div className="text-center mt-8 text-sm text-text-tertiary">
      <p>Mukoko News v1.0.0</p>
      <p className="mt-1">A Mukoko Product by Nyuchi Africa</p>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <ErrorBoundary
      fallback={
        <div className="mx-auto w-full max-w-[var(--width-form)] px-[var(--page-gutter)] sm:px-[var(--page-gutter-sm)] py-[var(--page-block-reading)] text-center">
          <div className="w-20 h-20 bg-surface rounded-full flex items-center justify-center mx-auto mb-6">
            <User className="w-10 h-10 text-text-tertiary" />
          </div>
          <h2 className="font-serif text-xl font-bold mb-2">Something went wrong</h2>
          <p className="text-text-secondary mb-4">
            We couldn&apos;t load your profile. Please try refreshing the page.
          </p>
        </div>
      }
    >
      <ProfileContent />
    </ErrorBoundary>
  );
}

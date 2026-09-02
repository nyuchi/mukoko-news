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

function ProfileContent() {
  const { theme, cycleTheme } = useTheme();
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

  const getThemeIcon = () => {
    switch (theme) {
      case "dark":
        return <Moon className="w-5 h-5" />;
      case "light":
        return <Sun className="w-5 h-5" />;
      default:
        return <Monitor className="w-5 h-5" />;
    }
  };

  const getThemeLabel = () => {
    switch (theme) {
      case "dark":
        return "Dark";
      case "light":
        return "Light";
      default:
        return "System";
    }
  };

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
      <div className="max-w-[600px] mx-auto px-6 py-12">
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

        <SettingsCard themeIcon={getThemeIcon()} themeLabel={getThemeLabel()} onTheme={cycleTheme} />
        <AboutCard />
        <Footer />
      </div>
    );
  }

  // ── Signed-in ──
  return (
    <div className="max-w-[600px] mx-auto px-6 py-12">
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

      {/* Entity memberships, shown as the entity-scoped capabilities they are.
          Renders nothing when there are none. */}
      <ProfileOrganizations />

      {/* Publisher tools — the Tier-2 claim entry point. */}
      <div className="bg-surface border border-elevated rounded-2xl overflow-hidden mb-6">
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

      <div className="bg-surface border border-elevated rounded-2xl overflow-hidden">
        <h2 className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary border-b border-elevated">
          Settings
        </h2>

        <button
          onClick={cycleTheme}
          className="w-full flex items-center justify-between px-4 py-4 hover:bg-elevated transition-colors border-b border-elevated"
        >
          <div className="flex items-center gap-3">
            {getThemeIcon()}
            <span className="font-medium">Appearance</span>
          </div>
          <div className="flex items-center gap-2 text-text-secondary">
            <span>{getThemeLabel()}</span>
            <ChevronRight className="w-4 h-4" />
          </div>
        </button>

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
        className="mt-6 w-full flex items-center justify-center gap-2 px-6 py-3 bg-surface border border-elevated text-foreground font-medium rounded-xl hover:bg-elevated transition-colors"
      >
        <LogOut className="w-4 h-4" />
        Sign out
      </button>

      <Footer />
    </div>
  );
}

function SettingsCard({
  themeIcon,
  themeLabel,
  onTheme,
}: {
  themeIcon: React.ReactNode;
  themeLabel: string;
  onTheme: () => void;
}) {
  return (
    <div className="bg-surface border border-elevated rounded-2xl overflow-hidden">
      <h2 className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary border-b border-elevated">
        Settings
      </h2>
      <button
        onClick={onTheme}
        className="w-full flex items-center justify-between px-4 py-4 hover:bg-elevated transition-colors"
      >
        <div className="flex items-center gap-3">
          {themeIcon}
          <span className="font-medium">Appearance</span>
        </div>
        <div className="flex items-center gap-2 text-text-secondary">
          <span>{themeLabel}</span>
          <ChevronRight className="w-4 h-4" />
        </div>
      </button>
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
    <div className="bg-surface border border-elevated rounded-2xl overflow-hidden mt-6">
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
        <div className="max-w-[600px] mx-auto px-6 py-12 text-center">
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

"use client";

import { useState } from "react";
import Link from "next/link";
import {
  User,
  Bell,
  Moon,
  Sun,
  Monitor,
  ChevronRight,
  HelpCircle,
  FileText,
  Shield,
  Loader2,
  LogOut,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { InlineSignIn } from "@/components/auth/inline-sign-in";

function ProfileContent() {
  const { theme, setTheme, cycleTheme } = useTheme();
  const { user, loading, signOut } = useAuth();
  const isLoggedIn = !!user;
  const [showSignIn, setShowSignIn] = useState(false);

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

  if (!isLoggedIn) {
    return (
      <div className="max-w-[600px] mx-auto px-6 py-12">
        {/* Sign In Prompt — inline AuthKit (no hosted redirect) */}
        {showSignIn ? (
          <div className="mb-12 rounded-2xl border border-elevated bg-surface p-8">
            <InlineSignIn />
            <button
              onClick={() => setShowSignIn(false)}
              className="mt-4 w-full text-center text-sm text-text-secondary hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="text-center mb-12">
            <div className="w-24 h-24 bg-gradient-to-br from-primary to-secondary rounded-full flex items-center justify-center mx-auto mb-6">
              <User className="w-12 h-12 text-white" />
            </div>
            <h1 className="font-serif text-2xl font-bold mb-2">Welcome to Mukoko</h1>
            <p className="text-text-secondary mb-6">
              Sign in to save articles, personalize your feed, and sync across
              devices.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setShowSignIn(true)}
                className="px-6 py-3 bg-primary text-white font-medium rounded-xl hover:opacity-90 transition-opacity"
              >
                Sign In
              </button>
              <button
                onClick={() => setShowSignIn(true)}
                className="px-6 py-3 bg-surface border border-elevated text-foreground font-medium rounded-xl hover:bg-elevated transition-colors"
              >
                Create Account
              </button>
            </div>
          </div>
        )}

        {/* Settings */}
        <div className="bg-surface border border-elevated rounded-2xl overflow-hidden">
          <h2 className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary border-b border-elevated">
            Settings
          </h2>

          {/* Theme Toggle */}
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

          {/* Notifications */}
          <button className="w-full flex items-center justify-between px-4 py-4 hover:bg-elevated transition-colors">
            <div className="flex items-center gap-3">
              <Bell className="w-5 h-5" />
              <span className="font-medium">Notifications</span>
            </div>
            <ChevronRight className="w-4 h-4 text-text-tertiary" />
          </button>
        </div>

        {/* About */}
        <div className="bg-surface border border-elevated rounded-2xl overflow-hidden mt-6">
          <h2 className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary border-b border-elevated">
            About
          </h2>

          <Link
            href="/help"
            className="flex items-center justify-between px-4 py-4 hover:bg-elevated transition-colors border-b border-elevated"
          >
            <div className="flex items-center gap-3">
              <HelpCircle className="w-5 h-5" />
              <span className="font-medium">Help Center</span>
            </div>
            <ChevronRight className="w-4 h-4 text-text-tertiary" />
          </Link>

          <Link
            href="/terms"
            className="flex items-center justify-between px-4 py-4 hover:bg-elevated transition-colors border-b border-elevated"
          >
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5" />
              <span className="font-medium">Terms of Service</span>
            </div>
            <ChevronRight className="w-4 h-4 text-text-tertiary" />
          </Link>

          <Link
            href="/privacy"
            className="flex items-center justify-between px-4 py-4 hover:bg-elevated transition-colors"
          >
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5" />
              <span className="font-medium">Privacy Policy</span>
            </div>
            <ChevronRight className="w-4 h-4 text-text-tertiary" />
          </Link>
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-sm text-text-tertiary">
          <p>Mukoko News v1.0.0</p>
          <p className="mt-1">A Mukoko Product by Nyuchi Africa</p>
        </div>
      </div>
    );
  }

  // Signed-in view
  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

  return (
    <div className="max-w-[600px] mx-auto px-6 py-12">
      <div className="text-center mb-10">
        <div className="w-24 h-24 bg-gradient-to-br from-primary to-secondary rounded-full flex items-center justify-center mx-auto mb-6">
          <User className="w-12 h-12 text-white" />
        </div>
        <h1 className="font-serif text-2xl font-bold mb-1">{displayName}</h1>
        <p className="text-text-secondary">{user.email}</p>
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
            <Bell className="w-5 h-5" />
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

      <div className="text-center mt-8 text-sm text-text-tertiary">
        <p>Mukoko News v1.0.0</p>
        <p className="mt-1">A Mukoko Product by Nyuchi Africa</p>
      </div>
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

"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { api } from "@/lib/api";

interface AuthUser {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  person_id?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  isAuthenticated: boolean;
  sendOTP: (email: string) => Promise<{ success: boolean; error?: string }>;
  verifyOTP: (email: string, otp: string, fullName?: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const SESSION_KEY = "mukoko_session_token";
// NOTE: Session token is stored in localStorage + mirrored to a non-HttpOnly cookie.
// This is an XSS risk — the long-term fix is to have the backend set an HttpOnly
// cookie via Set-Cookie header on /api/auth/otp/email/verify response.
// Tracked for the next iteration when we add a Next.js API route proxy.

function setSessionCookie(token: string) {
  const maxAge = 30 * 24 * 60 * 60; // 30 days, matches Stytch session duration
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${SESSION_KEY}=${token}; path=/; max-age=${maxAge}; SameSite=Lax${secure}`;
}

function clearSessionCookie() {
  document.cookie = `${SESSION_KEY}=; path=/; max-age=0`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    const token = localStorage.getItem(SESSION_KEY);
    if (!token) {
      setLoading(false);
      return;
    }

    // Keep cookie in sync for middleware
    setSessionCookie(token);

    api.auth
      .getMe()
      .then((res) => {
        const u = res.user;
        setUser({
          id: String(u.id ?? ""),
          name: u.name as string | undefined,
          email: u.email as string | undefined,
          role: u.role as string | undefined,
          person_id: u.person_id as string | undefined,
        });
      })
      .catch(() => {
        localStorage.removeItem(SESSION_KEY);
        clearSessionCookie();
      })
      .finally(() => setLoading(false));
  }, []);

  const sendOTP = useCallback(async (email: string) => {
    try {
      await api.auth.sendOTP(email);
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "Failed to send code" };
    }
  }, []);

  const verifyOTP = useCallback(async (email: string, otp: string, fullName?: string) => {
    try {
      const res = await api.auth.verifyOTP(email, otp, fullName);
      // Store Stytch session token
      localStorage.setItem(SESSION_KEY, res.session_token);
      setSessionCookie(res.session_token);

      const u = res.user;
      setUser({
        id: String(u.id ?? ""),
        name: u.name as string | undefined,
        email: u.email as string | undefined,
        role: u.role as string | undefined,
        person_id: u.person_id as string | undefined,
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "Invalid code" };
    }
  }, []);

  const signOut = useCallback(async () => {
    // Revoke session server-side
    try { await api.auth.logout(); } catch { /* best-effort */ }
    localStorage.removeItem(SESSION_KEY);
    clearSessionCookie();
    setUser(null);
    window.location.href = "/sign-in";
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: !!user,
        sendOTP,
        verifyOTP,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

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

function setAuthCookie(token: string) {
  const maxAge = 30 * 24 * 60 * 60; // 30 days, matches JWT expiry
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `mukoko_news_token=${token}; path=/; max-age=${maxAge}; SameSite=Lax${secure}`;
}

function clearAuthCookie() {
  document.cookie = 'mukoko_news_token=; path=/; max-age=0';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    const token = localStorage.getItem("mukoko_news_token");
    if (!token) {
      setLoading(false);
      return;
    }

    setAuthCookie(token);

    api.auth
      .getMe()
      .then((res) => {
        const u = res.user;
        setUser({ id: String(u.id ?? ""), name: u.name as string | undefined, email: u.email as string | undefined, role: u.role as string | undefined, person_id: u.person_id as string | undefined });
      })
      .catch(() => {
        localStorage.removeItem("mukoko_news_token");
        localStorage.removeItem("mukoko_news_person_id");
        clearAuthCookie();
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
      localStorage.setItem("mukoko_news_token", res.token);
      setAuthCookie(res.token);
      if (res.person_id) {
        localStorage.setItem("mukoko_news_person_id", res.person_id);
      }
      const u = res.user;
      setUser({ id: String(u.id ?? ""), name: u.name as string | undefined, email: u.email as string | undefined, role: u.role as string | undefined, person_id: u.person_id as string | undefined });
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "Invalid code" };
    }
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem("mukoko_news_token");
    localStorage.removeItem("mukoko_news_person_id");
    clearAuthCookie();
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

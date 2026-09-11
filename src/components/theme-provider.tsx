"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

import {
  applyOutlinePreference,
  readOutlinePreference,
  storeOutlinePreference,
  type OutlinePreference,
} from "@/lib/appearance";

export type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

/**
 * Contrast is part of the THEME (owner direction 2026-09-11 — *"the contrast
 * switcher is part of the theme"*).
 *
 * It used to be a separate preference with its own provider-less state, read
 * and written directly by the one card that rendered it. Nothing else in the
 * app could ask what it was set to, so nothing else could react to it — and a
 * reader who changed it saw the control's own tick move and, in dark mode,
 * nothing else (the edge it switched on was a 2% step; see `--outline` in
 * `globals.css`). Two settings that are both "how the app looks", stored the
 * same way and applied to the same element, belong behind one provider.
 *
 * The storage key and the attribute still live in `@/lib/appearance`, because
 * the pre-paint bootstrap in `layout.tsx` repeats them as string literals and
 * cannot import anything. This provider is the only runtime writer.
 */
interface ThemeContextType {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
  /** `off` (default) | `on` | `system` — see `OutlinePreference`. */
  contrast: OutlinePreference;
  setContrast: (contrast: OutlinePreference) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "mukoko-news-theme"
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(defaultTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("dark");
  const [contrast, setContrastState] = useState<OutlinePreference>("off");
  const [mounted, setMounted] = useState(false);

  // Initial theme detection from localStorage
  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem(storageKey) as Theme | null;
    if (stored && (stored === "light" || stored === "dark" || stored === "system")) {
      setTheme(stored);
    }
    // Contrast is read the same way and at the same moment. Reading it here is
    // a paint late, but the pre-paint bootstrap has already set the attribute,
    // so the PAGE is never wrong — this only syncs the controls to it.
    setContrastState(readOutlinePreference());
  }, [storageKey]);

  // One writer. Storing without applying leaves the page unchanged until a
  // reload, which is exactly what "the switcher does nothing" looks like.
  const setContrast = (next: OutlinePreference) => {
    setContrastState(next);
    storeOutlinePreference(next);
    applyOutlinePreference(next, document.documentElement);
  };

  // Resolve the actual theme (light or dark) based on theme setting
  useEffect(() => {
    if (!mounted) return;

    if (theme === "system") {
      setResolvedTheme(getSystemTheme());
    } else {
      setResolvedTheme(theme);
    }
  }, [theme, mounted]);

  // Listen for system preference changes when in system mode
  useEffect(() => {
    if (!mounted || theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      setResolvedTheme(e.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [mounted, theme]);

  // Update document class and localStorage when theme changes
  useEffect(() => {
    if (!mounted) return;

    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(resolvedTheme);
    localStorage.setItem(storageKey, theme);
  }, [theme, resolvedTheme, mounted, storageKey]);

  // Cycle through: dark → light → system → dark
  const cycleTheme = () => {
    setTheme((prev) => {
      if (prev === "dark") return "light";
      if (prev === "light") return "system";
      return "dark";
    });
  };

  // Children render immediately (including during SSR) — the theme-bootstrap
  // inline script in layout.tsx applies the stored theme class before first
  // paint, so there is no flash of the wrong theme. Returning null until
  // mounted (the old behaviour) blanked out every server-rendered page and
  // forced a client-only first paint.
  return (
    <ThemeContext.Provider
      value={{ theme, resolvedTheme, setTheme, cycleTheme, contrast, setContrast }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

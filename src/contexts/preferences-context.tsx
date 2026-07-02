"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { COUNTRIES, DEFAULT_FEED_COUNTRIES } from "@/lib/constants";

// Re-export for backwards compatibility
export { COUNTRIES } from "@/lib/constants";

interface PreferencesContextType {
  // Countries
  selectedCountries: string[];
  primaryCountry: string | null;
  toggleCountry: (code: string) => void;
  setPrimaryCountry: (code: string) => void;

  // Categories
  selectedCategories: string[];
  toggleCategory: (id: string) => void;

  // Onboarding
  hasCompletedOnboarding: boolean;
  completeOnboarding: () => void;
  showOnboarding: boolean;
  setShowOnboarding: (show: boolean) => void;

  // Reset
  resetPreferences: () => void;
}

const PreferencesContext = createContext<PreferencesContextType | null>(null);

const STORAGE_KEYS = {
  countries: "mukoko-countries",
  primaryCountry: "mukoko-primary-country",
  categories: "mukoko-categories",
  onboarding: "mukoko-onboarding-complete",
};

export function PreferencesProvider({ children }: { children: ReactNode }) {
  // Initialise with the server-side defaults so SSR HTML (rendered with these
  // values) matches the first client render — stored preferences are applied
  // in an effect after hydration.
  const [selectedCountries, setSelectedCountries] = useState<string[]>(DEFAULT_FEED_COUNTRIES);
  const [primaryCountry, setPrimaryCountryState] = useState<string | null>(
    DEFAULT_FEED_COUNTRIES[0] ?? null
  );
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load preferences from localStorage
  useEffect(() => {
    try {
      const countries = localStorage.getItem(STORAGE_KEYS.countries);
      const primary = localStorage.getItem(STORAGE_KEYS.primaryCountry);
      const categories = localStorage.getItem(STORAGE_KEYS.categories);
      const onboarding = localStorage.getItem(STORAGE_KEYS.onboarding);

      if (countries) {
        const parsed = JSON.parse(countries);
        if (Array.isArray(parsed)) {
          setSelectedCountries(parsed);
        } else {
          setSelectedCountries([...DEFAULT_FEED_COUNTRIES]);
        }
      } else {
        setSelectedCountries([...DEFAULT_FEED_COUNTRIES]);
      }

      if (primary) {
        setPrimaryCountryState(primary);
      } else {
        setPrimaryCountryState(DEFAULT_FEED_COUNTRIES[0] ?? null);
      }

      if (categories) {
        const parsed = JSON.parse(categories);
        if (Array.isArray(parsed)) {
          setSelectedCategories(parsed);
        }
      }

      const completed = onboarding === "true";
      setHasCompletedOnboarding(completed);

      if (!completed) {
        setShowOnboarding(true);
      }
    } catch (error) {
      console.error("Failed to read preferences from localStorage:", error);
      setSelectedCountries([...DEFAULT_FEED_COUNTRIES]);
      setPrimaryCountryState(DEFAULT_FEED_COUNTRIES[0] ?? null);
      setSelectedCategories(["all"]);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  // Save countries
  useEffect(() => {
    if (isLoaded) {
      try {
        localStorage.setItem(STORAGE_KEYS.countries, JSON.stringify(selectedCountries));
      } catch (error) {
        console.error("Failed to save countries:", error);
      }
    }
  }, [selectedCountries, isLoaded]);

  // Save primary country
  useEffect(() => {
    if (isLoaded) {
      try {
        if (primaryCountry) {
          localStorage.setItem(STORAGE_KEYS.primaryCountry, primaryCountry);
        } else {
          localStorage.removeItem(STORAGE_KEYS.primaryCountry);
        }
      } catch (error) {
        console.error("Failed to save primary country:", error);
      }
    }
  }, [primaryCountry, isLoaded]);

  // Save categories
  useEffect(() => {
    if (isLoaded) {
      try {
        localStorage.setItem(STORAGE_KEYS.categories, JSON.stringify(selectedCategories));
      } catch (error) {
        console.error("Failed to save categories:", error);
      }
    }
  }, [selectedCategories, isLoaded]);

  // Sync primaryCountry when selectedCountries changes
  // Kept outside toggleCountry to avoid stale closure over primaryCountry
  useEffect(() => {
    if (!isLoaded) return;
    if (selectedCountries.length === 0) {
      setPrimaryCountryState(null);
    } else if (!primaryCountry || !selectedCountries.includes(primaryCountry)) {
      setPrimaryCountryState(selectedCountries[0]);
    }
  }, [selectedCountries, isLoaded, primaryCountry]);

  const toggleCountry = (code: string) => {
    setSelectedCountries((prev) =>
      prev.includes(code)
        ? prev.filter((c) => c !== code)
        : [...prev, code]
    );
  };

  const setPrimaryCountry = (code: string) => {
    if (selectedCountries.includes(code)) {
      setPrimaryCountryState(code);
    }
  };

  const toggleCategory = (id: string) => {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const completeOnboarding = () => {
    setHasCompletedOnboarding(true);
    setShowOnboarding(false);
    try {
      localStorage.setItem(STORAGE_KEYS.onboarding, "true");
    } catch (error) {
      console.error("Failed to save onboarding state:", error);
    }
  };

  const resetPreferences = () => {
    setSelectedCountries([]);
    setPrimaryCountryState(null);
    setSelectedCategories([]);
    setHasCompletedOnboarding(false);
    try {
      Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      console.error("Failed to clear preferences:", error);
    }
  };

  // Children render immediately (including during SSR) with the default
  // preferences above; stored preferences are applied post-hydration. Gating
  // on isLoaded here used to return null, which blanked out every
  // server-rendered page and forced a client-only first paint.
  return (
    <PreferencesContext.Provider
      value={{
        selectedCountries,
        primaryCountry,
        toggleCountry,
        setPrimaryCountry,
        selectedCategories,
        toggleCategory,
        hasCompletedOnboarding,
        completeOnboarding,
        showOnboarding,
        setShowOnboarding,
        resetPreferences,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error("usePreferences must be used within PreferencesProvider");
  }
  return context;
}

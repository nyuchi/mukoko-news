'use client';

import { useEffect, useState } from 'react';
import { Check, Globe2, Loader2, Tag } from 'lucide-react';
import { usePreferences } from '@/contexts/preferences-context';
import { COUNTRIES, getCategoryEmoji } from '@/lib/constants';
import { getCategoriesAction } from '@/lib/actions/feed';
import type { Category } from '@/lib/api';

/**
 * Feed preferences on /profile.
 *
 * These settings already existed in `PreferencesContext` and were already
 * persisted — but the ONLY places to change them were the first-run onboarding
 * modal and the home feed's inline picker. Once onboarding was dismissed there
 * was no way back to them, which is why the profile page read as empty: the
 * data was there, the surface was not.
 *
 * Scope note: this is still per-device (localStorage). Carrying interests to the
 * signed-in account so they follow the user across devices and across the other
 * Mukoko apps means writing `identity.persons.interests`, and the gateway is the
 * only writer of that domain — see the note on the profile page.
 */
export function ProfilePreferences() {
  const {
    selectedCountries,
    primaryCountry,
    toggleCountry,
    setPrimaryCountry,
    selectedCategories,
    toggleCategory,
  } = usePreferences();

  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getCategoriesAction()
      .then((rows) => {
        if (active) setCategories(rows);
      })
      .catch((error) => {
        // A failed category load must not blank the whole settings page — the
        // country picker below is independent and still usable.
        console.error('Failed to load categories:', error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="bg-surface border border-elevated rounded-2xl overflow-hidden mb-6">
      <h2 className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary border-b border-elevated">
        Your feed
      </h2>

      {/* Countries */}
      <div className="px-4 py-4 border-b border-elevated">
        <div className="flex items-center gap-2 mb-1">
          <Globe2 className="w-4 h-4 text-secondary" aria-hidden="true" />
          <span className="font-medium">Countries</span>
        </div>
        <p className="text-xs text-text-tertiary mb-3">
          Which countries your feed draws from. Tap a selected country again to make it your
          primary.
        </p>
        <div className="flex flex-wrap gap-2">
          {COUNTRIES.map((country) => {
            const active = selectedCountries.includes(country.code);
            const isPrimary = primaryCountry === country.code;
            return (
              <button
                key={country.code}
                type="button"
                onClick={() => (active && !isPrimary ? setPrimaryCountry(country.code) : toggleCountry(country.code))}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 px-3 min-h-[var(--touch-chip,31px)] rounded-full text-sm border transition-colors ${
                  isPrimary
                    ? 'bg-primary text-on-primary border-transparent font-medium'
                    : active
                      ? 'bg-container-tanzanite text-on-container-tanzanite border-transparent'
                      : 'bg-background border-elevated text-text-secondary hover:bg-elevated'
                }`}
              >
                <span aria-hidden="true">{country.flag}</span>
                {country.name}
                {isPrimary && <span className="text-[10px] uppercase tracking-wide">Primary</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Interest categories */}
      <div className="px-4 py-4">
        <div className="flex items-center gap-2 mb-1">
          <Tag className="w-4 h-4 text-secondary" aria-hidden="true" />
          <span className="font-medium">Interests</span>
        </div>
        <p className="text-xs text-text-tertiary mb-3">
          Topics to surface first. Choosing none shows you everything.
        </p>
        {loading ? (
          <div className="flex items-center gap-2 text-text-tertiary text-sm py-2">
            <Loader2 className="w-4 h-4 animate-spin" aria-label="Loading interests" />
            Loading interests…
          </div>
        ) : categories.length === 0 ? (
          <p className="text-sm text-text-tertiary py-2">Interests are unavailable right now.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => {
              const active = selectedCategories.includes(category.id);
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => toggleCategory(category.id)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 px-3 min-h-[var(--touch-chip,31px)] rounded-full text-sm border transition-colors ${
                    active
                      ? 'bg-container-tanzanite text-on-container-tanzanite border-transparent'
                      : 'bg-background border-elevated text-text-secondary hover:bg-elevated'
                  }`}
                >
                  <span aria-hidden="true">{getCategoryEmoji(category.slug ?? category.id)}</span>
                  {category.name}
                  {active && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

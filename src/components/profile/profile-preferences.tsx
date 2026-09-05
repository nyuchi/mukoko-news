'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Globe2, Loader2, Star, Tag } from 'lucide-react';
import { MultiSelect, SelectedBadge, type MultiSelectOption } from '@/components/ui/multi-select';
import { updateInterestsAction } from '@/lib/actions/profile';
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
 * Interests persist to `identity.persons.interests` for a signed-in user, so
 * they follow the account across devices and across the other Mukoko apps, and
 * are mirrored into the local context so the feed reacts immediately. For a
 * signed-out reader they stay in localStorage, which is the only place they can
 * live without an account.
 *
 * Countries remain local-only: the person record has no country field, and
 * inventing one in another domain's schema is the exact failure mode this
 * platform's SSOT rules exist to prevent (the validators are `moderate` and
 * would accept it silently). Where a feed-country preference should live is a
 * schema decision, not one to make from a settings form.
 */
export function ProfilePreferences({
  signedIn = false,
  initialInterests,
}: {
  signedIn?: boolean;
  initialInterests?: string[];
}) {
  const {
    selectedCountries,
    primaryCountry,
    toggleCountry,
    setPrimaryCountry,
    selectedCategories,
    toggleCategory,
  } = usePreferences();

  const [categories, setCategories] = useState<Category[]>([]);

  // The option lists the two pickers choose from. Memoised so the dropdown does
  // not rebuild 54 objects on every keystroke in its own search field.
  const countryOptions = useMemo<MultiSelectOption[]>(
    () => COUNTRIES.map((c) => ({ value: c.code, label: c.name, icon: c.flag })),
    []
  );
  const interestOptions = useMemo<MultiSelectOption[]>(
    () =>
      categories.map((c) => ({
        value: c.id,
        label: c.name,
        icon: getCategoryEmoji(c.slug ?? c.id),
      })),
    [categories]
  );
  const [loading, setLoading] = useState(true);
  const [savingInterests, setSavingInterests] = useState(false);
  const [interestError, setInterestError] = useState<string | null>(null);

  // Seed the local context from the account record on first load so a user who
  // set interests on another device sees them here rather than an empty set.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !signedIn || !initialInterests) return;
    seeded.current = true;
    for (const slug of initialInterests) {
      if (!selectedCategories.includes(slug)) toggleCategory(slug);
    }
  }, [signedIn, initialInterests, selectedCategories, toggleCategory]);

  /**
   * Toggle locally first so the chip responds immediately, then persist the
   * resulting set for a signed-in user. The context is the source for what the
   * feed renders; the account record is what survives the device.
   */
  async function onToggleCategory(id: string) {
    const next = selectedCategories.includes(id)
      ? selectedCategories.filter((c) => c !== id)
      : [...selectedCategories, id];
    toggleCategory(id);
    if (!signedIn) return;

    setSavingInterests(true);
    setInterestError(null);
    const result = await updateInterestsAction(next);
    setSavingInterests(false);
    if (!result.ok) {
      // Say so rather than leaving a chip that looks saved but is not.
      setInterestError('Saved on this device only — could not reach your account.');
    }
  }

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
        <p id="countries-hint" className="text-xs text-text-tertiary mb-3">
          Which countries your feed draws from. Select a country below; tap one of your chosen
          countries to make it your primary.
        </p>
        <MultiSelect
          options={countryOptions}
          selected={selectedCountries}
          onToggle={toggleCountry}
          triggerLabel="Add a country"
          searchPlaceholder="Search countries"
          emptyText="No country matches that."
          aria-describedby="countries-hint"
          renderBadge={(option) => {
            const isPrimary = primaryCountry === option.value;
            return (
              <SelectedBadge
                option={option}
                tone={isPrimary ? 'primary' : 'default'}
                onRemove={() => toggleCountry(option.value)}
              >
                <button
                  type="button"
                  onClick={() => setPrimaryCountry(option.value)}
                  aria-pressed={isPrimary}
                  title={isPrimary ? `${option.label} is your primary country` : `Make ${option.label} your primary country`}
                  className="inline-flex items-center gap-1.5"
                >
                  <span aria-hidden="true">{option.icon}</span>
                  {option.label}
                  {isPrimary ? (
                    <>
                      <Star className="w-3 h-3 fill-current" aria-hidden="true" />
                      <span className="sr-only">(primary)</span>
                    </>
                  ) : null}
                </button>
              </SelectedBadge>
            );
          }}
        />
      </div>

      {/* Interest categories */}
      <div className="px-4 py-4">
        <div className="flex items-center gap-2 mb-1">
          <Tag className="w-4 h-4 text-secondary" aria-hidden="true" />
          <span className="font-medium">Interests</span>
        </div>
        <p className="text-xs text-text-tertiary mb-3">
          Topics to surface first. Choosing none shows you everything.
          {signedIn && ' Saved to your Mukoko account, so they follow you across devices.'}
        </p>
        {interestError && (
          <p role="alert" className="text-xs text-warning mb-3">
            {interestError}
          </p>
        )}
        {savingInterests && (
          <p role="status" className="text-xs text-text-tertiary mb-3">
            Saving…
          </p>
        )}
        {loading ? (
          <div className="flex items-center gap-2 text-text-tertiary text-sm py-2">
            <Loader2 className="w-4 h-4 animate-spin" aria-label="Loading interests" />
            Loading interests…
          </div>
        ) : categories.length === 0 ? (
          <p className="text-sm text-text-tertiary py-2">Interests are unavailable right now.</p>
        ) : (
          <MultiSelect
            options={interestOptions}
            selected={selectedCategories}
            onToggle={onToggleCategory}
            triggerLabel="Add an interest"
            searchPlaceholder="Search interests"
            emptyText="No interest matches that."
            disabled={savingInterests}
          />
        )}
      </div>
    </div>
  );
}

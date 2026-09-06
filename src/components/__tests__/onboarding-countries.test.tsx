import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PreferencesProvider } from '@/contexts/preferences-context';

/**
 * The onboarding country quick-picks.
 *
 * The list used to be `COUNTRIES.slice(0, 4)` — the first four entries of a
 * hand-ordered constant, which is the "East Africa" block at the top of the
 * array. Measured on the live corpus that offered Tanzania (368 articles in the
 * last 30 days) and omitted Nigeria (8,648 in the same window, the largest
 * country in the corpus). These tests pin the ordering to coverage, and pin the
 * fallback that keeps the step usable when the read cannot answer.
 */

const mockCategories = vi.fn();
const mockCountries = vi.fn();
const mockCountryList = vi.fn();

vi.mock('@/lib/actions/feed', () => ({
  getCategoriesAction: () => mockCategories(),
  getTopCountriesAction: (limit: number) => mockCountries(limit),
  // The country list itself now comes from `places`, the domain that owns
  // geography — `getTopCountriesAction` only says which of them the corpus is
  // publishing. Two reads, two different questions.
  getCountriesAction: () => mockCountryList(),
}));

import { OnboardingModal } from '../onboarding-modal';

function renderModal() {
  return render(
    <PreferencesProvider>
      <OnboardingModal />
    </PreferencesProvider>
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  mockCategories.mockResolvedValue([]);
  const { STATIC_COUNTRIES } = await import('@/lib/countries');
  mockCountryList.mockResolvedValue(STATIC_COUNTRIES);
});

describe('onboarding country quick-picks', () => {
  it('offers the countries the corpus actually publishes, in that order', async () => {
    mockCountries.mockResolvedValue(
      // The real top six by last-30-day volume.
      ['NG', 'ZA', 'GH', 'ZW', 'SN', 'KE'].map((code) => ({ code, recent: 1 }))
    );
    renderModal();

    await waitFor(() => expect(screen.getByText(/Nigeria/)).toBeInTheDocument());
    for (const name of ['South Africa', 'Ghana', 'Zimbabwe', 'Senegal', 'Kenya']) {
      expect(screen.getByText(new RegExp(name))).toBeInTheDocument();
    }
    // Tanzania is 15th by volume — it must no longer displace a busier country.
    expect(screen.queryByText(/Tanzania/)).not.toBeInTheDocument();
  });

  it('asks for exactly the number of quick-picks it renders', async () => {
    mockCountries.mockResolvedValue([{ code: 'NG', recent: 1 }]);
    renderModal();
    await waitFor(() => expect(mockCountries).toHaveBeenCalled());
    expect(mockCountries).toHaveBeenCalledWith(6);
  });

  it('drops a covered code that no country record matches', async () => {
    // A code the corpus carries but `places` does not know must not render as a
    // nameless chip. Note this is NOT the same as a country `places` knows and
    // this app has no flag for — that one is listed, with a placeholder flag,
    // because the list is governed by which countries exist.
    mockCountries.mockResolvedValue([
      { code: 'NG', recent: 10 },
      { code: 'XX', recent: 5 },
    ]);
    renderModal();
    await waitFor(() => expect(screen.getByText(/Nigeria/)).toBeInTheDocument());
    expect(screen.queryByText(/XX/)).not.toBeInTheDocument();
  });

  it('falls back to the static list when the read fails', async () => {
    // A stale set of options beats an onboarding step with no options at all.
    mockCountries.mockRejectedValue(new Error('cluster down'));
    renderModal();
    await waitFor(() => expect(screen.getByText(/Zimbabwe/)).toBeInTheDocument());
    expect(screen.getByText(/Kenya/)).toBeInTheDocument();
  });

  it('falls back to the static list when the read returns nothing', async () => {
    mockCountries.mockResolvedValue([]);
    renderModal();
    await waitFor(() => expect(screen.getByText(/Zimbabwe/)).toBeInTheDocument());
  });
});

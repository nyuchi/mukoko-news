/**
 * Tests for OnboardingModal component
 * Tests rendering, country selection, and accessibility
 * Note: Category tests are limited due to mock complexity with async loading
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { OnboardingModal } from '../onboarding-modal';
import { PreferencesProvider } from '@/contexts/preferences-context';

// Mock the entire api module
vi.mock('@/lib/api', () => ({
  api: {
    getCategories: vi.fn(() => Promise.resolve({
      categories: [
        { id: 'politics', name: 'Politics', slug: 'politics' },
        { id: 'sports', name: 'Sports', slug: 'sports' },
        { id: 'economy', name: 'Economy', slug: 'economy' },
      ]
    })),
  },
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((i: number) => Object.keys(store)[i] || null),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('OnboardingModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderWithProvider = () => {
    return render(
      <PreferencesProvider>
        <OnboardingModal />
      </PreferencesProvider>
    );
  };

  describe('visibility', () => {
    it('should render when onboarding not completed', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('Welcome to Mukoko')).toBeInTheDocument();
      });
    });

    it('should not render when onboarding is completed', () => {
      localStorageMock.setItem('mukoko-onboarding-complete', 'true');

      renderWithProvider();

      expect(screen.queryByText('Welcome to Mukoko')).not.toBeInTheDocument();
    });
  });

  describe('rendering', () => {
    it('should display welcome header', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('Welcome to Mukoko')).toBeInTheDocument();
        expect(screen.getByText('Personalize your news (optional)')).toBeInTheDocument();
      });
    });

    it('should display country options', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('Your region')).toBeInTheDocument();
        expect(screen.getByText(/Zimbabwe/)).toBeInTheDocument();
      });
    });

    it('should display Topics you like section', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('Topics you like')).toBeInTheDocument();
      });
    });

    it('should have accessible dialog role', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });
  });

  describe('country selection', () => {
    it('should toggle country selection on click', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText(/Zimbabwe/)).toBeInTheDocument();
      });

      const zimbabweButton = screen.getByText(/Zimbabwe/).closest('button')!;
      const initialPressed = zimbabweButton.getAttribute('aria-pressed');

      await act(async () => {
        fireEvent.click(zimbabweButton);
      });

      await waitFor(() => {
        const newPressed = zimbabweButton.getAttribute('aria-pressed');
        expect(newPressed).not.toBe(initialPressed);
      });
    });

    it('should display multiple country options', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText(/Zimbabwe/)).toBeInTheDocument();
        expect(screen.getByText(/Kenya/)).toBeInTheDocument();
      });
    });
  });

  describe('button text', () => {
    it('should show "Show Me News" when nothing selected', async () => {
      localStorageMock.setItem('mukoko-countries', JSON.stringify([]));
      localStorageMock.setItem('mukoko-categories', JSON.stringify([]));

      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('Show Me News')).toBeInTheDocument();
      });
    });

    it('should show "Start Reading" when selections made', async () => {
      localStorageMock.setItem('mukoko-countries', JSON.stringify(['ZW']));

      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('Start Reading')).toBeInTheDocument();
      });
    });
  });

  describe('completing onboarding', () => {
    it('should complete onboarding when action button clicked', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('Welcome to Mukoko')).toBeInTheDocument();
      });

      const actionButton = screen.getByRole('button', { name: /Show Me News|Start Reading/ });
      fireEvent.click(actionButton);

      await waitFor(() => {
        expect(screen.queryByText('Welcome to Mukoko')).not.toBeInTheDocument();
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'mukoko-onboarding-complete',
        'true'
      );
    });

    it('should complete onboarding when close button clicked', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('Welcome to Mukoko')).toBeInTheDocument();
      });

      const closeButton = screen.getByLabelText('Close and skip onboarding');
      fireEvent.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByText('Welcome to Mukoko')).not.toBeInTheDocument();
      });
    });

    it('should complete onboarding when backdrop clicked', async () => {
      const { container } = renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('Welcome to Mukoko')).toBeInTheDocument();
      });

      const backdrop = container.querySelector('.bg-black\\/70');
      if (backdrop) fireEvent.click(backdrop);

      await waitFor(() => {
        expect(screen.queryByText('Welcome to Mukoko')).not.toBeInTheDocument();
      });
    });
  });

  describe('accessibility', () => {
    it('should have proper aria attributes', async () => {
      renderWithProvider();

      await waitFor(() => {
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAttribute('aria-labelledby', 'onboarding-title');
      });
    });

    it('should have labeled country group', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByRole('group', { name: /Your region/ })).toBeInTheDocument();
      });
    });
  });

  describe('customize hint', () => {
    it('should show hint about Discover page', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('Customize more in Discover')).toBeInTheDocument();
      });
    });
  });
});

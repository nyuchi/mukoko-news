import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BottomNav } from '../layout/bottom-nav';
import { IslandProvider } from '@/contexts/island-context';
import { BOTTOM_NAV_HREFS } from '@/lib/navigation';

// Mock next/navigation
const mockUsePathname = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}));

/**
 * The island reads what the current page contributed, so it needs the
 * provider. With nothing registered it falls back to plain navigation, which
 * is what every assertion below exercises.
 */
const renderIsland = () =>
  render(
    <IslandProvider>
      <BottomNav />
    </IslandProvider>
  );

describe('BottomNav', () => {
  beforeEach(() => {
    mockUsePathname.mockReset();
  });

  it('should render navigation on home page', () => {
    mockUsePathname.mockReturnValue('/');

    renderIsland();

    expect(screen.getByRole('navigation', { name: /main navigation/i })).toBeInTheDocument();
    expect(screen.getByText('Feed')).toBeInTheDocument();
    expect(screen.getByText('Discover')).toBeInTheDocument();
    expect(screen.getByText('Bytes')).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
  });

  // These two used to assert the OPPOSITE, and that is the bug this change
  // fixes. The bar returned null on /newsbytes and on every article page, so
  // the two surfaces a reader is most likely to arrive on from a shared link
  // were the two with no visible route anywhere else — the only ways out were
  // the browser's back gesture or knowing to tap the wordmark. TikTok, the
  // reference for both surfaces, keeps its bar up over fullscreen video and
  // moves the CONTENT actions to a side rail; that is what this app does now.
  it('renders on NewsBytes, over the video', () => {
    mockUsePathname.mockReturnValue('/newsbytes');

    renderIsland();

    expect(screen.getByRole('navigation', { name: /main navigation/i })).toBeInTheDocument();
  });

  it('renders on article pages', () => {
    mockUsePathname.mockReturnValue('/article/123');

    renderIsland();

    expect(screen.getByRole('navigation', { name: /main navigation/i })).toBeInTheDocument();
  });

  it('renders nothing inside the embed iframe', () => {
    // The one place our navigation does not belong: our markup inside
    // somebody else's page.
    mockUsePathname.mockReturnValue('/embed/iframe');

    const { container } = renderIsland();

    expect(container.firstChild).toBeNull();
  });

  it('carries its own dark ground over full-bleed video', () => {
    // Over a playing frame the translucent page background has nothing to sit
    // against, so the pill would dissolve into whatever is behind it.
    mockUsePathname.mockReturnValue('/newsbytes');

    renderIsland();

    const nav = screen.getByRole('navigation', { name: /main navigation/i });
    expect(nav).toHaveClass('bg-black/70');
    expect(nav).not.toHaveClass('bg-background/90');
  });

  it('should render on discover page', () => {
    mockUsePathname.mockReturnValue('/discover');

    renderIsland();

    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('should highlight active link', () => {
    mockUsePathname.mockReturnValue('/discover');

    renderIsland();

    const discoverLink = screen.getByRole('link', { name: /discover/i });
    expect(discoverLink).toHaveClass('text-primary');
    expect(discoverLink).toHaveAttribute('aria-current', 'page');
  });

  it('should not highlight inactive links', () => {
    mockUsePathname.mockReturnValue('/');

    renderIsland();

    const discoverLink = screen.getByRole('link', { name: /discover/i });
    expect(discoverLink).not.toHaveClass('text-primary');
    expect(discoverLink).not.toHaveAttribute('aria-current');
  });

  it('should have correct href for all navigation items', () => {
    mockUsePathname.mockReturnValue('/');

    renderIsland();

    expect(screen.getByRole('link', { name: /feed/i })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /discover/i })).toHaveAttribute('href', '/discover');
    expect(screen.getByRole('link', { name: /bytes/i })).toHaveAttribute('href', '/newsbytes');
    expect(screen.getByRole('link', { name: /saved/i })).toHaveAttribute('href', '/saved');
    expect(screen.getByRole('link', { name: /profile/i })).toHaveAttribute('href', '/profile');
  });

  it('should render on saved page', () => {
    mockUsePathname.mockReturnValue('/saved');

    renderIsland();

    expect(screen.getByRole('navigation')).toBeInTheDocument();
    const savedLink = screen.getByRole('link', { name: /saved/i });
    expect(savedLink).toHaveAttribute('aria-current', 'page');
  });

  it('should render on profile page', () => {
    mockUsePathname.mockReturnValue('/profile');

    renderIsland();

    expect(screen.getByRole('navigation')).toBeInTheDocument();
    const profileLink = screen.getByRole('link', { name: /profile/i });
    expect(profileLink).toHaveAttribute('aria-current', 'page');
  });

  it('should render on article sub-routes (anchored regex)', () => {
    mockUsePathname.mockReturnValue('/article/123/comments');

    renderIsland();

    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('takes its slots from the shared destination registry', () => {
    // The bar, the nav drawer and /profile all read `@/lib/navigation` now.
    // Before that each surface carried its own array and they had drifted far
    // enough that no surface in the app could reach every page. `pick()` throws on an unknown href, so a renamed route fails here
    // rather than silently shortening the bar to four items.
    mockUsePathname.mockReturnValue('/');

    renderIsland();

    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([...BOTTOM_NAV_HREFS]);
  });

  describe('floating pill design', () => {
    it('should float inset from the viewport edges (not flush bottom)', () => {
      mockUsePathname.mockReturnValue('/');

      renderIsland();

      const nav = screen.getByRole('navigation', { name: /main navigation/i });
      expect(nav).toHaveClass('fixed', 'left-4', 'right-4');
      expect(nav).not.toHaveClass('bottom-0');
    });

    it('is a pill, not a rounded rectangle', () => {
      // Owner decision: it floats because this is a web app with no OS tab bar
      // to dock against, and a floating bar is a pill. `rounded-2xl` read as a
      // card that happened to be sitting at the bottom of the screen.
      mockUsePathname.mockReturnValue('/');

      renderIsland();

      const nav = screen.getByRole('navigation', { name: /main navigation/i });
      expect(nav).toHaveClass('rounded-full');
      expect(nav).not.toHaveClass('rounded-2xl');
    });

    it('should lift above the home-indicator via the safe-area inset', () => {
      mockUsePathname.mockReturnValue('/');

      renderIsland();

      const nav = screen.getByRole('navigation', { name: /main navigation/i });
      expect(nav).toHaveClass('bottom-[calc(env(safe-area-inset-bottom,0px)_+_0.75rem)]');
    });

    it('should use the floating card styling (blur, border, shadow)', () => {
      mockUsePathname.mockReturnValue('/');

      renderIsland();

      const nav = screen.getByRole('navigation', { name: /main navigation/i });
      expect(nav).toHaveClass('bg-background/90', 'backdrop-blur-xl', 'border', 'shadow-lg');
      // …on a reading route. The immersive variant is asserted above.
    });

    it('should keep 48px minimum touch targets on nav items', () => {
      mockUsePathname.mockReturnValue('/');

      renderIsland();

      for (const link of screen.getAllByRole('link')) {
        expect(link).toHaveClass('min-h-12');
      }
    });
  });
});

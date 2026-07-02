import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BottomNav } from '../layout/bottom-nav';

// Mock next/navigation
const mockUsePathname = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}));

describe('BottomNav', () => {
  beforeEach(() => {
    mockUsePathname.mockReset();
  });

  it('should render navigation on home page', () => {
    mockUsePathname.mockReturnValue('/');

    render(<BottomNav />);

    expect(screen.getByRole('navigation', { name: /main navigation/i })).toBeInTheDocument();
    expect(screen.getByText('Feed')).toBeInTheDocument();
    expect(screen.getByText('Discover')).toBeInTheDocument();
    expect(screen.getByText('Bytes')).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
  });

  it('should not render on NewsBytes page', () => {
    mockUsePathname.mockReturnValue('/newsbytes');

    const { container } = render(<BottomNav />);

    expect(container.firstChild).toBeNull();
  });

  it('should not render on article pages', () => {
    mockUsePathname.mockReturnValue('/article/123');

    const { container } = render(<BottomNav />);

    expect(container.firstChild).toBeNull();
  });

  it('should render on discover page', () => {
    mockUsePathname.mockReturnValue('/discover');

    render(<BottomNav />);

    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('should highlight active link', () => {
    mockUsePathname.mockReturnValue('/discover');

    render(<BottomNav />);

    const discoverLink = screen.getByRole('link', { name: /discover/i });
    expect(discoverLink).toHaveClass('text-primary');
    expect(discoverLink).toHaveAttribute('aria-current', 'page');
  });

  it('should not highlight inactive links', () => {
    mockUsePathname.mockReturnValue('/');

    render(<BottomNav />);

    const discoverLink = screen.getByRole('link', { name: /discover/i });
    expect(discoverLink).not.toHaveClass('text-primary');
    expect(discoverLink).not.toHaveAttribute('aria-current');
  });

  it('should have correct href for all navigation items', () => {
    mockUsePathname.mockReturnValue('/');

    render(<BottomNav />);

    expect(screen.getByRole('link', { name: /feed/i })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /discover/i })).toHaveAttribute('href', '/discover');
    expect(screen.getByRole('link', { name: /bytes/i })).toHaveAttribute('href', '/newsbytes');
    expect(screen.getByRole('link', { name: /saved/i })).toHaveAttribute('href', '/saved');
    expect(screen.getByRole('link', { name: /profile/i })).toHaveAttribute('href', '/profile');
  });

  it('should render on saved page', () => {
    mockUsePathname.mockReturnValue('/saved');

    render(<BottomNav />);

    expect(screen.getByRole('navigation')).toBeInTheDocument();
    const savedLink = screen.getByRole('link', { name: /saved/i });
    expect(savedLink).toHaveAttribute('aria-current', 'page');
  });

  it('should render on profile page', () => {
    mockUsePathname.mockReturnValue('/profile');

    render(<BottomNav />);

    expect(screen.getByRole('navigation')).toBeInTheDocument();
    const profileLink = screen.getByRole('link', { name: /profile/i });
    expect(profileLink).toHaveAttribute('aria-current', 'page');
  });

  it('should render on article sub-routes (anchored regex)', () => {
    mockUsePathname.mockReturnValue('/article/123/comments');

    render(<BottomNav />);

    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  describe('floating pill design', () => {
    it('should float inset from the viewport edges (not flush bottom)', () => {
      mockUsePathname.mockReturnValue('/');

      render(<BottomNav />);

      const nav = screen.getByRole('navigation', { name: /main navigation/i });
      expect(nav).toHaveClass('fixed', 'left-4', 'right-4', 'rounded-2xl');
      expect(nav).not.toHaveClass('bottom-0');
    });

    it('should lift above the home-indicator via the safe-area inset', () => {
      mockUsePathname.mockReturnValue('/');

      render(<BottomNav />);

      const nav = screen.getByRole('navigation', { name: /main navigation/i });
      expect(nav).toHaveClass('bottom-[calc(env(safe-area-inset-bottom,0px)_+_0.75rem)]');
    });

    it('should use the floating card styling (blur, border, shadow)', () => {
      mockUsePathname.mockReturnValue('/');

      render(<BottomNav />);

      const nav = screen.getByRole('navigation', { name: /main navigation/i });
      expect(nav).toHaveClass('bg-background/90', 'backdrop-blur-xl', 'border', 'shadow-lg');
    });

    it('should keep 48px minimum touch targets on nav items', () => {
      mockUsePathname.mockReturnValue('/');

      render(<BottomNav />);

      for (const link of screen.getAllByRole('link')) {
        expect(link).toHaveClass('min-h-12');
      }
    });
  });
});

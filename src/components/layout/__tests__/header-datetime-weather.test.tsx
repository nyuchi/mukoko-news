import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Header } from '../header';
import { SidebarProvider } from '@/contexts/sidebar-context';

const mockPathname = vi.fn(() => '/');

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('../user-avatar', () => ({ UserAvatar: () => <div data-testid="user-avatar" /> }));
vi.mock('@/components/ui/app-icon', () => ({ AppIcon: () => <span data-testid="app-icon" /> }));

const mockFetchCurrentWeather = vi.fn();
vi.mock('@/lib/weather', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/weather')>();
  return { ...actual, fetchCurrentWeather: () => mockFetchCurrentWeather() };
});

/**
 * The header owns the sidebar toggle, so it genuinely requires this context —
 * that coupling is the feature, not an accident to be mocked away. Rendering
 * through the real provider also keeps the header's markup exactly as it
 * ships, which matters for a suite asserting where things SIT.
 */
const renderHeader = () => render(<SidebarProvider><Header /></SidebarProvider>);

describe('Header — date/time + weather strip placement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchCurrentWeather.mockResolvedValue(null);
  });

  // The strip kicks off a browser-side weather fetch on mount; flushing it
  // keeps the resolution inside act() so React does not warn.
  const flush = () => act(async () => {});

  it('rides inside the sticky header on reading surfaces', async () => {
    mockPathname.mockReturnValue('/');
    const { container } = renderHeader();

    const strip = screen.getByTestId('datetime-weather');
    expect(strip).toBeInTheDocument();
    // Inside the SAME sticky element the rest of the chrome lives in, so it
    // travels with the header and is picked up by the existing
    // [data-app-header] height observer instead of needing its own offset.
    const header = container.querySelector('[data-app-header]');
    expect(header?.contains(strip)).toBe(true);
    await flush();
  });

  it('appears on the other reading routes too', async () => {
    for (const path of ['/discover', '/search', '/saved', '/article/abc123']) {
      mockPathname.mockReturnValue(path);
      const { unmount } = renderHeader();
      expect(screen.getByTestId('datetime-weather')).toBeInTheDocument();
      await flush();
      unmount();
    }
  });

  it('is suppressed on NewsBytes, whose header is an immersive gradient scrim', () => {
    mockPathname.mockReturnValue('/newsbytes');
    renderHeader();
    expect(screen.queryByTestId('datetime-weather')).toBeNull();
  });

  it('is suppressed in the embed widget, which renders inside somebody else’s page', () => {
    // A widget on a third-party host must not carry our masthead — nor make a
    // cross-origin weather call that host never asked for.
    for (const path of ['/embed', '/embed/iframe']) {
      mockPathname.mockReturnValue(path);
      const { unmount } = renderHeader();
      expect(screen.queryByTestId('datetime-weather')).toBeNull();
      expect(mockFetchCurrentWeather).not.toHaveBeenCalled();
      unmount();
    }
  });
});

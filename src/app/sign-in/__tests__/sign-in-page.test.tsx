import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SignInPage from '../page';

// Owner doctrine (2026-07-09, superseding the 2026-07-02 inline-form doctrine):
// /sign-in redirects unauthenticated users to the WORKOS-HOSTED AuthKit page,
// which owns the whole flow (Magic Auth, passwords, passkeys, required MFA) and
// establishes the shared cross-app session. Already-signed-in users skip
// straight to `returnTo`. A callback failure (?error=…) renders a manual-retry
// error card instead of auto-redirecting (no redirect loop).
// next/navigation's redirect() throws.

const { mockWithAuth, mockGetSignInUrl, mockRedirect } = vi.hoisted(() => ({
  mockWithAuth: vi.fn(),
  mockGetSignInUrl: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('@workos-inc/authkit-nextjs', () => ({
  withAuth: mockWithAuth,
  getSignInUrl: mockGetSignInUrl,
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// AppIcon pulls in next/image + theme context — stub it to keep the test focused.
vi.mock('@/components/ui/app-icon', () => ({
  AppIcon: () => <div data-testid="app-icon" />,
}));

const HOSTED_URL = 'https://identity.nyuchi.com/authorize?client_id=client_123';

async function renderPage(returnTo?: string, error?: string) {
  const ui = await SignInPage({ searchParams: Promise.resolve({ returnTo, error }) });
  return render(ui);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWithAuth.mockResolvedValue({ user: null });
  mockGetSignInUrl.mockResolvedValue(HOSTED_URL);
});

describe('SignInPage (hosted AuthKit redirect)', () => {
  it('redirects unauthenticated users to the hosted AuthKit page', async () => {
    await expect(renderPage()).rejects.toThrow(`NEXT_REDIRECT:${HOSTED_URL}`);
    expect(mockGetSignInUrl).toHaveBeenCalledWith({ returnTo: '/profile' });
  });

  it('passes a safe returnTo through to the hosted URL', async () => {
    await expect(renderPage('/admin')).rejects.toThrow(`NEXT_REDIRECT:${HOSTED_URL}`);
    expect(mockGetSignInUrl).toHaveBeenCalledWith({ returnTo: '/admin' });
  });

  it('falls back to /profile for a protocol-relative returnTo (//evil.example)', async () => {
    await expect(renderPage('//evil.example')).rejects.toThrow('NEXT_REDIRECT');
    expect(mockGetSignInUrl).toHaveBeenCalledWith({ returnTo: '/profile' });
  });

  it('falls back to /profile for an absolute external returnTo', async () => {
    await expect(renderPage('https://evil.example/phish')).rejects.toThrow('NEXT_REDIRECT');
    expect(mockGetSignInUrl).toHaveBeenCalledWith({ returnTo: '/profile' });
  });

  it('redirects already signed-in users straight to returnTo (never the hosted page)', async () => {
    mockWithAuth.mockResolvedValue({ user: { id: 'user_123' } });
    await expect(renderPage('/saved')).rejects.toThrow('NEXT_REDIRECT:/saved');
    expect(mockGetSignInUrl).not.toHaveBeenCalled();
  });

  it('still redirects to the hosted page when withAuth() throws', async () => {
    mockWithAuth.mockRejectedValue(new Error('WorkOS misconfigured'));
    await expect(renderPage()).rejects.toThrow(`NEXT_REDIRECT:${HOSTED_URL}`);
  });

  it('renders a manual-retry error card for a callback error — no auto-redirect loop', async () => {
    await renderPage(undefined, 'exchange_failed');
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText('Sign-in interrupted')).toBeInTheDocument();
    const retry = screen.getByRole('link', { name: /Try again/i });
    expect(retry).toHaveAttribute('href', HOSTED_URL);
  });

  it('shows the brand header and a "Back to news" link on the error card', async () => {
    await renderPage(undefined, 'exchange_failed');
    expect(screen.getByTestId('app-icon')).toBeInTheDocument();
    expect(screen.getByText('mukoko')).toBeInTheDocument();
    const back = screen.getByRole('link', { name: /Back to news/i });
    expect(back).toHaveAttribute('href', '/');
  });

  it('renders an unavailable card (not a blank page or a loop) when getSignInUrl() throws', async () => {
    mockGetSignInUrl.mockRejectedValue(new Error('WorkOS misconfigured'));
    await renderPage();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText('Sign-in unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Try again/i })).not.toBeInTheDocument();
  });
});

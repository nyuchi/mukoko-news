import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SignInPage from '../page';

// Owner doctrine (2026-07-09, superseding the 2026-07-02 inline-form doctrine):
// /sign-in sends unauthenticated users into the WORKOS-HOSTED AuthKit flow.
// The WorkOS redirect itself happens in the /auth/login Route Handler —
// getSignInUrl() writes the PKCE/state cookie and MUST NOT be called during a
// page render (Next.js only allows cookie writes in Server Actions / Route
// Handlers). This page only routes: signed-in → returnTo, fresh sign-in →
// /auth/login, callback error → a manual-retry card (no auto-redirect loop).
// next/navigation's redirect() throws.

const { mockWithAuth, mockRedirect } = vi.hoisted(() => ({
  mockWithAuth: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('@workos-inc/authkit-nextjs', () => ({
  withAuth: mockWithAuth,
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

async function renderPage(returnTo?: string, error?: string) {
  const ui = await SignInPage({ searchParams: Promise.resolve({ returnTo, error }) });
  return render(ui);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWithAuth.mockResolvedValue({ user: null });
});

describe('SignInPage (hosted AuthKit via /auth/login)', () => {
  it('redirects unauthenticated users into /auth/login (the initiate-login Route Handler)', async () => {
    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/auth/login?returnTo=%2Fprofile');
  });

  it('passes a safe returnTo through to /auth/login', async () => {
    await expect(renderPage('/admin')).rejects.toThrow(
      'NEXT_REDIRECT:/auth/login?returnTo=%2Fadmin'
    );
  });

  it('falls back to /profile for a protocol-relative returnTo (//evil.example)', async () => {
    await expect(renderPage('//evil.example')).rejects.toThrow(
      'NEXT_REDIRECT:/auth/login?returnTo=%2Fprofile'
    );
  });

  it('falls back to /profile for an absolute external returnTo', async () => {
    await expect(renderPage('https://evil.example/phish')).rejects.toThrow(
      'NEXT_REDIRECT:/auth/login?returnTo=%2Fprofile'
    );
  });

  it('redirects already signed-in users straight to returnTo (never into the flow)', async () => {
    mockWithAuth.mockResolvedValue({ user: { id: 'user_123' } });
    await expect(renderPage('/saved')).rejects.toThrow('NEXT_REDIRECT:/saved');
  });

  it('still starts a sign-in when withAuth() throws', async () => {
    mockWithAuth.mockRejectedValue(new Error('WorkOS misconfigured'));
    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/auth/login?returnTo=%2Fprofile');
  });

  it('renders a manual-retry error card for a callback error — no auto-redirect loop', async () => {
    await renderPage(undefined, 'exchange_failed');
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText('Sign-in interrupted')).toBeInTheDocument();
    const retry = screen.getByRole('link', { name: /Try again/i });
    expect(retry).toHaveAttribute('href', '/auth/login?returnTo=%2Fprofile');
  });

  it('keeps the returnTo on the error card retry link', async () => {
    await renderPage('/admin', 'login_unavailable');
    const retry = screen.getByRole('link', { name: /Try again/i });
    expect(retry).toHaveAttribute('href', '/auth/login?returnTo=%2Fadmin');
  });

  it('shows the brand header and a "Back to news" link on the error card', async () => {
    await renderPage(undefined, 'exchange_failed');
    expect(screen.getByTestId('app-icon')).toBeInTheDocument();
    expect(screen.getByText('mukoko')).toBeInTheDocument();
    const back = screen.getByRole('link', { name: /Back to news/i });
    expect(back).toHaveAttribute('href', '/');
  });
});

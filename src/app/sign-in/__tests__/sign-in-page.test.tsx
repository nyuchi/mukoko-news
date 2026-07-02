import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SignInPage from '../page';

// Owner doctrine (2026-07-02, superseding the earlier hosted-redirect decision):
// /sign-in renders the INLINE (embedded) AuthKit form — it must NOT redirect
// unauthenticated users off-site. It only redirects when the user is already
// signed in (straight to `returnTo`). next/navigation's redirect() throws.

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

// The embedded form is covered by its own test; here we only assert the page
// renders it (not a redirect) and wires the right props.
vi.mock('@/components/auth/inline-sign-in', () => ({
  InlineSignIn: (props: {
    redirectTo?: string;
    fallbackUrl?: string;
    initialError?: string | null;
  }) => (
    <div
      data-testid="inline-sign-in"
      data-redirect-to={props.redirectTo ?? ''}
      data-fallback-url={props.fallbackUrl ?? ''}
      data-initial-error={props.initialError ?? ''}
    />
  ),
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

describe('SignInPage (inline AuthKit form)', () => {
  it('renders the embedded form for unauthenticated users — no off-site redirect', async () => {
    await renderPage();
    expect(screen.getByTestId('inline-sign-in')).toBeInTheDocument();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('shows the brand header and a "Back to news" link', async () => {
    await renderPage();
    expect(screen.getByTestId('app-icon')).toBeInTheDocument();
    expect(screen.getByText('mukoko')).toBeInTheDocument();
    expect(screen.getByText(/Pan-African news/)).toBeInTheDocument();
    const back = screen.getByRole('link', { name: /Back to news/i });
    expect(back).toHaveAttribute('href', '/');
  });

  it('passes a safe returnTo through to the form as redirectTo', async () => {
    await renderPage('/admin');
    expect(screen.getByTestId('inline-sign-in')).toHaveAttribute('data-redirect-to', '/admin');
    expect(mockGetSignInUrl).toHaveBeenCalledWith({ returnTo: '/admin' });
  });

  it('falls back to /profile for a protocol-relative returnTo (//evil.example)', async () => {
    await renderPage('//evil.example');
    expect(screen.getByTestId('inline-sign-in')).toHaveAttribute('data-redirect-to', '/profile');
  });

  it('falls back to /profile for an absolute external returnTo', async () => {
    await renderPage('https://evil.example/phish');
    expect(screen.getByTestId('inline-sign-in')).toHaveAttribute('data-redirect-to', '/profile');
  });

  it('surfaces a callback error to the form via initialError', async () => {
    await renderPage(undefined, 'exchange_failed');
    expect(screen.getByTestId('inline-sign-in').getAttribute('data-initial-error')).not.toBe('');
  });

  it('provides the hosted page as a fallback link URL', async () => {
    await renderPage();
    expect(screen.getByTestId('inline-sign-in')).toHaveAttribute('data-fallback-url', HOSTED_URL);
  });

  it('still renders the form (not a blank page) when withAuth() throws', async () => {
    mockWithAuth.mockRejectedValue(new Error('WorkOS misconfigured'));
    await renderPage();
    expect(screen.getByTestId('inline-sign-in')).toBeInTheDocument();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('redirects already signed-in users straight to returnTo (no form)', async () => {
    mockWithAuth.mockResolvedValue({ user: { id: 'user_123' } });
    await expect(renderPage('/saved')).rejects.toThrow('NEXT_REDIRECT:/saved');
    expect(mockGetSignInUrl).not.toHaveBeenCalled();
  });
});

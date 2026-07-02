import { describe, it, expect, vi, beforeEach } from 'vitest';
import SignInPage from '../page';

// The page is a server component: it must never render a form — it redirects
// to the WorkOS-hosted AuthKit page (unauthenticated) or to `returnTo`
// (already signed in). next/navigation's redirect() throws, so we mimic that.

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

const HOSTED_URL = 'https://identity.nyuchi.com/authorize?client_id=client_123';

function renderPage(returnTo?: string) {
  return SignInPage({ searchParams: Promise.resolve({ returnTo }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWithAuth.mockResolvedValue({ user: null });
  mockGetSignInUrl.mockResolvedValue(HOSTED_URL);
});

describe('SignInPage (hosted AuthKit redirect)', () => {
  it('redirects unauthenticated users to the hosted AuthKit sign-in URL', async () => {
    await expect(renderPage()).rejects.toThrow(`NEXT_REDIRECT:${HOSTED_URL}`);
    expect(mockGetSignInUrl).toHaveBeenCalledWith({ returnTo: '/profile' });
    expect(mockRedirect).toHaveBeenCalledWith(HOSTED_URL);
  });

  it('passes a safe returnTo path through to getSignInUrl', async () => {
    await expect(renderPage('/admin')).rejects.toThrow(`NEXT_REDIRECT:${HOSTED_URL}`);
    expect(mockGetSignInUrl).toHaveBeenCalledWith({ returnTo: '/admin' });
  });

  it('falls back to /profile for a protocol-relative returnTo (//evil.example)', async () => {
    await expect(renderPage('//evil.example')).rejects.toThrow();
    expect(mockGetSignInUrl).toHaveBeenCalledWith({ returnTo: '/profile' });
  });

  it('falls back to /profile for an absolute external returnTo', async () => {
    await expect(renderPage('https://evil.example/phish')).rejects.toThrow();
    expect(mockGetSignInUrl).toHaveBeenCalledWith({ returnTo: '/profile' });
  });

  it('skips the hosted page and redirects signed-in users to returnTo', async () => {
    mockWithAuth.mockResolvedValue({ user: { id: 'user_123' } });
    await expect(renderPage('/saved')).rejects.toThrow('NEXT_REDIRECT:/saved');
    expect(mockGetSignInUrl).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserAvatar } from '../user-avatar';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockUseAuth = vi.fn();
vi.mock('@workos-inc/authkit-nextjs/components', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetProfile = vi.fn();
vi.mock('@/lib/actions/profile', () => ({
  getMyProfileAction: () => mockGetProfile(),
}));

const user = {
  id: 'user_1',
  email: 'joshua@example.com',
  firstName: 'Joshua',
  lastName: 'Jere',
  profilePictureUrl: 'https://workoscdn.com/pic.jpg',
};

describe('UserAvatar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no person record yet, so the session claims are used.
    mockGetProfile.mockResolvedValue(null);
  });

  it('sends a signed-out visitor to sign-in, not to the profile page', () => {
    // The old header linked everyone to /profile, which for an anonymous
    // visitor was a page whose only content was "sign in".
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    render(<UserAvatar />);
    const link = screen.getByLabelText('Sign in').closest('a');
    expect(link).toHaveAttribute('href', '/sign-in');
  });

  it('shows the profile picture when signed in', () => {
    mockUseAuth.mockReturnValue({ user, loading: false });
    const { container } = render(<UserAvatar />);
    // The avatar image is decorative (alt=""), so it has no `img` role — query
    // the element directly rather than by role.
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.src).toBe('https://workoscdn.com/pic.jpg');
    expect(screen.getByLabelText(/Joshua Jere/)).toHaveAttribute('href', '/profile');
  });

  it('falls back to initials when the picture fails to load', () => {
    // A remote avatar can 404 or be blocked; a broken-image glyph in the header
    // looks like a broken site.
    mockUseAuth.mockReturnValue({ user, loading: false });
    const { container } = render(<UserAvatar />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(screen.getByText('JJ')).toBeInTheDocument();
  });

  it('falls back to initials when the picture URL is unsafe', () => {
    mockUseAuth.mockReturnValue({
      user: { ...user, profilePictureUrl: 'javascript:alert(1)' },
      loading: false,
    });
    const { container } = render(<UserAvatar />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('JJ')).toBeInTheDocument();
  });

  it('prefers the identity.persons picture over the session claim', async () => {
    // The platform hosts avatars on profile-images.mukoko.com; that URL is not
    // in the WorkOS token, so a header built from claims alone shows a monogram
    // for users who have a picture everywhere else.
    mockUseAuth.mockReturnValue({ user, loading: false });
    mockGetProfile.mockResolvedValue({
      personId: 'p1',
      givenName: 'Bryan',
      familyName: 'Fawcett',
      name: 'Bryan Fawcett',
      preferredUsername: 'bryanfawcett',
      picture: 'https://profile-images.mukoko.com/bryan.jpg',
      interests: [],
    });
    const { container } = render(<UserAvatar />);
    await waitFor(() => {
      const img = container.querySelector('img') as HTMLImageElement;
      expect(img.src).toBe('https://profile-images.mukoko.com/bryan.jpg');
    });
  });

  it('renders a neutral shape while the session resolves', () => {
    // Guessing "signed out" here makes a signed-in avatar pop in on every nav.
    mockUseAuth.mockReturnValue({ user: null, loading: true });
    render(<UserAvatar />);
    expect(screen.queryByLabelText('Sign in')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

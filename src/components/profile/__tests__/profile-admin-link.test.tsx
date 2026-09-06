import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ProfileAdminLink } from '../profile-admin-link';

/**
 * Most of what matters here is what the component REFUSES to render. The read is
 * fail-soft, so an unproven answer must hide the link rather than show one that
 * would 403 — the same rule the organizations card follows.
 */

const getMyAdminAccessAction = vi.fn();
vi.mock('@/lib/actions/admin-access', () => ({
  getMyAdminAccessAction: () => getMyAdminAccessAction(),
}));

beforeEach(() => vi.clearAllMocks());

describe('ProfileAdminLink', () => {
  it('links to /admin for a staff account', async () => {
    getMyAdminAccessAction.mockResolvedValue({
      canAccessAdmin: true,
      tier: 'admin',
      tierLabel: 'Staff',
    });
    render(<ProfileAdminLink />);

    const link = await screen.findByRole('link', { name: /admin console/i });
    expect(link).toHaveAttribute('href', '/admin');
  });

  it('names the tier the caller actually holds', async () => {
    getMyAdminAccessAction.mockResolvedValue({
      canAccessAdmin: true,
      tier: 'moderator',
      tierLabel: 'Moderator',
    });
    render(<ProfileAdminLink />);
    expect(await screen.findByText(/Moderator access/i)).toBeInTheDocument();
  });

  it('renders nothing for a non-staff account', async () => {
    getMyAdminAccessAction.mockResolvedValue({
      canAccessAdmin: false,
      tier: 'none',
      tierLabel: 'No access',
    });
    const { container } = render(<ProfileAdminLink />);
    await waitFor(() => expect(getMyAdminAccessAction).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the read fails', async () => {
    // Fail-soft: unproven is not proven-true. Showing the link on a failed read
    // would send a reader to a page that refuses them.
    getMyAdminAccessAction.mockRejectedValue(new Error('down'));
    const { container } = render(<ProfileAdminLink />);
    await waitFor(() => expect(getMyAdminAccessAction).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing before the answer arrives', () => {
    // No skeleton on purpose: for most accounts this resolves to nothing, so a
    // placeholder would be a layout shift on every profile load.
    getMyAdminAccessAction.mockReturnValue(new Promise(() => {}));
    const { container } = render(<ProfileAdminLink />);
    expect(container).toBeEmptyDOMElement();
  });
});

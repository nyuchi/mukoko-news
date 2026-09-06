import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { EntityAccess } from '@/lib/auth/entity-access';

const mockAction = vi.fn();
vi.mock('@/lib/actions/entity-access', () => ({
  getMyEntityAccessAction: () => mockAction(),
}));

import { ProfileOrganizations } from '../profile-organizations';

function access(over: Partial<EntityAccess> = {}): EntityAccess {
  return {
    entityId: 'e1',
    entityName: 'Nyuchi Africa',
    entityType: 'organization',
    role: 'founder',
    title: null,
    capabilities: ['entity:read'],
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('ProfileOrganizations', () => {
  it('title-cases the raw membershipRole enum', async () => {
    // The row stores `admin`/`founder` lowercase. Rendered raw beside a
    // free-text `title` it read as two different fields in one list.
    mockAction.mockResolvedValue([
      access({ entityId: 'a', entityName: 'Nyuchi Africa', role: 'founder' }),
      access({ entityId: 'b', entityName: 'Iconic Expeditions', role: 'admin' }),
    ]);
    render(<ProfileOrganizations />);
    await waitFor(() => expect(screen.getByText('Nyuchi Africa')).toBeInTheDocument());
    expect(screen.getByText('Founder')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.queryByText('admin')).not.toBeInTheDocument();
  });

  it('prefers the person’s own title verbatim over the role', async () => {
    mockAction.mockResolvedValue([access({ title: 'Head of Newsroom', role: 'admin' })]);
    render(<ProfileOrganizations />);
    await waitFor(() => expect(screen.getByText('Head of Newsroom')).toBeInTheDocument());
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('falls back to Member when the row carries neither', async () => {
    mockAction.mockResolvedValue([access({ title: null, role: null })]);
    render(<ProfileOrganizations />);
    await waitFor(() => expect(screen.getByText('Member')).toBeInTheDocument());
  });

  it('renders nothing when there are no memberships', async () => {
    // Empty is also what a failed read returns, and this component must not
    // assert "no organizations" from something the app cannot prove.
    mockAction.mockResolvedValue([]);
    const { container } = render(<ProfileOrganizations />);
    await waitFor(() => expect(container.querySelector('ul')).toBeNull());
    expect(screen.queryByText(/organization/i)).not.toBeInTheDocument();
  });

  it('renders nothing when the read throws', async () => {
    mockAction.mockRejectedValue(new Error('down'));
    const { container } = render(<ProfileOrganizations />);
    await waitFor(() => expect(container.querySelector('ul')).toBeNull());
  });

  it('labels each capability the membership carries', async () => {
    mockAction.mockResolvedValue([
      access({ capabilities: ['entity:read', 'entity:manage', 'entity:members'] }),
    ]);
    render(<ProfileOrganizations />);
    await waitFor(() => expect(screen.getByText('View')).toBeInTheDocument());
    expect(screen.getByText('Manage')).toBeInTheDocument();
    expect(screen.getByText('Members')).toBeInTheDocument();
  });
});

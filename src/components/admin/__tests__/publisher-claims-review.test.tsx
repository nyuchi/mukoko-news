import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PublisherClaimsReview } from '../publisher-claims-review';
import type { AdminPublisherClaim } from '@/lib/mongodb/admin';

const { mockApprove, mockReject } = vi.hoisted(() => ({
  mockApprove: vi.fn(),
  mockReject: vi.fn(),
}));

vi.mock('@/lib/admin/gateway', () => ({
  approvePublisherClaim: mockApprove,
  rejectPublisherClaim: mockReject,
}));

const CLAIMS: AdminPublisherClaim[] = [
  {
    id: 'claim-1',
    status: 'submitted',
    claimedRole: 'publisher',
    organizationName: 'Harare Post',
    mediaOrganizationId: null,
    proposedOrgUrl: 'https://hararepost.co.zw',
    evidenceUrl: 'https://hararepost.co.zw/about',
    evidenceNotes: 'I am the founding editor.',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockApprove.mockResolvedValue({ ok: true, status: 200 });
  mockReject.mockResolvedValue({ ok: true, status: 200 });
});

describe('PublisherClaimsReview', () => {
  it('renders each claim with its organization and role', () => {
    render(<PublisherClaimsReview initialClaims={CLAIMS} />);
    expect(screen.getByText('Harare Post')).toBeInTheDocument();
    expect(screen.getByText('publisher')).toBeInTheDocument();
    expect(screen.getByText('new org (proposed)')).toBeInTheDocument();
  });

  it('approves a claim and removes it from the queue', async () => {
    render(<PublisherClaimsReview initialClaims={CLAIMS} />);
    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));
    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('claim-1'));
    await waitFor(() => expect(screen.queryByText('Harare Post')).not.toBeInTheDocument());
    expect(screen.getByText(/No publisher claims awaiting review/i)).toBeInTheDocument();
  });

  it('requires a reason before rejecting', async () => {
    render(<PublisherClaimsReview initialClaims={CLAIMS} />);
    fireEvent.click(screen.getByRole('button', { name: /^Reject/i }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm reject/i }));
    expect(await screen.findByText(/Enter a reason/i)).toBeInTheDocument();
    expect(mockReject).not.toHaveBeenCalled();
  });

  it('rejects a claim with a reason and removes it', async () => {
    render(<PublisherClaimsReview initialClaims={CLAIMS} />);
    fireEvent.click(screen.getByRole('button', { name: /^Reject/i }));
    fireEvent.change(screen.getByPlaceholderText(/Reason for rejection/i), {
      target: { value: 'insufficient evidence' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Confirm reject/i }));
    await waitFor(() =>
      expect(mockReject).toHaveBeenCalledWith('claim-1', 'insufficient evidence')
    );
    await waitFor(() => expect(screen.queryByText('Harare Post')).not.toBeInTheDocument());
  });

  it('surfaces a gateway error and keeps the claim in the queue', async () => {
    mockApprove.mockResolvedValue({ ok: false, status: 409, error: 'Claim already processed.' });
    render(<PublisherClaimsReview initialClaims={CLAIMS} />);
    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));
    expect(await screen.findByText(/already processed/i)).toBeInTheDocument();
    expect(screen.getByText('Harare Post')).toBeInTheDocument();
  });
});

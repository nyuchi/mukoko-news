import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InlineSignIn } from '../inline-sign-in';

const { mockRequestEmailCode, mockVerifyEmailCode, mockVerifyMfaCode, mockPush, mockRefresh } =
  vi.hoisted(() => ({
    mockRequestEmailCode: vi.fn(),
    mockVerifyEmailCode: vi.fn(),
    mockVerifyMfaCode: vi.fn(),
    mockPush: vi.fn(),
    mockRefresh: vi.fn(),
  }));

vi.mock('@/lib/auth/actions', () => ({
  requestEmailCode: mockRequestEmailCode,
  verifyEmailCode: mockVerifyEmailCode,
  verifyMfaCode: mockVerifyMfaCode,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockRequestEmailCode.mockResolvedValue({ ok: true });
  mockVerifyEmailCode.mockResolvedValue({ ok: true });
  mockVerifyMfaCode.mockResolvedValue({ ok: true });
});

function typeInto(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

/** Fill the six OTP boxes for the active step (auto-submits on the 6th digit). */
function fillOtp(groupLabel: string, code: string) {
  const boxes = screen.getAllByLabelText(new RegExp(`${groupLabel} digit`, 'i'));
  code.split('').forEach((d, i) => fireEvent.change(boxes[i], { target: { value: d } }));
}

async function reachCodeStep(email = 'reader@example.com') {
  typeInto(screen.getByLabelText(/Email address/i), email);
  fireEvent.click(screen.getByRole('button', { name: /Send code/i }));
  await screen.findByRole('group', { name: /One-time code/i });
}

describe('InlineSignIn (embedded Magic Auth form)', () => {
  it('renders a labelled email field and the default heading', () => {
    render(<InlineSignIn />);
    expect(screen.getByRole('heading', { name: /Sign in to mukoko/i })).toBeInTheDocument();
    const email = screen.getByLabelText(/Email address/i);
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByRole('button', { name: /Send code/i })).toBeInTheDocument();
  });

  it('honors title/subtitle overrides', () => {
    render(<InlineSignIn title="Admin sign-in" subtitle="Staff only." />);
    expect(screen.getByRole('heading', { name: /Admin sign-in/i })).toBeInTheDocument();
    expect(screen.getByText('Staff only.')).toBeInTheDocument();
  });

  it('shows an initial error in an alert region', () => {
    render(<InlineSignIn initialError="We could not complete that sign-in." />);
    expect(screen.getByRole('alert')).toHaveTextContent(/could not complete/i);
  });

  it('renders the hosted fallback link only when a fallbackUrl is given', () => {
    const { rerender } = render(<InlineSignIn />);
    expect(screen.queryByRole('link', { name: /secure page/i })).not.toBeInTheDocument();

    rerender(<InlineSignIn fallbackUrl="https://identity.nyuchi.com/authorize?x=1" />);
    const link = screen.getByRole('link', { name: /secure page/i });
    expect(link).toHaveAttribute('href', 'https://identity.nyuchi.com/authorize?x=1');
  });

  it('advances to the segmented one-time-code step after a successful email submit', async () => {
    render(<InlineSignIn />);
    await reachCodeStep();

    // Six individual boxes, not one field; the first exposes the OTP autocomplete.
    const boxes = screen.getAllByLabelText(/One-time code digit/i);
    expect(boxes).toHaveLength(6);
    expect(boxes[0]).toHaveAttribute('autocomplete', 'one-time-code');
    expect(screen.getByText(/We sent a 6-digit code to reader@example.com/i)).toBeInTheDocument();
  });

  it('surfaces a request error and stays on the email step', async () => {
    mockRequestEmailCode.mockResolvedValue({ ok: false, error: 'Enter a valid email address.' });
    render(<InlineSignIn />);

    typeInto(screen.getByLabelText(/Email address/i), 'nope');
    fireEvent.click(screen.getByRole('button', { name: /Send code/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid email/i);
    expect(screen.queryByRole('group', { name: /One-time code/i })).not.toBeInTheDocument();
  });

  it('verifies the code and redirects on success', async () => {
    render(<InlineSignIn redirectTo="/admin" />);
    await reachCodeStep();

    fillOtp('One-time code', '123456'); // auto-submits on the 6th digit

    await waitFor(() =>
      expect(mockVerifyEmailCode).toHaveBeenCalledWith('reader@example.com', '123456')
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/admin'));
  });

  it('steps up to the MFA screen and completes with the authenticator code', async () => {
    mockVerifyEmailCode.mockResolvedValue({
      ok: false,
      mfa: { mode: 'challenge', pendingToken: 'pt_1', challengeId: 'ch_1' },
    });
    render(<InlineSignIn redirectTo="/" />);
    await reachCodeStep();

    fillOtp('One-time code', '111111');

    // The MFA step appears instead of an error.
    await screen.findByRole('heading', { name: /Two-factor authentication/i });
    expect(screen.getByRole('group', { name: /Authenticator code/i })).toBeInTheDocument();

    fillOtp('Authenticator code', '654321');

    await waitFor(() =>
      expect(mockVerifyMfaCode).toHaveBeenCalledWith('pt_1', 'ch_1', '654321')
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/'));
  });
});

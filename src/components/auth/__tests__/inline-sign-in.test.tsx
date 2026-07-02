import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InlineSignIn } from '../inline-sign-in';

const { mockRequestEmailCode, mockVerifyEmailCode, mockPush, mockRefresh } = vi.hoisted(
  () => ({
    mockRequestEmailCode: vi.fn(),
    mockVerifyEmailCode: vi.fn(),
    mockPush: vi.fn(),
    mockRefresh: vi.fn(),
  })
);

vi.mock('@/lib/auth/actions', () => ({
  requestEmailCode: mockRequestEmailCode,
  verifyEmailCode: mockVerifyEmailCode,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockRequestEmailCode.mockResolvedValue({ ok: true });
  mockVerifyEmailCode.mockResolvedValue({ ok: true });
});

/** Fill an input and fire the change event RTL expects. */
function typeInto(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
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

  it('advances to the one-time-code step after a successful email submit', async () => {
    render(<InlineSignIn />);

    typeInto(screen.getByLabelText(/Email address/i), 'reader@example.com');
    fireEvent.click(screen.getByRole('button', { name: /Send code/i }));

    await waitFor(() =>
      expect(mockRequestEmailCode).toHaveBeenCalledWith('reader@example.com')
    );
    const code = await screen.findByLabelText(/One-time code/i);
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(
      screen.getByText(/We sent a 6-digit code to reader@example.com/i)
    ).toBeInTheDocument();
  });

  it('surfaces a request error and stays on the email step', async () => {
    mockRequestEmailCode.mockResolvedValue({ ok: false, error: 'Enter a valid email address.' });
    render(<InlineSignIn />);

    typeInto(screen.getByLabelText(/Email address/i), 'nope');
    fireEvent.click(screen.getByRole('button', { name: /Send code/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid email/i);
    expect(screen.queryByLabelText(/One-time code/i)).not.toBeInTheDocument();
  });

  it('verifies the code and redirects on success', async () => {
    render(<InlineSignIn redirectTo="/admin" />);

    typeInto(screen.getByLabelText(/Email address/i), 'reader@example.com');
    fireEvent.click(screen.getByRole('button', { name: /Send code/i }));

    const code = await screen.findByLabelText(/One-time code/i);
    typeInto(code, '123456');
    fireEvent.click(screen.getByRole('button', { name: /Verify/i }));

    await waitFor(() =>
      expect(mockVerifyEmailCode).toHaveBeenCalledWith('reader@example.com', '123456')
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/admin'));
  });
});

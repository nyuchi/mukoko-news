import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EnrichmentControls } from '../enrichment-controls';

/**
 * The states carry the meaning here. A drain is fire-and-forget — the gateway
 * returns 202 the moment the enrichment worker accepts, and the work continues in
 * a Durable Object long after — so the only dishonest thing this button could do
 * is imply the backlog is cleared. And a 503 (gateway not wired up) must not read
 * as success, because that is exactly the confusion the gateway route's loud 503
 * was written to prevent.
 */

const drainEnrichmentBacklog = vi.fn();
vi.mock('@/lib/admin/gateway', () => ({
  drainEnrichmentBacklog: (...args: unknown[]) => drainEnrichmentBacklog(...args),
}));

beforeEach(() => vi.clearAllMocks());

const button = () => screen.getByRole('button', { name: /backlog drain|starting/i });

describe('EnrichmentControls', () => {
  it('calls the gateway action when pressed', async () => {
    drainEnrichmentBacklog.mockResolvedValue({ ok: true, status: 202 });
    render(<EnrichmentControls />);
    fireEvent.click(button());
    await waitFor(() => expect(drainEnrichmentBacklog).toHaveBeenCalledTimes(1));
  });

  it('reports the drain as STARTED, never as finished', async () => {
    drainEnrichmentBacklog.mockResolvedValue({ ok: true, status: 202 });
    render(<EnrichmentControls />);
    fireEvent.click(button());

    const msg = await screen.findByText(/drain started/i);
    expect(msg).toBeInTheDocument();
    // The work outlives the request, so no claim about the backlog being cleared.
    expect(screen.queryByText(/complete|finished|cleared|done/i)).not.toBeInTheDocument();
  });

  it('surfaces a 503 as a failure rather than folding it into success', async () => {
    drainEnrichmentBacklog.mockResolvedValue({
      ok: false,
      status: 503,
      error: 'Enrichment is not configured on the gateway.',
    });
    render(<EnrichmentControls />);
    fireEvent.click(button());

    expect(await screen.findByText(/not configured on the gateway/i)).toBeInTheDocument();
    expect(screen.queryByText(/drain started/i)).not.toBeInTheDocument();
  });

  it('falls back to the status code when the gateway sends no message', async () => {
    drainEnrichmentBacklog.mockResolvedValue({ ok: false, status: 502 });
    render(<EnrichmentControls />);
    fireEvent.click(button());
    expect(await screen.findByText(/Gateway returned 502/i)).toBeInTheDocument();
  });

  it('recovers when the action itself rejects', async () => {
    // Without the try/catch the button would spin forever and say nothing.
    drainEnrichmentBacklog.mockRejectedValue(new Error('network'));
    render(<EnrichmentControls />);
    fireEvent.click(button());

    expect(await screen.findByText(/could not reach the gateway/i)).toBeInTheDocument();
    await waitFor(() => expect(button()).not.toBeDisabled());
  });

  it('disables the button while a drain is starting', async () => {
    let release: (v: unknown) => void = () => {};
    drainEnrichmentBacklog.mockReturnValue(new Promise((r) => (release = r)));
    render(<EnrichmentControls />);
    fireEvent.click(button());

    await waitFor(() => expect(button()).toBeDisabled());
    release({ ok: true, status: 202 });
    await waitFor(() => expect(button()).not.toBeDisabled());
  });

  it('announces the outcome in a live region', async () => {
    // The button label does not change on completion, so a screen-reader user
    // would otherwise get no signal at all.
    drainEnrichmentBacklog.mockResolvedValue({ ok: true, status: 202 });
    const { container } = render(<EnrichmentControls />);
    expect(container.querySelector('[aria-live="polite"]')).toBeInTheDocument();

    fireEvent.click(button());
    const live = container.querySelector('[aria-live="polite"]')!;
    await waitFor(() => expect(live.textContent).toMatch(/drain started/i));
  });
});

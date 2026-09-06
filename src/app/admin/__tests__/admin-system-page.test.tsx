import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdminSystemPage from '../system/page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockPingDatabase = vi.fn();
vi.mock('@/lib/mongodb/admin', () => ({
  pingDatabase: (...args: unknown[]) => mockPingDatabase(...args),
}));

// The page now renders the enrichment control, which imports the 'use server'
// gateway module — and that pulls WorkOS's authkit in, which needs a Next.js
// server runtime jsdom does not provide. The control has its own suite; here it
// only needs to not break the page. Mocked at the gateway rather than at the
// component so the page still renders the real control.
vi.mock('@/lib/admin/gateway', () => ({
  drainEnrichmentBacklog: vi.fn().mockResolvedValue({ ok: true, status: 202 }),
}));

describe('AdminSystemPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a real connected status with ping latency', async () => {
    mockPingDatabase.mockResolvedValue({ ok: true, latencyMs: 23 });
    render(await AdminSystemPage());
    expect(screen.getByText('MongoDB Atlas')).toBeInTheDocument();
    expect(screen.getByText('Connected — ping 23 ms')).toBeInTheDocument();
  });

  it('shows unreachable when the ping fails', async () => {
    mockPingDatabase.mockResolvedValue({ ok: false, latencyMs: null });
    render(await AdminSystemPage());
    expect(screen.getByText('Unreachable')).toBeInTheDocument();
  });

  it('links to the real health probe', async () => {
    mockPingDatabase.mockResolvedValue({ ok: true, latencyMs: 5 });
    render(await AdminSystemPage());
    const link = screen.getByText('/api/health');
    expect(link.closest('a')).toHaveAttribute('href', '/api/health');
  });

  it('has no fabricated statuses or dead config controls', async () => {
    mockPingDatabase.mockResolvedValue({ ok: true, latencyMs: 5 });
    render(await AdminSystemPage());
    // Old fake statuses
    expect(screen.queryByText('Operational')).not.toBeInTheDocument();
    expect(screen.queryByText('Running')).not.toBeInTheDocument();
    expect(screen.queryByText('RSS Scheduler')).not.toBeInTheDocument();
    // Old dead controls
    expect(screen.queryByText('RSS Sync Interval')).not.toBeInTheDocument();
    expect(screen.queryByText('Clear Cache')).not.toBeInTheDocument();
    expect(screen.queryByText('Rebuild Indexes')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('describes the pipeline boundary honestly', async () => {
    mockPingDatabase.mockResolvedValue({ ok: true, latencyMs: 5 });
    render(await AdminSystemPage());
    expect(screen.getByText(/not monitored from this frontend/)).toBeInTheDocument();
  });
});

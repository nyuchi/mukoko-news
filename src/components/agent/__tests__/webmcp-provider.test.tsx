import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { WebMcpProvider } from '../webmcp-provider';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/actions/feed', () => ({
  getArticlesAction: vi.fn().mockResolvedValue({ articles: [], total: 0 }),
  searchArticlesAction: vi.fn().mockResolvedValue([]),
}));

describe('WebMcpProvider', () => {
  afterEach(() => {
    delete (navigator as unknown as { modelContext?: unknown }).modelContext;
  });

  it('is a no-op when the browser has no WebMCP support', () => {
    // No navigator.modelContext → must not throw.
    expect(() => render(<WebMcpProvider />)).not.toThrow();
  });

  it('registers the site tools via navigator.modelContext.provideContext', () => {
    const provideContext = vi.fn();
    (navigator as unknown as { modelContext: unknown }).modelContext = { provideContext };
    render(<WebMcpProvider />);

    expect(provideContext).toHaveBeenCalledTimes(1);
    const { tools } = provideContext.mock.calls[0][0];
    const names = tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['search_mukoko_news', 'get_latest_headlines', 'open_article'])
    );
    // Each tool has the WebMCP contract: name, description, inputSchema, execute.
    for (const t of tools) {
      expect(typeof t.description).toBe('string');
      expect(t.inputSchema.type).toBe('object');
      expect(typeof t.execute).toBe('function');
    }
  });
});

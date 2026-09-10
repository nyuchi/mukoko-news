import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PreferredSourceButton, PreferredSourceCard } from '../preferred-source-button';

// The whole point of this component is that Google's ~38 KB module is NOT a
// cost readers pay by default. These tests exist to keep that true: a future
// edit that moves the import to module scope, or drops the deeplink fallback,
// should fail here rather than quietly bill every reader on a metered bundle.

describe('PreferredSourceButton', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('renders as a real link to Google’s no-JS deeplink for the bare domain', () => {
    render(<PreferredSourceButton />);
    const link = screen.getByRole('link', { name: /choose mukoko news in google/i });
    expect(link).toHaveAttribute(
      'href',
      'https://www.google.com/preferences/source?q=news.mukoko.com'
    );
    // Domain or subdomain only — Google does not accept a subdirectory.
    expect(link.getAttribute('href')).not.toMatch(/%2F/);
  });

  it('opens in a new tab without handing Google a window opener', () => {
    render(<PreferredSourceButton />);
    const link = screen.getByRole('link', { name: /choose mukoko news in google/i });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('loads no third-party script on mount', () => {
    render(<PreferredSourceButton />);
    expect(document.querySelectorAll('script[src*="news.google.com"]')).toHaveLength(0);
    expect(screen.getByRole('link', { name: /choose mukoko news in google/i })).toHaveAttribute(
      'data-preferred-source-ready',
      'false'
    );
  });

  it('still navigates via the href when the module has not loaded', () => {
    render(<PreferredSourceButton />);
    const link = screen.getByRole('link', { name: /choose mukoko news in google/i });
    // No preventDefault means the browser follows the href — there is no state
    // in which pressing this control does nothing.
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);
  });

  it('meets the Mzizi primary-CTA touch target', () => {
    render(<PreferredSourceButton />);
    const link = screen.getByRole('link', { name: /choose mukoko news in google/i });
    expect(link.className).toContain('min-h-[var(--density-touch,47px)]');
  });

  it('uses the theme tokens rather than a hard-coded colour', () => {
    render(<PreferredSourceButton />);
    const link = screen.getByRole('link', { name: /choose mukoko news in google/i });
    expect(link.className).toContain('bg-primary');
    expect(link.className).toContain('text-on-primary');
    expect(link.className).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it('exposes a visible focus indicator', () => {
    render(<PreferredSourceButton />);
    const link = screen.getByRole('link', { name: /choose mukoko news in google/i });
    expect(link.className).toContain('focus-visible:ring-2');
  });
});

describe('PreferredSourceCard copy', () => {
  it('is a labelled landmark', () => {
    render(<PreferredSourceCard />);
    expect(
      screen.getByRole('region', { name: /see more of our reporting in google/i })
    ).toBeInTheDocument();
  });

  it('describes the personalised effect and never claims a ranking benefit', () => {
    const { container } = render(<PreferredSourceCard />);
    const text = (container.textContent || '').toLowerCase();
    // Being chosen as a preferred source changes what the opted-in reader sees.
    // It is not a ranking boost, and the copy must not imply one.
    expect(text).toMatch(/what .*you.* see|changes what/);
    for (const claim of ['rank higher', 'ranking', 'boost our', 'improve our position', 'seo']) {
      expect(text).not.toContain(claim);
    }
  });

  it('tells the reader the choice is reversible', () => {
    const { container } = render(<PreferredSourceCard />);
    expect((container.textContent || '').toLowerCase()).toMatch(/undo|any time|reverse/);
  });
});

describe('no dark patterns', () => {
  it('the control appears on /about only, never in global chrome', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
    // A nag that follows the reader around, or an interstitial, is exactly what
    // this must not become.
    for (const chrome of [
      'src/app/layout.tsx',
      'src/components/layout/header.tsx',
      'src/components/layout/footer.tsx',
      'src/components/layout/bottom-nav.tsx',
      'src/components/onboarding-modal.tsx',
    ]) {
      expect(read(chrome)).not.toContain('PreferredSource');
    }
    expect(read('src/app/about/page.tsx')).toContain('PreferredSourceCard');
  });
});

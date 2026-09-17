/**
 * The loading mark, and the two things about it that are easy to undo.
 *
 * 1. **It must mount without a `ThemeProvider`.** The obvious implementation is
 *    `AppIcon`, which picks its file with `useTheme()` — and this app's
 *    `useTheme` THROWS outside a provider. A spinner is mounted by skeletons,
 *    empty states and tests, so building on it would make `ThemeProvider` a
 *    hard requirement of all of them. Every test here renders bare, so that
 *    regression is a failure rather than a surprise at a call site.
 * 2. **It must not redraw the mark.** The artwork is
 *    `mukoko-mark-full-{light,dark}.svg` and the doctrine on it is absolute —
 *    no recolouring, no reordering, no mono reduction. Animating transforms
 *    around those files cannot break any of that; inlining the polygons here
 *    could, and would be a second copy free to drift.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MukokoSpinner } from '../mukoko-spinner';

/** The `src` of every image the spinner rendered, in DOM order. */
function markSources(container: HTMLElement): string[] {
  return [...container.querySelectorAll('img')].map((img) => {
    const src = img.getAttribute('src') ?? '';
    // next/image may rewrite through the optimiser; the asset is what matters.
    return decodeURIComponent(src).replace(/^.*?(\/mukoko-mark-full-[a-z]+\.svg).*$/, '$1');
  });
}

describe('MukokoSpinner', () => {
  it('renders with no ThemeProvider in the tree', () => {
    // If this throws "useTheme must be used within a ThemeProvider", the
    // spinner has been rebuilt on AppIcon and every skeleton now needs a
    // provider.
    expect(() => render(<MukokoSpinner />)).not.toThrow();
  });

  it('carries BOTH marks and lets CSS choose, rather than choosing in JS', () => {
    const { container } = render(<MukokoSpinner />);
    const sources = markSources(container);

    expect(sources).toContain('/mukoko-mark-full-light.svg');
    expect(sources).toContain('/mukoko-mark-full-dark.svg');

    // One is hidden by the `.dark` class rather than by a render-time branch,
    // which is what keeps the correct mark in the FIRST paint.
    const html = container.innerHTML;
    expect(html).toContain('dark:hidden');
    expect(html).toContain('dark:block');
  });

  it('is decorative by default, so a labelled skeleton does not announce twice', () => {
    const { container } = render(<MukokoSpinner />);

    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('.mukoko-spinner')).toHaveAttribute('aria-hidden', 'true');
    // Neither image contributes an accessible name.
    for (const img of container.querySelectorAll('img')) {
      expect(img).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('announces when it is the only thing on screen', () => {
    render(<MukokoSpinner label="Loading article" />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading article');
    expect(status).not.toHaveAttribute('aria-hidden');
  });

  it('drives the animation from classes, so reduced motion can switch it off', () => {
    // The two halves are separate elements on purpose: both animate
    // `transform`, and one element cannot run two transform animations at once.
    // `globals.css` turns both off under `prefers-reduced-motion: reduce`, which
    // a JS-driven animation could not do.
    const { container } = render(<MukokoSpinner />);

    expect(container.querySelector('.mukoko-spinner-turn')).not.toBeNull();
    expect(container.querySelector('.mukoko-spinner-breathe')).not.toBeNull();
  });

  it('sizes the box and the artwork together', () => {
    const { container } = render(<MukokoSpinner size={56} />);

    const root = container.querySelector('.mukoko-spinner') as HTMLElement;
    expect(root.style.width).toBe('56px');
    expect(root.style.height).toBe('56px');
    for (const img of container.querySelectorAll('img')) {
      expect(img).toHaveAttribute('width', '56');
    }
  });

  it('is actually switched off under prefers-reduced-motion', () => {
    // The class names above are only half the claim. A spinner that keeps
    // turning for a reader who asked for stillness is the whole reason that
    // media query exists, and nothing in the DOM can prove the stylesheet
    // honours it — so this reads the stylesheet.
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
    const block = css.match(
      /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.mukoko-spinner-turn[\s\S]*?\n\}/
    );

    expect(block, 'no reduced-motion rule names .mukoko-spinner-turn').not.toBeNull();
    expect(block![0]).toContain('.mukoko-spinner-breathe');
    expect(block![0]).toContain('animation: none');
  });
});

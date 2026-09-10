import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  OUTLINE_ATTRIBUTE,
  OUTLINE_STORAGE_KEY,
  applyOutlinePreference,
  parseOutlinePreference,
} from '../appearance';

describe('parseOutlinePreference', () => {
  it('only the exact string turns outlines on', () => {
    expect(parseOutlinePreference('on')).toBe('on');
  });

  it('anything else is off', () => {
    // Strict rather than truthy on purpose. A half-written or foreign value in
    // localStorage must land on the DEFAULT look — an outlined app the reader
    // never asked for is one they would have no idea how to switch off.
    for (const raw of ['true', 'ON', '1', 'yes', '', null, undefined, 'off']) {
      expect(parseOutlinePreference(raw)).toBe('off');
    }
  });
});

describe('applyOutlinePreference', () => {
  function fakeRoot() {
    const attrs = new Map<string, string>();
    return {
      attrs,
      setAttribute: (n: string, v: string) => void attrs.set(n, v),
      removeAttribute: (n: string) => void attrs.delete(n),
    };
  }

  it('sets the attribute the CSS keys off', () => {
    const root = fakeRoot();
    applyOutlinePreference('on', root);
    expect(root.attrs.get(OUTLINE_ATTRIBUTE)).toBe('on');
  });

  it('REMOVES the attribute rather than setting it to "off"', () => {
    // So the stylesheet has exactly one selector meaning "outlined". A
    // `data-outlines="off"` would invite a second rule that disagrees with it.
    const root = fakeRoot();
    applyOutlinePreference('on', root);
    applyOutlinePreference('off', root);
    expect(root.attrs.has(OUTLINE_ATTRIBUTE)).toBe(false);
  });
});

describe('the pre-paint bootstrap agrees with the module', () => {
  /**
   * The script in `layout.tsx` runs before any module is evaluated, so it
   * carries both storage keys as string literals and CANNOT import them. That
   * is the whole hazard: a rename here leaves a setting that still saves, still
   * renders in the toggle, and silently stops applying on load.
   */
  const LAYOUT = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8');

  it('uses the same storage key', () => {
    expect(LAYOUT).toContain(`localStorage.getItem('${OUTLINE_STORAGE_KEY}')`);
  });

  it('sets the same attribute, to the same value', () => {
    expect(LAYOUT).toContain(`setAttribute('${OUTLINE_ATTRIBUTE}','on')`);
  });

  it('applies it before first paint, in <head>', () => {
    // Below the fold of <head> and it is a flash: the reader sees one frame of
    // the un-outlined app, which for someone who needs the edges is the frame
    // that matters.
    const head = LAYOUT.slice(LAYOUT.indexOf('<head>'), LAYOUT.indexOf('</head>'));
    expect(head).toContain(OUTLINE_STORAGE_KEY);
  });
});

describe('components separate by fill, not by a drawn edge', () => {
  /**
   * The regression this exists to stop.
   *
   * Every card, panel and chip carried `border border-border` (or
   * `border-elevated`), so the product looked like a high-contrast theme nobody
   * chose — and with everything boxed, nothing read as emphasised. Outlines are
   * now one token (`--outline`, transparent by default) behind a reader
   * preference and the `prefers-contrast` fallback.
   *
   * A BOX outline is `border <colour>`. A SEPARATOR is `border-b`, `border-t`,
   * `border-y` or `divide-y` — a line that means "these two things are
   * different", not "here is an edge". Separators keep `--border` and are
   * deliberately not matched here.
   */
  const BOX_OUTLINE = /\bborder\s+border-(border|elevated)\b|\bring-1\s+ring-border\b/;

  /**
   * The one legitimate exception. A button's `outline` variant is a control
   * affordance — the edge IS the button — and it is literally the variant's
   * name. It is not chrome drawn around a surface.
   */
  const ALLOWED = new Set([join('src', 'components', 'ui', 'button.tsx')]);

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== '__tests__' && entry !== 'node_modules') walk(full, out);
      } else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) {
        out.push(full);
      }
    }
    return out;
  }

  it('no component outlines a surface with the separator colour', () => {
    const offenders = walk(join(process.cwd(), 'src'))
      .filter((file) => !ALLOWED.has(file.replace(`${process.cwd()}/`, '')))
      .filter((file) => BOX_OUTLINE.test(readFileSync(file, 'utf8')))
      .map((file) => file.replace(`${process.cwd()}/`, ''));

    expect(offenders).toEqual([]);
  });
});

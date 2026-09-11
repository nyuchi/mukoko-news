import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  CONTRAST_ATTRIBUTE,
  CONTRAST_QUERY,
  CONTRAST_STORAGE_KEY,
  applyContrast,
  parseContrastPreference,
  resolveContrast,
} from '../appearance';

describe('parseContrastPreference', () => {
  it('honours the three exact strings', () => {
    expect(parseContrastPreference('on')).toBe('on');
    expect(parseContrastPreference('system')).toBe('system');
    expect(parseContrastPreference('off')).toBe('off');
  });

  it('anything else is off', () => {
    // Strict rather than truthy on purpose. A half-written or foreign value in
    // localStorage must land on the DEFAULT look — a treatment the reader never
    // asked for is one they would have no idea how to switch off.
    for (const raw of ['true', 'ON', '1', 'yes', 'SYSTEM', 'more', '', null, undefined]) {
      expect(parseContrastPreference(raw)).toBe('off');
    }
  });

  it('DEFAULTS to off, not to the device setting', () => {
    // The report this answers: the OS "Increase Contrast" switch turned the
    // treatment on over the top of this control. A reader who has never opened
    // it has not asked for the treatment; `system` is one tap away for one who
    // wants their device to decide.
    expect(parseContrastPreference(null)).toBe('off');
  });
});

/**
 * The whole point of the setting, in four assertions.
 *
 * Owner report 2026-09-11: *"the increase contrast toggle was on in system
 * settings; when turned off I saw it work, but like the theme it needs to
 * disable it on the site or have it on."* As a `@media (prefers-contrast:
 * more)` block this was impossible — a preference that is not in the cascade
 * cannot override a query that is. Resolving it in JS is what makes the site's
 * choice authoritative in BOTH directions.
 */
describe('resolveContrast', () => {
  it('OFF stays off even when the device asks for more', () => {
    expect(resolveContrast('off', true)).toBe('standard');
  });

  it('ON applies even when the device does not ask', () => {
    expect(resolveContrast('on', false)).toBe('more');
  });

  it('SYSTEM is the only value that listens to the device', () => {
    expect(resolveContrast('system', true)).toBe('more');
    expect(resolveContrast('system', false)).toBe('standard');
  });

  it('names the query the provider and the bootstrap both watch', () => {
    // One string. Two copies of a media query drift, and the drift is silent.
    expect(CONTRAST_QUERY).toBe('(prefers-contrast: more)');
  });
});

describe('applyContrast', () => {
  function fakeRoot() {
    const attrs = new Map<string, string>();
    return {
      attrs,
      setAttribute: (n: string, v: string) => void attrs.set(n, v),
      removeAttribute: (n: string) => void attrs.delete(n),
    };
  }

  it('stamps the RESOLVED value, never the preference', () => {
    // The stylesheet has exactly one rule and it names `more`. Writing `system`
    // here would mean the CSS had to resolve it, which is the arrangement that
    // could not be switched off.
    const root = fakeRoot();
    applyContrast('more', root);
    expect(root.attrs.get(CONTRAST_ATTRIBUTE)).toBe('more');
  });

  it('REMOVES the attribute for the standard palette', () => {
    // Load-bearing: the one rule names `[data-contrast='more']` positively, so
    // an absent attribute is the standard look. A reader whose bootstrap never
    // ran — JS off, blocked storage, a throw — gets the standard palette rather
    // than a treatment they cannot switch off.
    const root = fakeRoot();
    applyContrast('more', root);
    applyContrast('standard', root);
    expect(root.attrs.has(CONTRAST_ATTRIBUTE)).toBe(false);
  });
});

describe('the pre-paint bootstrap agrees with the module', () => {
  /**
   * The script in `layout.tsx` runs before any module is evaluated, so it
   * carries the storage key, the attribute AND the media query as string
   * literals and CANNOT import them. That is the whole hazard: a rename here
   * leaves a setting that still saves, still renders in the control, and
   * silently stops applying on load.
   */
  const LAYOUT = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8');

  it('uses the same storage key', () => {
    expect(LAYOUT).toContain(`localStorage.getItem('${CONTRAST_STORAGE_KEY}')`);
  });

  it('sets the same attribute, to the same resolved value', () => {
    expect(LAYOUT).toContain(`setAttribute('${CONTRAST_ATTRIBUTE}','more')`);
  });

  it('resolves `system` against the same query', () => {
    // Without this the bootstrap would treat `system` as off until the provider
    // mounted, and a reader on `system` with the OS switch on would see one
    // frame of the standard palette on every hard load.
    expect(LAYOUT).toContain(CONTRAST_QUERY);
  });

  it('applies it before first paint, in <head>', () => {
    // Below the fold of <head> and it is a flash: the reader sees one frame of
    // the untreated app, which for someone who needs the contrast is the frame
    // that matters.
    const head = LAYOUT.slice(LAYOUT.indexOf('<head>'), LAYOUT.indexOf('</head>'));
    expect(head).toContain(CONTRAST_STORAGE_KEY);
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
   * There are NO file-level exemptions, deliberately.
   *
   * A control's edge is a real affordance — an `<input>` or `<select>` with no
   * visible border is not discoverable as a field, and a button's `outline`
   * variant IS its edge. But that is a different job from chrome drawn around a
   * surface, so it gets its own token (`--control`) rather than a hole in this
   * check. Exempting a FILE would let a future card in that same file slip
   * through silently, which is exactly how the borders got everywhere the first
   * time.
   */

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

  it('a control edge is its own token, not the surface outline', () => {
    // `--outline` is transparent by default; an input painted with it would be
    // an invisible field. `--control` is always visible and follows `--border`,
    // including into the `prefers-contrast: more` block, where (for a reader
    // who has not switched edges off) both take a measured on-palette value.
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
    expect(css).toMatch(/--control:\s*var\(--border\)/);
    expect(css).toContain('--color-control: var(--control)');
  });

  it('no component outlines a surface with the separator colour', () => {
    const offenders = walk(join(process.cwd(), 'src'))
      .filter((file) => BOX_OUTLINE.test(readFileSync(file, 'utf8')))
      .map((file) => file.replace(`${process.cwd()}/`, ''));

    expect(offenders).toEqual([]);
  });
});

/**
 * Matte black is the BACKGROUND. It is not an elevated surface colour.
 *
 * Owner report 2026-09-11. Three pieces of chrome that float above the page —
 * the bottom island, the sticky header once scrolled, and the home feed's
 * sticky filter bar — painted themselves `bg-background/NN`, i.e. a
 * translucent wash of the very surface they are floating over. On a near-black
 * dark page that gives an element with no fill of its own, whose only
 * definition is its border; which is exactly why the island read as a
 * wireframe pill rather than as something lifted off the page.
 *
 * The scale already answers this: `--raised` is Mzizi `raised`, "raised
 * elements above overlay — menus, toasts", and a floating pill is a toast in
 * every way that matters. A role takes the step that carries its name.
 *
 * The check is on the element's OWN class list, so a `bg-background/10` tint
 * painted on a button *inside* sticky chrome is not caught — that is a wash
 * over another fill, not a missing one. `inset-0` is exempt on the same
 * principle rather than as a file carve-out: an element pinned to all four
 * edges IS the page ground, so painting it with the page colour is correct.
 */
describe('elevated chrome does not paint itself with the page background', () => {
  function walkTsx(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== '__tests__' && entry !== 'node_modules') walkTsx(full, out);
      } else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) {
        out.push(full);
      }
    }
    return out;
  }

  /** Every `className` value in a file — a quoted string or a braced expression. */
  function classNameValues(source: string): string[] {
    const values: string[] = [];
    for (const match of source.matchAll(/className=/g)) {
      const start = match.index! + match[0].length;
      const opener = source[start];
      if (opener === '"' || opener === "'") {
        const end = source.indexOf(opener, start + 1);
        if (end !== -1) values.push(source.slice(start + 1, end));
      } else if (opener === '{') {
        let depth = 0;
        let i = start;
        for (; i < source.length; i += 1) {
          if (source[i] === '{') depth += 1;
          else if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        values.push(source.slice(start, i + 1));
      }
    }
    return values;
  }

  it('no fixed or sticky element fills itself with --background', () => {
    const offenders: string[] = [];
    for (const file of walkTsx(join(process.cwd(), 'src'))) {
      for (const value of classNameValues(readFileSync(file, 'utf8'))) {
        if (!/\b(fixed|sticky)\b/.test(value)) continue;
        if (!/\bbg-background\b/.test(value)) continue;
        if (value.includes('inset-0')) continue; // full-bleed: it IS the page
        offenders.push(`${file.replace(`${process.cwd()}/`, '')}: ${value.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

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
  it('only the exact strings are honoured', () => {
    expect(parseOutlinePreference('on')).toBe('on');
    expect(parseOutlinePreference('system')).toBe('system');
  });

  it('anything else is off', () => {
    // Strict rather than truthy on purpose. A half-written or foreign value in
    // localStorage must land on the DEFAULT look — an outlined app the reader
    // never asked for is one they would have no idea how to switch off.
    for (const raw of ['true', 'ON', '1', 'yes', 'SYSTEM', '', null, undefined, 'off']) {
      expect(parseOutlinePreference(raw)).toBe('off');
    }
  });

  it('DEFAULTS to off, not to the OS setting', () => {
    // The report this answers: the OS "Increase Contrast" switch used to turn
    // outlines on over the top of this control, so a reader who had never
    // touched it — and one who had explicitly chosen Off — both got an
    // outlined app while the control read "Off". Following the device is now
    // the third CHOICE, and a reader has to make it.
    expect(parseOutlinePreference(null)).toBe('off');
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

  it('carries "system" through as its own value', () => {
    const root = fakeRoot();
    applyOutlinePreference('system', root);
    expect(root.attrs.get(OUTLINE_ATTRIBUTE)).toBe('system');
  });

  it('REMOVES the attribute rather than setting it to "off"', () => {
    // Load-bearing, not tidiness: every rule that draws an edge names `on` or
    // `system` POSITIVELY, so an absent attribute is the quiet look. A reader
    // whose bootstrap never ran — JS off, blocked storage, a throw — gets no
    // outlines rather than inheriting whatever their OS asked for.
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

  it('sets the same attribute, and honours both stored values', () => {
    expect(LAYOUT).toContain(`setAttribute('${OUTLINE_ATTRIBUTE}',`);
    // Both, or "System" silently becomes "Off" on every hard load — which is
    // the same class of bug as the one that made "Off" mean "outlined".
    expect(LAYOUT).toContain("==='on'||o==='system'");
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
    // including into the `prefers-contrast: more` block where that becomes
    // `CanvasText`.
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

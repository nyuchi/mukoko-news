import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

describe('anchor colour rule stays layered', () => {
  // Unlayered CSS outranks every layered rule regardless of specificity, and
  // Tailwind emits utilities into @layer utilities. While `a { color: inherit }`
  // sat unlayered it silently beat text-on-primary / text-white / every other
  // text-colour utility on ANY <a>. Measured on /insights before the fix, the
  // primary CTA rendered #000000 on #4B0082 — 1.62:1 against a 4.5:1 floor.
  const css = read('src/app/globals.css');

  it('declares the anchor rule inside @layer base', () => {
    const match = css.match(/@layer base \{[\s\S]*?a:where\(:not\(\.prose \*\)\)[\s\S]*?\n\}/);
    expect(match, 'a:where(:not(.prose *)) must live inside @layer base').not.toBeNull();
  });

  it('has no unlayered anchor colour rule left', () => {
    // Strip every @layer block, then look for a bare `a … { … color … }`.
    let depth = 0;
    let unlayered = '';
    let i = 0;
    while (i < css.length) {
      const layerAt = css.indexOf('@layer', i);
      if (layerAt === -1) {
        unlayered += css.slice(i);
        break;
      }
      unlayered += css.slice(i, layerAt);
      // Walk to the end of the @layer block.
      let j = css.indexOf('{', layerAt);
      if (j === -1) break;
      depth = 1;
      j++;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        j++;
      }
      i = j;
    }
    expect(unlayered).not.toMatch(/(^|[\s,}])a:where\(/);
  });
});

describe('page structure', () => {
  it('root layout offers a skip link targeting the main landmark', () => {
    const layout = read('src/app/layout.tsx');
    expect(layout).toMatch(/href="#main-content"/);
    expect(layout).toMatch(/<main id="main-content"/);
  });

  it('home feed does not nest a second main landmark', () => {
    // The root layout owns the single <main>; a nested one made axe report
    // landmark-no-duplicate-main / landmark-main-is-top-level on "/".
    expect(read('src/app/home-client.tsx')).not.toMatch(/<main[\s>]/);
  });

  it('the NewsBytes feed has exactly one h1, with per-slide titles as h2', () => {
    // Every slide used to render its own <h1>, so a 20-byte feed produced 20
    // top-level headings and heading navigation was useless.
    const nb = read('src/app/newsbytes/page.tsx');
    const h1s = nb.match(/<h1[\s>]/g) || [];
    expect(h1s).toHaveLength(1);
    expect(nb).toMatch(/<h1 className="sr-only">/);
    expect(nb).toMatch(/<h2[^>]*>\s*\{byte\.title\}/);
  });

  it('the sources filters are named', () => {
    const sources = read('src/app/sources/page.tsx');
    expect(sources).toMatch(/aria-label="Filter sources by country"/);
    expect(sources).toMatch(/aria-label="Sort sources"/);
  });
});

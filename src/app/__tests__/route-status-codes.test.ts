import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const APP_DIR = join(process.cwd(), 'src', 'app');

/**
 * A `loading.tsx` above a page that answers 404 or 5xx is a SOFT 200.
 *
 * ## Measured 2026-09-17, on a production build
 *
 * `loading.tsx` is a Suspense boundary wrapped around the segment's children.
 * Next streams the shell as soon as the boundary suspends — and the HTTP status
 * line goes out WITH that shell, before the page's async work has resolved.
 * Once it is sent it cannot be taken back, so whatever the page decides
 * afterwards is rendered into a response that already said `200 OK`.
 *
 * One file, `src/app/loading.tsx`, sat above every route in the app:
 *
 * | route                          | with it | without it |
 * | ------------------------------ | ------- | ---------- |
 * | a page calling `notFound()`    | **200** | 404        |
 * | the same page, ISR or dynamic  | **200** | 404        |
 * | a page that throws             | **200** | 500        |
 * | `/author/…` over a dead cluster| **200** | 500        |
 *
 * That is the HTTP 200 in the original byline report, and it was never about
 * bylines: `notFound()` and `throw` alike answered 200 from EVERY rendered
 * dynamic route. `/article/[id]` carried its own `loading.tsx` on top, which is
 * why every dead article id was a 200 to a crawler — the exact soft-404 that
 * page's own comment says it exists to prevent.
 *
 * Ruled out on the way, each by rebuilding without it: the AuthKit middleware,
 * `revalidate` (`force-dynamic` behaves identically), MongoDB, and the author
 * route specifically. A page whose entire body is `throw new Error(...)`
 * reproduced it with no database and no ISR.
 *
 * So a route that can answer 404 or 5xx must not stream its shell early, and
 * this test is the guard. It is deliberately about ANCESTRY rather than about
 * one file: the root `loading.tsx` is an ancestor of everything, which is how a
 * boundary nobody associated with `/author` decided its status code.
 *
 * The remaining `loading.tsx` files are legitimate — `/discover` and
 * `/insights` are prerendered, fail-soft, and neither calls `notFound()` nor
 * throws, so neither has a status code to lose. If one ever grows a
 * `notFound()`, this fails and names it.
 */
function pageFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      pageFiles(full, found);
    } else if (entry === 'page.tsx') {
      found.push(full);
    }
  }
  return found;
}

/** Source with comments stripped — this file's own prose quotes `notFound()`. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every directory from `src/app` down to the page's own segment. */
function ancestorDirs(pageFile: string): string[] {
  const segments = relative(APP_DIR, pageFile).split(sep).slice(0, -1);
  const dirs = [APP_DIR];
  let current = APP_DIR;
  for (const segment of segments) {
    current = join(current, segment);
    dirs.push(current);
  }
  return dirs;
}

function hasLoading(dir: string): boolean {
  try {
    statSync(join(dir, 'loading.tsx'));
    return true;
  } catch {
    return false;
  }
}

describe('route status codes are not thrown away by a streaming boundary', () => {
  const pages = pageFiles(APP_DIR);

  it('finds the app router pages at all', () => {
    // A walker that silently matches nothing would pass every assertion below.
    expect(pages.length).toBeGreaterThan(10);
  });

  it('no page that answers 404 or 5xx sits under a loading.tsx', () => {
    const offenders: string[] = [];

    for (const page of pages) {
      const src = code(page);
      const signals: string[] = [];
      if (/\bnotFound\(\)/.test(src)) signals.push('notFound()');
      if (/\bthrow new\b/.test(src)) signals.push('throw');
      if (signals.length === 0) continue;

      for (const dir of ancestorDirs(page)) {
        if (!hasLoading(dir)) continue;
        offenders.push(
          `${relative(process.cwd(), page)} answers ${signals.join(' / ')}, but ` +
            `${relative(process.cwd(), join(dir, 'loading.tsx'))} streams the shell ` +
            `(and the 200) before it decides`
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps no loading.tsx at the app root, which is an ancestor of every route', () => {
    // The specific file that caused the incident. Called out separately from the
    // ancestry rule above so a reintroduction fails with the reason attached
    // rather than as one line in a list.
    expect(hasLoading(APP_DIR)).toBe(false);
  });
});

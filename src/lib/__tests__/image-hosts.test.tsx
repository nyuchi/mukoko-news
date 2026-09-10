/**
 * The image-host allowlist decision, held in place structurally.
 *
 * `images.remotePatterns` used to be `[{ hostname: '**' }]`, which made
 * `/_next/image?url=…` an open proxy for any HTTPS host on the internet. It is
 * now exactly one host — the Mukoko image worker — because an explicit
 * publisher allowlist is unmaintainable: 340 distinct image hosts on the live
 * corpus, 238 of them first seen inside four weeks.
 *
 * That only holds while every `next/image` using the DEFAULT loader is fed a
 * proxied URL. `next/image`'s remotePatterns check THROWS (it does not render a
 * broken image, it fails the render), so a component that slips a raw publisher
 * host past it takes the page down. These tests are the guard.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import nextConfig from '../../../next.config';
import { imageProxyUrl } from '@/lib/image';
import { ALLOWED_IMAGE_HOST } from '@/lib/security-headers';
import { ArticleCard } from '@/components/article-card';
import type { Article } from '@/lib/api';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Partial mock: only the rendering half of the module is stubbed. `sourceIconProps`
// is a pure derivation the card calls before rendering, and mocking it away would
// mean this file no longer exercises the real call the card makes.
vi.mock('@/components/ui/source-icon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/source-icon')>()),
  SourceBadge: ({ source }: { source: string }) => <span>{source}</span>,
}));

vi.mock('@/components/ui/engagement-bar', () => ({
  InlineEngagement: () => <div />,
}));

const SRC_DIR = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : walk(full);
    }
    return full.endsWith('.tsx') ? [full] : [];
  });
}

describe('images.remotePatterns', () => {
  const patterns = nextConfig.images?.remotePatterns ?? [];

  it('is not a wildcard open proxy', () => {
    for (const pattern of patterns) {
      const hostname = typeof pattern === 'string' ? pattern : pattern.hostname;
      expect(hostname).not.toBe('**');
      expect(hostname).not.toBe('*');
    }
  });

  it('allows exactly the image worker, over https, on its /i/ path only', () => {
    expect(patterns).toEqual([
      { protocol: 'https', hostname: ALLOWED_IMAGE_HOST, pathname: '/i/**' },
    ]);
  });

  it('matches what imageProxyUrl actually produces', () => {
    // Every publisher image — including the long-tail hosts an allowlist could
    // never keep up with — comes out on the one allowed host.
    for (const raw of [
      'https://iol-prod.appspot.com/image/x.jpg',
      'https://cdn.punchng.com/wp-content/uploads/y.png?w=600',
      'http://www.channelstv.com/insecure.jpg',
      'https://brand-new-publisher-discovered-today.example/z.webp',
    ]) {
      const proxied = new URL(imageProxyUrl(raw, { width: 600 }));
      expect(proxied.protocol).toBe('https:');
      expect(proxied.hostname).toBe(ALLOWED_IMAGE_HOST);
      expect(proxied.pathname.startsWith('/i/')).toBe(true);
    }
  });
});

/**
 * Why a given `<Image>` cannot reach an un-allowlisted host, or `null` if
 * nothing establishes that. The four safe shapes:
 *   - a custom `loader` (bypasses remotePatterns entirely),
 *   - `unoptimized` (never calls the optimiser),
 *   - a local `/…` asset,
 *   - a src that came out of `imageProxyUrl`.
 */
function reasonItIsSafe(element: string, source: string): string | null {
  if (/\bloader=/.test(element)) return 'custom loader';
  if (/\bunoptimized\b/.test(element)) return 'unoptimized';
  if (/src=\{?["'`]\//.test(element)) return 'local asset literal';
  if (/src=\{[^}]*imageProxyUrl/.test(element)) return 'inline imageProxyUrl';

  // `src={someVar}` — resolve the binding in the same file.
  const bound = element.match(/src=\{(\w+)\}/)?.[1];
  if (bound) {
    const decl = source.match(
      new RegExp(`(?:const|let)\\s+${bound}\\b[\\s\\S]{0,400}?(?:\\n\\s*\\n|;)`)
    )?.[0];
    if (decl?.includes('imageProxyUrl')) return 'variable from imageProxyUrl';
    // Only local paths assigned, and no absolute URL anywhere in the binding.
    if (decl && /["'`]\//.test(decl) && !/https?:\/\//.test(decl)) {
      return 'variable holding local asset paths';
    }
  }

  return null;
}

describe('every next/image in the tree stays inside the allowlist', () => {
  // A raw `<Image src={publisherUrl}>` on the default loader would throw at
  // render time. Each usage must therefore be one of: a custom `loader`, an
  // `unoptimized` image, a local `/…` asset, or an already-proxied URL.
  const files = walk(SRC_DIR).filter((f) => readFileSync(f, 'utf8').includes('<Image'));

  it('finds the next/image call sites (guard is not silently vacuous)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.replace(`${process.cwd()}/`, ''), f]))(
    '%s routes its image safely',
    (_label, file) => {
      const source = readFileSync(file, 'utf8');
      // Each JSX <Image …> element, up to its closing bracket.
      const elements = source.match(/<Image\b[\s\S]*?\/>/g) ?? [];
      expect(elements.length).toBeGreaterThan(0);

      for (const element of elements) {
        expect(reasonItIsSafe(element, source), `unsafe <Image> in ${file}:\n${element}`)
          .not.toBeNull();
      }
    }
  );
});

describe('an image the allowlist would reject degrades to the no-image card', () => {
  const article: Article = {
    id: '1',
    title: 'Test Article Title',
    description: 'Test article description',
    slug: 'test-article',
    source: 'The Herald',
    published_at: new Date().toISOString(),
  };

  it('renders a proxied <img> for a publisher host that is not in remotePatterns', () => {
    render(
      <ArticleCard
        article={{ ...article, image_url: 'https://never-allowlisted.example/a.jpg' }}
      />
    );
    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    expect(new URL(img!.getAttribute('src')!).hostname).toBe(ALLOWED_IMAGE_HOST);
  });

  it('renders NO image element at all when the url is unusable', () => {
    // isValidImageUrl rejects it → `image` is undefined → the card's `{image &&}`
    // branch never renders an <img>. Not a broken image: no image.
    render(
      <ArticleCard article={{ ...article, image_url: 'javascript:alert(1)' }} />
    );
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('Test Article Title')).toBeInTheDocument();
  });

  it('renders NO image element at all when the article has no image', () => {
    render(<ArticleCard article={article} />);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('Test Article Title')).toBeInTheDocument();
  });
});

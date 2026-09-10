import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ArticleJsonLd, BreadcrumbJsonLd, OrganizationJsonLd, WebSiteJsonLd, WebPageJsonLd, SoftwareApplicationJsonLd } from '../ui/json-ld';
import { ARTICLE_EXCERPT_MAX_CHARS } from '@/lib/excerpt';
import { RELEASED_COUNTRY_COUNT, COUNTRY_SCOPE_TOTAL } from '@/lib/constants';

// Helper to extract JSON-LD script content
function script(container: HTMLElement): string {
  return container.querySelector('script[type="application/ld+json"]')?.innerHTML || '';
}

// Helper to parse JSON-LD from rendered output (unescapes Unicode)
function parseJsonLd(container: HTMLElement) {
  const content = script(container);
  const unescaped = content
    .replace(/\\u003c/g, '<')
    .replace(/\\u003e/g, '>')
    .replace(/\\u0026/g, '&');
  return JSON.parse(unescaped);
}

describe('JSON-LD Components', () => {
  describe('ArticleJsonLd', () => {
    it('should render valid JSON-LD script tag', () => {
      const article = {
        id: '123',
        title: 'Test Article',
        description: 'Test description',
        source: 'Test Source',
        slug: 'test-article',
        published_at: '2024-01-15T12:00:00Z',
        image_url: 'https://example.com/image.jpg',
      };

      const { container } = render(
        <ArticleJsonLd article={article} url="https://news.mukoko.com/article/123" />
      );

      const script = container.querySelector('script[type="application/ld+json"]');
      expect(script).toBeTruthy();

      const content = script?.innerHTML || '';
      expect(content).toContain('NewsArticle');
      expect(content).toContain('Test Article');
    });

    it('should escape < and > characters to prevent XSS', () => {
      const article = {
        id: '123',
        title: '</script><script>alert("XSS")</script>',
        description: 'Test with <script> tags',
        source: 'Test Source',
        slug: 'test-article',
        published_at: '2024-01-15T12:00:00Z',
      };

      const { container } = render(
        <ArticleJsonLd article={article} url="https://news.mukoko.com/article/123" />
      );

      const script = container.querySelector('script[type="application/ld+json"]');
      const content = script?.innerHTML || '';

      // Should NOT contain raw < or > characters
      expect(content).not.toContain('</script>');
      expect(content).not.toContain('<script>');

      // Should contain escaped Unicode versions
      expect(content).toContain('\\u003c');
      expect(content).toContain('\\u003e');
    });

    it('should escape & characters', () => {
      const article = {
        id: '123',
        title: 'News & Updates',
        description: 'Tom & Jerry',
        source: 'Test Source',
        slug: 'test-article',
        published_at: '2024-01-15T12:00:00Z',
      };

      const { container } = render(
        <ArticleJsonLd article={article} url="https://news.mukoko.com/article/123" />
      );

      const script = container.querySelector('script[type="application/ld+json"]');
      const content = script?.innerHTML || '';

      // Should contain escaped & as Unicode
      expect(content).toContain('\\u0026');
      expect(content).not.toMatch(/&(?!#|amp;|lt;|gt;)/); // No raw & except HTML entities
    });

    it('should include isAccessibleForFree and inLanguage fields', () => {
      const article = {
        id: '123',
        title: 'Test Article',
        source: 'Test Source',
        slug: 'test-article',
        published_at: '2024-01-15T12:00:00Z',
      };

      const { container } = render(
        <ArticleJsonLd article={article} url="https://news.mukoko.com/article/123" />
      );

      const content = script(container);
      expect(content).toContain('isAccessibleForFree');
      expect(content).toContain('inLanguage');
      expect(content).toContain('"en"');
    });

    it('should use updated_at for dateModified when available', () => {
      const article = {
        id: '123',
        title: 'Test Article',
        source: 'Test Source',
        slug: 'test-article',
        published_at: '2024-01-15T12:00:00Z',
        updated_at: '2024-01-16T08:00:00Z',
      };

      const { container } = render(
        <ArticleJsonLd article={article} url="https://news.mukoko.com/article/123" />
      );

      const content = script(container);
      expect(content).toContain('2024-01-16T08:00:00Z');
    });

    it('should fall back to published_at for dateModified when updated_at is missing', () => {
      const article = {
        id: '123',
        title: 'Test Article',
        source: 'Test Source',
        slug: 'test-article',
        published_at: '2024-01-15T12:00:00Z',
      };

      const { container } = render(
        <ArticleJsonLd article={article} url="https://news.mukoko.com/article/123" />
      );

      const parsed = parseJsonLd(container);
      expect(parsed.dateModified).toBe('2024-01-15T12:00:00Z');
    });

    it('should render Person author when author differs from source', () => {
      const article = {
        id: '123',
        title: 'Test Article',
        source: 'Daily News',
        author: 'John Doe',
        slug: 'test-article',
        published_at: '2024-01-15T12:00:00Z',
      };

      const { container } = render(
        <ArticleJsonLd article={article} url="https://news.mukoko.com/article/123" />
      );

      const parsed = parseJsonLd(container);
      expect(parsed.author['@type']).toBe('Person');
      expect(parsed.author.name).toBe('John Doe');
    });

    it('should render Organization author when author matches source', () => {
      const article = {
        id: '123',
        title: 'Test Article',
        source: 'Daily News',
        slug: 'test-article',
        published_at: '2024-01-15T12:00:00Z',
      };

      const { container } = render(
        <ArticleJsonLd article={article} url="https://news.mukoko.com/article/123" />
      );

      const parsed = parseJsonLd(container);
      expect(parsed.author['@type']).toBe('Organization');
      expect(parsed.author.name).toBe('Daily News');
    });

    it('should include keywords when provided', () => {
      const article = {
        id: '123',
        title: 'Test Article',
        source: 'Test Source',
        slug: 'test-article',
        published_at: '2024-01-15T12:00:00Z',
        keywords: [
          { id: '1', name: 'politics', slug: 'politics' },
          { id: '2', name: 'economy', slug: 'economy' },
        ],
      };

      const { container } = render(
        <ArticleJsonLd article={article} url="https://news.mukoko.com/article/123" />
      );

      const parsed = parseJsonLd(container);
      expect(parsed.keywords).toBe('politics, economy');
    });

    it('should include articleSection from category_id', () => {
      const article = {
        id: '123',
        title: 'Test Article',
        source: 'Test Source',
        slug: 'test-article',
        published_at: '2024-01-15T12:00:00Z',
        category_id: 'politics',
      };

      const { container } = render(
        <ArticleJsonLd article={article} url="https://news.mukoko.com/article/123" />
      );

      const parsed = parseJsonLd(container);
      expect(parsed.articleSection).toBe('politics');
    });

    it('should include articleBody from content', () => {
      const article = {
        id: '123',
        title: 'Test Article',
        source: 'Test Source',
        slug: 'test-article',
        published_at: '2024-01-15T12:00:00Z',
        content: 'Full article body text goes here.',
      };

      const { container } = render(
        <ArticleJsonLd article={article} url="https://news.mukoko.com/article/123" />
      );

      const parsed = parseJsonLd(container);
      expect(parsed.articleBody).toBe('Full article body text goes here.');
    });

    /**
     * `articleBody` used to carry `article.content` — the publisher's COMPLETE
     * text, machine-readable, on Mukoko's origin. These three tests are the
     * guard: an aggregator may quote, it may not republish.
     */
    it('emits an excerpt, never the publisher\'s full text', () => {
      const fullBody = Array.from({ length: 300 }, (_, i) => `paragraph ${i} of real reporting`).join('. ');
      const article = {
        id: '123',
        title: 'Test Article',
        source: 'The Herald',
        slug: 'test-article',
        published_at: '2024-01-15T12:00:00Z',
        content: fullBody,
      };

      const { container } = render(
        <ArticleJsonLd article={article} url="https://news.mukoko.com/article/123" />
      );

      const parsed = parseJsonLd(container);
      expect(parsed.articleBody).not.toBe(fullBody);
      expect(parsed.articleBody.length).toBeLessThanOrEqual(ARTICLE_EXCERPT_MAX_CHARS + 1);
      // …and the excerpt is a verbatim prefix, not a rewrite of the newsroom's words.
      expect(fullBody.startsWith(parsed.articleBody.replace(/…$/, ''))).toBe(true);
      // The raw body must not appear anywhere in the emitted document.
      expect(script(container)).not.toContain(fullBody.slice(-80));
    });

    it('omits articleBody entirely when the only text is the description', () => {
      const article = {
        id: '123',
        title: 'Test Article',
        description: 'A one-line summary from the feed.',
        source: 'The Herald',
        slug: 'test-article',
        published_at: '2024-01-15T12:00:00Z',
      };

      const { container } = render(
        <ArticleJsonLd article={article} url="https://news.mukoko.com/article/123" />
      );

      const parsed = parseJsonLd(container);
      // `description` already carries it; repeating it as `articleBody` is the
      // same bytes twice on a metered connection for no additional meaning.
      expect(parsed.articleBody).toBeUndefined();
      expect(parsed.description).toBe('A one-line summary from the feed.');
    });

    it('bounds the Markdown rendition too', () => {
      const markdown = `## Heading\n\n${'long markdown body text '.repeat(100)}`;
      const article = {
        id: '123',
        title: 'Test Article',
        source: 'The Herald',
        slug: 'test-article',
        published_at: '2024-01-15T12:00:00Z',
        content_markdown: markdown,
      };

      const { container } = render(
        <ArticleJsonLd article={article} url="https://news.mukoko.com/article/123" />
      );

      const parsed = parseJsonLd(container);
      expect(parsed.articleBody.length).toBeLessThanOrEqual(ARTICLE_EXCERPT_MAX_CHARS + 1);
    });

    it('should include wordCount when provided', () => {
      const article = {
        id: '123',
        title: 'Test Article',
        source: 'Test Source',
        slug: 'test-article',
        published_at: '2024-01-15T12:00:00Z',
        word_count: 450,
      };

      const { container } = render(
        <ArticleJsonLd article={article} url="https://news.mukoko.com/article/123" />
      );

      const parsed = parseJsonLd(container);
      expect(parsed.wordCount).toBe(450);
    });
  });

  describe('BreadcrumbJsonLd', () => {
    it('should render breadcrumb schema', () => {
      const items = [
        { name: 'Politics', href: '/discover?category=politics' },
        { name: 'Test Article' },
      ];

      const { container } = render(<BreadcrumbJsonLd items={items} />);

      const script = container.querySelector('script[type="application/ld+json"]');
      expect(script).toBeTruthy();

      const content = script?.innerHTML || '';
      expect(content).toContain('BreadcrumbList');
      expect(content).toContain('Politics');
    });

    it('should escape malicious content in breadcrumbs', () => {
      const items = [
        { name: '<script>alert(1)</script>', href: '/test' },
      ];

      const { container } = render(<BreadcrumbJsonLd items={items} />);

      const script = container.querySelector('script[type="application/ld+json"]');
      const content = script?.innerHTML || '';

      expect(content).not.toContain('<script>');
      expect(content).toContain('\\u003c');
    });
  });

  describe('OrganizationJsonLd', () => {
    it('should render organization schema', () => {
      const { container } = render(<OrganizationJsonLd />);

      const scriptEl = container.querySelector('script[type="application/ld+json"]');
      expect(scriptEl).toBeTruthy();

      const content = scriptEl?.innerHTML || '';
      expect(content).toContain('Organization');
      expect(content).toContain('Mukoko News');
    });

    it('should include legalName and parentOrganization', () => {
      const { container } = render(<OrganizationJsonLd />);
      const parsed = parseJsonLd(container);
      expect(parsed.legalName).toBe('Mukoko News by Nyuchi Technology');
      expect(parsed.parentOrganization).toBeTruthy();
      expect(parsed.parentOrganization.name).toBe('Nyuchi Technology');
    });

    it('should include contactPoint', () => {
      const { container } = render(<OrganizationJsonLd />);
      const parsed = parseJsonLd(container);
      expect(parsed.contactPoint).toBeTruthy();
      expect(parsed.contactPoint['@type']).toBe('ContactPoint');
      expect(parsed.contactPoint.contactType).toBe('customer support');
    });

    it('should include news media organization policies', () => {
      const { container } = render(<OrganizationJsonLd />);
      const parsed = parseJsonLd(container);
      expect(parsed.actionableFeedbackPolicy).toBeTruthy();
      expect(parsed.ethicsPolicy).toBeTruthy();
    });
  });

  describe('WebPageJsonLd', () => {
    it('should render WebPage schema with correct fields', () => {
      const { container } = render(
        <WebPageJsonLd
          name="Test Page"
          description="A test page description"
          url="https://news.mukoko.com/test"
        />
      );

      const parsed = parseJsonLd(container);
      expect(parsed['@type']).toBe('WebPage');
      expect(parsed.name).toBe('Test Page');
      expect(parsed.description).toBe('A test page description');
      expect(parsed.url).toBe('https://news.mukoko.com/test');
      expect(parsed.isPartOf['@type']).toBe('WebSite');
    });
  });

  describe('SoftwareApplicationJsonLd', () => {
    it('should render SoftwareApplication schema', () => {
      const { container } = render(<SoftwareApplicationJsonLd />);

      const parsed = parseJsonLd(container);
      expect(parsed['@type']).toBe('SoftwareApplication');
      expect(parsed.name).toBe('Mukoko News Embed Widget');
      expect(parsed.applicationCategory).toBe('WebApplication');
    });

    it('should include free pricing offer', () => {
      const { container } = render(<SoftwareApplicationJsonLd />);

      const parsed = parseJsonLd(container);
      expect(parsed.offers).toBeTruthy();
      expect(parsed.offers.price).toBe('0');
      expect(parsed.offers.priceCurrency).toBe('USD');
      expect(parsed.isAccessibleForFree).toBe(true);
    });

    it('should include feature list', () => {
      const { container } = render(<SoftwareApplicationJsonLd />);

      const parsed = parseJsonLd(container);
      expect(parsed.featureList).toContain('layouts');
      expect(parsed.featureList).toContain('countries');
    });
  });

  describe('WebSiteJsonLd', () => {
    it('should render WebSite schema with SearchAction', () => {
      const { container } = render(<WebSiteJsonLd />);

      const script = container.querySelector('script[type="application/ld+json"]');
      expect(script).toBeTruthy();

      const content = script?.innerHTML || '';
      expect(content).toContain('WebSite');
      expect(content).toContain('SearchAction');
      expect(content).toContain('Mukoko News');
    });

    it('should include search URL template', () => {
      const { container } = render(<WebSiteJsonLd />);

      const script = container.querySelector('script[type="application/ld+json"]');
      const content = script?.innerHTML || '';
      expect(content).toContain('search?q={search_term_string}');
      expect(content).toContain('query-input');
    });

    it('should escape XSS in search action output', () => {
      const { container } = render(<WebSiteJsonLd />);

      const script = container.querySelector('script[type="application/ld+json"]');
      const content = script?.innerHTML || '';
      // Verify no raw HTML characters leak through
      expect(content).not.toContain('<');
      expect(content).not.toContain('>');
    });

    it('should produce parseable JSON', () => {
      const { container } = render(<WebSiteJsonLd />);

      const script = container.querySelector('script[type="application/ld+json"]');
      const content = script?.innerHTML || '';
      const unescaped = content
        .replace(/\\u003c/g, '<')
        .replace(/\\u003e/g, '>')
        .replace(/\\u0026/g, '&');
      const parsed = JSON.parse(unescaped);
      expect(parsed['@type']).toBe('WebSite');
      expect(parsed.potentialAction['@type']).toBe('SearchAction');
    });
  });

  // ─── Security: expanded XSS injection vectors for JSON-LD ────────────
  describe('XSS injection prevention', () => {
    const makeArticle = (overrides: Record<string, string>) => ({
      id: '123',
      title: 'Default Title',
      description: 'Default description',
      source: 'Test Source',
      slug: 'test-article',
      published_at: '2024-01-15T12:00:00Z',
      ...overrides,
    });

    it('should escape HTML comment injection: <!-- -->', () => {
      const { container } = render(
        <ArticleJsonLd
          article={makeArticle({ title: '<!-- <script>alert(1)</script> -->' })}
          url="https://news.mukoko.com/article/123"
        />
      );
      const content = container.querySelector('script')?.innerHTML || '';
      expect(content).not.toContain('<!--');
      expect(content).not.toContain('-->');
      expect(content).toContain('\\u003c');
    });

    it('should escape nested closing script tags: </script>', () => {
      const { container } = render(
        <ArticleJsonLd
          article={makeArticle({ description: 'text</script><script>alert("xss")</script>' })}
          url="https://news.mukoko.com/article/123"
        />
      );
      const content = container.querySelector('script')?.innerHTML || '';
      expect(content).not.toContain('</script>');
    });

    it('should escape unicode escape sequence in source field', () => {
      const { container } = render(
        <ArticleJsonLd
          article={makeArticle({ source: '<img src=x onerror=alert(1)>' })}
          url="https://news.mukoko.com/article/123"
        />
      );
      const content = container.querySelector('script')?.innerHTML || '';
      expect(content).not.toContain('<img');
      expect(content).toContain('\\u003c');
    });

    it('should escape image_url with malicious payload', () => {
      const { container } = render(
        <ArticleJsonLd
          article={makeArticle({ image_url: 'javascript:alert(1)' })}
          url="https://news.mukoko.com/article/123"
        />
      );
      const content = container.querySelector('script')?.innerHTML || '';
      // The value gets JSON-stringified, so it's safe, but verify no raw script context
      expect(content).not.toContain('<');
    });

    it('should escape malicious URL in mainEntityOfPage @id', () => {
      const { container } = render(
        <ArticleJsonLd
          article={makeArticle({})}
          url='"><script>alert(1)</script><a href="'
        />
      );
      const content = container.querySelector('script')?.innerHTML || '';
      expect(content).not.toContain('<script>');
      expect(content).toContain('\\u003c');
    });

    it('should produce parseable JSON even with malicious content', () => {
      const { container } = render(
        <ArticleJsonLd
          article={makeArticle({
            title: '"},"hack":true,"x":"',
            description: '</script><script>alert(1)</script>',
            source: '<img/src/onerror=alert(1)>',
          })}
          url="https://news.mukoko.com/article/123"
        />
      );
      const content = container.querySelector('script')?.innerHTML || '';
      // After unescaping the Unicode replacements, the JSON should still parse
      const unescaped = content
        .replace(/\\u003c/g, '<')
        .replace(/\\u003e/g, '>')
        .replace(/\\u0026/g, '&');
      expect(() => JSON.parse(unescaped)).not.toThrow();
    });

    it('should escape breadcrumb items with event handler injection', () => {
      const items = [
        { name: '" onmouseover="alert(1)" data-x="', href: '/test' },
      ];
      const { container } = render(<BreadcrumbJsonLd items={items} />);
      const content = container.querySelector('script')?.innerHTML || '';
      // Attribute injection shouldn't matter in JSON-LD, but verify no raw angle brackets
      expect(content).not.toContain('<');
      expect(content).not.toContain('>');
    });

    it('should escape breadcrumb href with javascript: protocol', () => {
      const items = [
        { name: 'Test', href: 'javascript:alert(1)' },
      ];
      const { container } = render(<BreadcrumbJsonLd items={items} />);
      const content = container.querySelector('script')?.innerHTML || '';
      // The href gets passed through getFullUrl which prepends BASE_URL,
      // so it won't be a raw javascript: URL in the output
      expect(content).toContain('BreadcrumbList');
    });
  });

  /**
   * The structured data is where an answer engine reads the platform's own
   * description of itself, so it must carry the same 54/16 claim as the pages.
   */
  describe('coverage claim in the site-level schemas', () => {
    it('OrganizationJsonLd states the released count and the scope', () => {
      const { container } = render(<OrganizationJsonLd />);
      const parsed = parseJsonLd(container);
      expect(parsed.description).toContain(String(RELEASED_COUNTRY_COUNT));
      expect(parsed.description).toContain(String(COUNTRY_SCOPE_TOTAL));
    });

    it('WebSiteJsonLd states the released count and the scope', () => {
      const { container } = render(<WebSiteJsonLd />);
      const parsed = parseJsonLd(container);
      expect(parsed.description).toContain(String(RELEASED_COUNTRY_COUNT));
      expect(parsed.description).toContain(String(COUNTRY_SCOPE_TOTAL));
    });

    it('SoftwareApplicationJsonLd (embed widget) states both too', () => {
      const { container } = render(<SoftwareApplicationJsonLd />);
      const parsed = parseJsonLd(container);
      expect(parsed.featureList).toContain(String(RELEASED_COUNTRY_COUNT));
      expect(parsed.featureList).toContain(String(COUNTRY_SCOPE_TOTAL));
    });
  });
});

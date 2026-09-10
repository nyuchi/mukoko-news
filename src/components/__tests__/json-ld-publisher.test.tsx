import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ArticleJsonLd, ItemListJsonLd } from '../ui/json-ld';

// Owner decision: `NewsArticle.publisher` is the ORIGINATING NEWSROOM (CNN, The
// Herald), resolved through the platform's entity model, not "Mukoko News".
// Mukoko aggregates this reporting; declaring itself the publisher of someone
// else's journalism — with someone else's byline underneath — is the defect
// these tests lock shut.

function parseJsonLd(container: HTMLElement) {
  const content = container.querySelector('script[type="application/ld+json"]')?.innerHTML || '';
  return JSON.parse(
    content.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&')
  );
}

const base = {
  id: 'a1',
  title: 'Cabinet approves the budget',
  description: 'A summary.',
  source: 'Daily Monitor v2',
  slug: 'cabinet-approves-the-budget',
  published_at: '2026-09-01T08:00:00Z',
};

const publisher = {
  id: '01977200-0b00-7000-8000-000000000011',
  name: 'Daily Monitor Uganda',
  url: 'https://www.monitor.co.ug',
  isVerified: false,
};

describe('NewsArticle publisher', () => {
  it('names the originating newsroom, not Mukoko', () => {
    const { container } = render(
      <ArticleJsonLd article={{ ...base, publisher }} url="https://news.mukoko.com/article/a1" />
    );
    const schema = parseJsonLd(container);
    expect(schema.publisher).toEqual({
      '@type': 'Organization',
      name: 'Daily Monitor Uganda',
      url: 'https://www.monitor.co.ug',
    });
  });

  it('never attaches Mukoko’s logo to another newsroom’s publisher record', () => {
    const { container } = render(
      <ArticleJsonLd article={{ ...base, publisher }} url="https://news.mukoko.com/article/a1" />
    );
    const schema = parseJsonLd(container);
    expect(schema.publisher.logo).toBeUndefined();
    expect(JSON.stringify(schema.publisher)).not.toContain('mukoko');
  });

  it('emits the newsroom’s own logo when its record actually has one', () => {
    const { container } = render(
      <ArticleJsonLd
        article={{ ...base, publisher: { ...publisher, logo: 'https://cdn.monitor.co.ug/l.png' } }}
        url="https://news.mukoko.com/article/a1"
      />
    );
    expect(parseJsonLd(container).publisher.logo).toEqual({
      '@type': 'ImageObject',
      url: 'https://cdn.monitor.co.ug/l.png',
    });
  });

  it('prefers the organisation over the feed-source name — one masthead, one publisher', () => {
    // The same newsroom ships under three feed-source names on the live cluster;
    // the organisation collapses them to one.
    const names = ['Monitor', 'Daily Monitor', 'Daily Monitor v2'].map((source) => {
      const { container } = render(
        <ArticleJsonLd article={{ ...base, source, publisher }} url="https://x/a" />
      );
      return parseJsonLd(container).publisher.name;
    });
    expect(new Set(names)).toEqual(new Set(['Daily Monitor Uganda']));
  });

  it('falls back to the feed-source name when the organisation is unresolved', () => {
    const { container } = render(
      <ArticleJsonLd article={base} url="https://news.mukoko.com/article/a1" />
    );
    const schema = parseJsonLd(container);
    expect(schema.publisher).toEqual({ '@type': 'Organization', name: 'Daily Monitor v2' });
  });

  it('omits publisher entirely rather than assert one it cannot establish', () => {
    const { container } = render(
      <ArticleJsonLd article={{ ...base, source: '' }} url="https://news.mukoko.com/article/a1" />
    );
    const schema = parseJsonLd(container);
    expect('publisher' in schema).toBe(false);
  });

  it('attributes an un-bylined piece to the newsroom, not to two names for it', () => {
    const { container } = render(
      <ArticleJsonLd article={{ ...base, publisher }} url="https://x/a" />
    );
    const schema = parseJsonLd(container);
    expect(schema.author).toEqual({ '@type': 'Organization', name: 'Daily Monitor Uganda' });
    expect(schema.author.name).toBe(schema.publisher.name);
  });

  it('keeps a real byline as the Person author alongside the newsroom publisher', () => {
    const { container } = render(
      <ArticleJsonLd article={{ ...base, publisher, author: 'Tendai Moyo' }} url="https://x/a" />
    );
    const schema = parseJsonLd(container);
    expect(schema.author).toEqual({ '@type': 'Person', name: 'Tendai Moyo' });
    expect(schema.publisher.name).toBe('Daily Monitor Uganda');
  });
});

describe('ItemList publisher', () => {
  it('no longer claims Mukoko published every listed article', () => {
    const { container } = render(
      <ItemListJsonLd articles={[{ ...base, publisher }, base]} name="Top Stories" />
    );
    const schema = parseJsonLd(container);
    const publishers = schema.itemListElement.map(
      (e: { item: { publisher?: { name: string } } }) => e.item.publisher?.name
    );
    expect(publishers).toEqual(['Daily Monitor Uganda', 'Daily Monitor v2']);
    expect(JSON.stringify(schema)).not.toContain('"Mukoko News"');
  });

  it('omits a list item’s publisher rather than inventing one', () => {
    const { container } = render(<ItemListJsonLd articles={[{ ...base, source: '' }]} />);
    const schema = parseJsonLd(container);
    expect('publisher' in schema.itemListElement[0].item).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopicTimeline, groupArticlesByDay } from '../topic-timeline';
import type { Article } from '@/lib/api';

// The timeline renders in Africa/Harare (CAT, UTC+2) so day rails and times
// are stable regardless of the server/viewer timezone.

function article(overrides: Partial<Article>): Article {
  return {
    id: 'a1',
    title: 'Test headline',
    source: 'Test Source',
    source_id: 's1',
    slug: 'test-headline',
    original_url: 'https://example.com/a',
    published_at: '2026-07-10T08:30:00.000Z',
    updated_at: '2026-07-10T08:30:00.000Z',
    ...overrides,
  } as Article;
}

describe('groupArticlesByDay', () => {
  it('groups consecutive articles by CAT calendar day, newest-first order preserved', () => {
    const days = groupArticlesByDay([
      article({ id: 'a1', published_at: '2026-07-10T20:00:00.000Z' }),
      article({ id: 'a2', published_at: '2026-07-10T06:00:00.000Z' }),
      article({ id: 'a3', published_at: '2026-07-09T12:00:00.000Z' }),
    ]);
    expect(days).toHaveLength(2);
    expect(days[0].articles.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(days[1].articles.map((a) => a.id)).toEqual(['a3']);
    expect(days[0].dayNumber).toBe('10');
    expect(days[1].dayNumber).toBe('9');
  });

  it('assigns a late-UTC article to the NEXT CAT day (UTC+2 rollover)', () => {
    // 23:30 UTC on the 9th is 01:30 CAT on the 10th.
    const days = groupArticlesByDay([article({ published_at: '2026-07-09T23:30:00.000Z' })]);
    expect(days[0].dayNumber).toBe('10');
  });

  it('skips articles with unparseable dates instead of crashing', () => {
    const days = groupArticlesByDay([
      article({ id: 'bad', published_at: 'not-a-date' }),
      article({ id: 'good' }),
    ]);
    expect(days).toHaveLength(1);
    expect(days[0].articles[0].id).toBe('good');
  });
});

describe('TopicTimeline', () => {
  it('renders a date rail and article rows linking to the article pages', () => {
    render(
      <TopicTimeline
        articles={[
          article({ id: 'a1', title: 'First report' }),
          article({ id: 'a2', title: 'Second report', published_at: '2026-07-09T10:00:00.000Z' }),
        ]}
      />
    );
    expect(screen.getByText('First report')).toBeInTheDocument();
    expect(screen.getByText('Second report')).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/article/a1', '/article/a2']);
  });

  it('shows source and category metadata on each row', () => {
    render(<TopicTimeline articles={[article({ category: 'Politics' })]} />);
    expect(screen.getByText('Test Source · Politics')).toBeInTheDocument();
  });

  it('drops unsafe image URLs instead of rendering them', () => {
    render(
      <TopicTimeline
        // eslint-disable-next-line no-script-url
        articles={[article({ image_url: 'javascript:alert(1)' })]}
      />
    );
    expect(document.querySelector('img')).toBeNull();
  });
});

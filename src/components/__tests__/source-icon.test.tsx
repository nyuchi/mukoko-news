import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SourceIcon, SourceBadge, sourceIconProps } from '../ui/source-icon';

vi.mock('next/image', () => ({
  default: ({
    src,
    alt,
    onError,
    // `unoptimized` is a next/image flag, not a DOM attribute — drop it so the
    // mock does not warn about a non-boolean attribute on every render.
    unoptimized: _unoptimized,
    ...props
  }: {
    src: string;
    alt: string;
    onError?: () => void;
    unoptimized?: boolean;
    [key: string]: unknown;
  }) => (
    <img src={src} alt={alt} data-testid="source-favicon" onError={onError} {...props} />
  ),
}));

function favicon() {
  return screen.queryByTestId('source-favicon');
}

describe('SourceIcon — icon resolution', () => {
  it('renders a favicon for a publisher with no hardcoded brand profile', () => {
    // The whole point: 549 of 587 live sources are in this position and used to
    // get initials.
    render(<SourceIcon source="Mmegi Online" sourceUrl="https://www.mmegi.bw/feed/" />);
    const img = favicon();
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', expect.stringContaining('assets.mukoko.com/i/'));
  });

  it('never points the browser at a third-party favicon service', () => {
    render(<SourceIcon source="Mmegi Online" sourceUrl="https://www.mmegi.bw/feed/" />);
    expect(favicon()?.getAttribute('src')).not.toMatch(/^https:\/\/www\.google\.com/);
  });

  it('prefers the organisation record over the feed source', () => {
    render(
      <SourceIcon
        source="Daily Monitor v2"
        organizationUrl="https://www.monitor.co.ug"
        sourceUrl="https://rss.example-syndicator.com/monitor"
      />
    );
    const src = decodeURIComponent(favicon()!.getAttribute('src')!);
    expect(src).toContain('monitor.co.ug');
    expect(src).not.toContain('example-syndicator.com');
  });

  it('falls back to the article’s own host when nothing else is known', () => {
    render(<SourceIcon source="Unknown Outlet" articleUrl="https://zimeye.net/story/1" />);
    expect(decodeURIComponent(favicon()!.getAttribute('src')!)).toContain('zimeye.net');
  });

  it('marks the icon decorative — the source name is always rendered beside it', () => {
    render(<SourceIcon source="Mmegi Online" sourceUrl="https://www.mmegi.bw/" />);
    expect(favicon()).toHaveAttribute('alt', '');
    expect(favicon()).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('SourceIcon — fallback to initials', () => {
  it('draws initials when no publisher URL is available at all', () => {
    render(<SourceIcon source="An Outlet With No Record" />);
    expect(favicon()).not.toBeInTheDocument();
    expect(screen.getByText('AO')).toBeInTheDocument();
  });

  it('draws initials when the icon fails to load', () => {
    render(<SourceIcon source="Mmegi Online" sourceUrl="https://www.mmegi.bw/" />);
    expect(favicon()).toBeInTheDocument();
    fireEvent.error(favicon()!);
    expect(favicon()).not.toBeInTheDocument();
    expect(screen.getByText('MO')).toBeInTheDocument();
  });

  it('draws initials rather than the wrong publisher’s icon for a lookalike name', () => {
    // "National Geographic" contains "Nation"; the old substring table served it
    // the Daily Nation's favicon.
    render(<SourceIcon source="National Geographic" />);
    expect(favicon()).not.toBeInTheDocument();
  });
});

describe('SourceBadge', () => {
  it('renders the source name next to the icon', () => {
    render(<SourceBadge source="Mmegi Online" sourceUrl="https://www.mmegi.bw/" />);
    expect(screen.getByText('Mmegi Online')).toBeInTheDocument();
    expect(favicon()).toBeInTheDocument();
  });
});

describe('sourceIconProps', () => {
  it('maps the article fields the resolver needs', () => {
    expect(
      sourceIconProps({
        source: 'The Herald',
        source_url: 'https://www.herald.co.zw/feed/',
        original_url: 'https://www.herald.co.zw/story',
      })
    ).toEqual({
      source: 'The Herald',
      logo: undefined,
      organizationUrl: undefined,
      sourceUrl: 'https://www.herald.co.zw/feed/',
      articleUrl: 'https://www.herald.co.zw/story',
    });
  });

  it('carries a resolved publisher when the read layer has one', () => {
    // Forward-compatible with the publisher-resolution work: the ORDER lives
    // here, so nothing downstream changes when `Article.publisher` arrives.
    expect(
      sourceIconProps({
        source: 'Daily Monitor v2',
        source_url: 'https://www.monitor.co.ug/feed/',
        publisher: { url: 'https://www.monitor.co.ug', logo: 'https://cdn.monitor.co.ug/l.png' },
      })
    ).toMatchObject({
      logo: 'https://cdn.monitor.co.ug/l.png',
      organizationUrl: 'https://www.monitor.co.ug',
    });
  });

  it('tolerates an article with no publisher URLs at all', () => {
    expect(sourceIconProps({ source: 'X' })).toEqual({
      source: 'X',
      logo: undefined,
      organizationUrl: undefined,
      sourceUrl: undefined,
      articleUrl: undefined,
    });
  });
});

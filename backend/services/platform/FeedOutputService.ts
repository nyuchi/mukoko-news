/**
 * FeedOutputService - RSS 2.0, Atom, JSON Feed output generation
 *
 * Generates syndication feeds in multiple formats so consumers
 * (RSS readers, smart homes, other apps, data pipelines) can
 * subscribe to Mukoko News content.
 *
 * Supported formats:
 * - RSS 2.0 (most widely supported)
 * - Atom 1.0 (RFC 4287, better international support)
 * - JSON Feed 1.1 (modern, easy to parse)
 *
 * Feed types:
 * - /feeds/rss - All articles
 * - /feeds/rss?country=ZW - Country-specific
 * - /feeds/rss?category=politics - Category-specific
 * - /feeds/rss?source=herald - Source-specific
 * - /feeds/atom - Atom format
 * - /feeds/json - JSON Feed format
 */

export interface FeedArticle {
  id: string;
  title: string;
  description: string;
  content: string;
  url: string;
  image_url?: string;
  author?: string;
  published_at: string;
  updated_at?: string;
  source_name: string;
  source_url?: string;
  country_code: string;
  category?: string;
  keywords?: string[];
}

export interface FeedOptions {
  format: 'rss' | 'atom' | 'json';
  country?: string;
  category?: string;
  source?: string;
  limit?: number;
  language?: string;
}

const SITE_URL = 'https://news.mukoko.com';
const FEED_TITLE = 'Mukoko News';
const FEED_DESCRIPTION = 'Pan-African digital news aggregation — where community gathers and stores knowledge';
const FEED_LANGUAGE = 'en';
const FEED_COPYRIGHT = `Copyright ${new Date().getFullYear()} Mukoko News. Open data platform.`;
const FEED_LOGO = `${SITE_URL}/icon-512.png`;
const FEED_ICON = `${SITE_URL}/favicon.ico`;

export class FeedOutputService {
  constructor(private db: D1Database) {}

  /**
   * Generate a feed in the specified format
   */
  async generateFeed(options: FeedOptions): Promise<{
    content: string;
    contentType: string;
    etag: string;
    lastModified: string;
  }> {
    const articles = await this.getArticles(options);
    const lastModified = articles[0]?.published_at ?? new Date().toISOString();

    // Generate ETag from content hash
    const contentHash = await this.generateETag(articles, options);

    let content: string;
    let contentType: string;

    switch (options.format) {
      case 'rss':
        content = this.generateRSS(articles, options);
        contentType = 'application/rss+xml; charset=utf-8';
        break;
      case 'atom':
        content = this.generateAtom(articles, options);
        contentType = 'application/atom+xml; charset=utf-8';
        break;
      case 'json':
        content = this.generateJSONFeed(articles, options);
        contentType = 'application/feed+json; charset=utf-8';
        break;
    }

    return { content, contentType, etag: contentHash, lastModified };
  }

  /**
   * Generate RSS 2.0 feed
   */
  private generateRSS(articles: FeedArticle[], options: FeedOptions): string {
    const feedUrl = this.buildFeedUrl('rss', options);
    const title = this.buildFeedTitle(options);
    const language = options.language ?? FEED_LANGUAGE;

    const items = articles.map(article => `
    <item>
      <title>${this.escapeXml(article.title)}</title>
      <link>${SITE_URL}/article/${article.id}</link>
      <description>${this.escapeXml(article.description)}</description>
      <content:encoded><![CDATA[${article.content}]]></content:encoded>
      <pubDate>${new Date(article.published_at).toUTCString()}</pubDate>
      <guid isPermaLink="true">${SITE_URL}/article/${article.id}</guid>
      <source url="${this.escapeXml(article.source_url ?? '')}">${this.escapeXml(article.source_name)}</source>
      ${article.author ? `<dc:creator>${this.escapeXml(article.author)}</dc:creator>` : ''}
      ${article.category ? `<category>${this.escapeXml(article.category)}</category>` : ''}
      ${article.image_url ? `<media:content url="${this.escapeXml(article.image_url)}" medium="image" />` : ''}
      ${article.image_url ? `<enclosure url="${this.escapeXml(article.image_url)}" type="image/jpeg" />` : ''}
      ${(article.keywords ?? []).map(k => `<category>${this.escapeXml(k)}</category>`).join('\n      ')}
    </item>`).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:media="http://search.yahoo.com/mrss/"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${this.escapeXml(title)}</title>
    <link>${SITE_URL}</link>
    <description>${this.escapeXml(FEED_DESCRIPTION)}</description>
    <language>${language}</language>
    <copyright>${this.escapeXml(FEED_COPYRIGHT)}</copyright>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>Mukoko News Platform</generator>
    <image>
      <url>${FEED_LOGO}</url>
      <title>${this.escapeXml(title)}</title>
      <link>${SITE_URL}</link>
    </image>
    <atom:link href="${this.escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
    <ttl>15</ttl>
${items}
  </channel>
</rss>`;
  }

  /**
   * Generate Atom 1.0 feed
   */
  private generateAtom(articles: FeedArticle[], options: FeedOptions): string {
    const feedUrl = this.buildFeedUrl('atom', options);
    const title = this.buildFeedTitle(options);
    const updated = articles[0]?.published_at ?? new Date().toISOString();

    const entries = articles.map(article => `
  <entry>
    <title>${this.escapeXml(article.title)}</title>
    <link href="${SITE_URL}/article/${article.id}" rel="alternate" type="text/html" />
    <id>urn:mukoko:article:${article.id}</id>
    <published>${new Date(article.published_at).toISOString()}</published>
    <updated>${new Date(article.updated_at ?? article.published_at).toISOString()}</updated>
    <summary type="text">${this.escapeXml(article.description)}</summary>
    <content type="html"><![CDATA[${article.content}]]></content>
    ${article.author ? `<author><name>${this.escapeXml(article.author)}</name></author>` : ''}
    ${article.category ? `<category term="${this.escapeXml(article.category)}" />` : ''}
    ${(article.keywords ?? []).map(k => `<category term="${this.escapeXml(k)}" />`).join('\n    ')}
    ${article.image_url ? `<link rel="enclosure" href="${this.escapeXml(article.image_url)}" type="image/jpeg" />` : ''}
    <source>
      <title>${this.escapeXml(article.source_name)}</title>
      ${article.source_url ? `<link href="${this.escapeXml(article.source_url)}" />` : ''}
    </source>
  </entry>`).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${this.escapeXml(title)}</title>
  <subtitle>${this.escapeXml(FEED_DESCRIPTION)}</subtitle>
  <link href="${SITE_URL}" rel="alternate" type="text/html" />
  <link href="${this.escapeXml(feedUrl)}" rel="self" type="application/atom+xml" />
  <id>urn:mukoko:feed:${options.country ?? 'all'}:${options.category ?? 'all'}</id>
  <updated>${new Date(updated).toISOString()}</updated>
  <generator uri="${SITE_URL}" version="1.0">Mukoko News Platform</generator>
  <icon>${FEED_ICON}</icon>
  <logo>${FEED_LOGO}</logo>
  <rights>${this.escapeXml(FEED_COPYRIGHT)}</rights>
${entries}
</feed>`;
  }

  /**
   * Generate JSON Feed 1.1
   */
  private generateJSONFeed(articles: FeedArticle[], options: FeedOptions): string {
    const feedUrl = this.buildFeedUrl('json', options);
    const title = this.buildFeedTitle(options);

    const feed = {
      version: 'https://jsonfeed.org/version/1.1',
      title,
      home_page_url: SITE_URL,
      feed_url: feedUrl,
      description: FEED_DESCRIPTION,
      icon: FEED_LOGO,
      favicon: FEED_ICON,
      language: options.language ?? FEED_LANGUAGE,
      authors: [
        {
          name: 'Mukoko News',
          url: SITE_URL,
        },
      ],
      items: articles.map(article => ({
        id: article.id,
        url: `${SITE_URL}/article/${article.id}`,
        external_url: article.url,
        title: article.title,
        summary: article.description,
        content_html: article.content,
        date_published: new Date(article.published_at).toISOString(),
        date_modified: article.updated_at
          ? new Date(article.updated_at).toISOString()
          : undefined,
        authors: article.author
          ? [{ name: article.author }]
          : undefined,
        tags: [
          ...(article.category ? [article.category] : []),
          ...(article.keywords ?? []),
        ],
        image: article.image_url || undefined,
        _mukoko: {
          source_name: article.source_name,
          country_code: article.country_code,
          category: article.category,
        },
      })),
    };

    return JSON.stringify(feed, null, 2);
  }

  // --- Data Access ---

  private async getArticles(options: FeedOptions): Promise<FeedArticle[]> {
    const conditions: string[] = ["a.status = 'published'"];
    const params: unknown[] = [];

    if (options.country) {
      conditions.push('a.country_id = ?');
      params.push(options.country);
    }

    if (options.category) {
      conditions.push(`a.id IN (
        SELECT article_id FROM article_sections
        WHERE category_id IN (SELECT id FROM categories WHERE slug = ?)
      )`);
      params.push(options.category);
    }

    if (options.source) {
      conditions.push('a.source_id = ?');
      params.push(options.source);
    }

    const limit = Math.min(options.limit ?? 50, 100);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await this.db.prepare(`
      SELECT a.id, a.title, a.description, a.content, a.url, a.image_url,
             a.author, a.published_at, a.updated_at, a.country_id as country_code,
             rs.name as source_name, rs.url as source_url
      FROM articles a
      LEFT JOIN rss_sources rs ON a.source_id = rs.id
      ${whereClause}
      ORDER BY a.published_at DESC
      LIMIT ?
    `).bind(...params, limit).all();

    return (result.results ?? []) as unknown as FeedArticle[];
  }

  // --- Helpers ---

  private buildFeedUrl(format: string, options: FeedOptions): string {
    const params = new URLSearchParams();
    if (options.country) params.set('country', options.country);
    if (options.category) params.set('category', options.category);
    if (options.source) params.set('source', options.source);
    if (options.limit) params.set('limit', String(options.limit));

    const query = params.toString();
    return `${SITE_URL}/feeds/${format}${query ? '?' + query : ''}`;
  }

  private buildFeedTitle(options: FeedOptions): string {
    const parts = [FEED_TITLE];
    if (options.country) parts.push(`(${options.country.toUpperCase()})`);
    if (options.category) parts.push(`- ${options.category}`);
    if (options.source) parts.push(`from ${options.source}`);
    return parts.join(' ');
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private async generateETag(articles: FeedArticle[], options: FeedOptions): Promise<string> {
    const content = JSON.stringify({
      ids: articles.map(a => a.id),
      options,
      timestamp: articles[0]?.published_at,
    });

    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(content));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return '"' + hashArray.slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('') + '"';
  }
}

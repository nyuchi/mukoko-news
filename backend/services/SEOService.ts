/**
 * SEO Service for Mukoko News
 * Generates SEO metadata, Open Graph tags, JSON-LD structured data,
 * and handles automatic SEO optimization for articles
 */

export interface ArticleSEO {
  // Core SEO
  title: string;
  metaDescription: string;
  canonicalUrl: string;
  keywords: string[];

  // Open Graph
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  ogUrl: string;
  ogType: 'article' | 'website';
  ogSiteName: string;

  // Article-specific OG
  articlePublishedTime?: string;
  articleModifiedTime?: string;
  articleAuthor?: string;
  articleSection?: string;
  articleTags?: string[];

  // Twitter Card
  twitterCard: 'summary' | 'summary_large_image';
  twitterTitle: string;
  twitterDescription: string;
  twitterImage: string;
  twitterSite?: string;
  twitterCreator?: string;

  // JSON-LD Structured Data
  jsonLd: NewsArticleSchema | WebsiteSchema;
}

export interface NewsArticleSchema {
  '@context': 'https://schema.org';
  '@type': 'NewsArticle';
  headline: string;
  description: string;
  image: string[];
  datePublished: string;
  dateModified: string;
  author: PersonSchema | OrganizationSchema;
  publisher: OrganizationSchema;
  mainEntityOfPage: {
    '@type': 'WebPage';
    '@id': string;
  };
  articleSection?: string;
  keywords?: string;
  wordCount?: number;
  isAccessibleForFree?: boolean;
}

export interface WebsiteSchema {
  '@context': 'https://schema.org';
  '@type': 'WebSite';
  name: string;
  url: string;
  description: string;
  publisher: OrganizationSchema;
  potentialAction?: SearchActionSchema;
}

export interface PersonSchema {
  '@type': 'Person';
  name: string;
  url?: string;
}

export interface OrganizationSchema {
  '@type': 'Organization';
  name: string;
  url: string;
  logo?: {
    '@type': 'ImageObject';
    url: string;
    width?: number;
    height?: number;
  };
}

export interface SearchActionSchema {
  '@type': 'SearchAction';
  target: {
    '@type': 'EntryPoint';
    urlTemplate: string;
  };
  'query-input': string;
}

export interface SitemapEntry {
  loc: string;
  lastmod: string;
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority: number;
  // News sitemap extensions
  news?: {
    publication: {
      name: string;
      language: string;
    };
    title: string;
    publication_date: string;
    keywords?: string;
  };
  // Image sitemap extensions
  images?: Array<{
    loc: string;
    title?: string;
    caption?: string;
  }>;
}

export class SEOService {
  private baseUrl: string;
  private siteName: string;
  private twitterHandle: string;
  private defaultImage: string;
  private db: D1Database;

  constructor(db: D1Database, options?: {
    baseUrl?: string;
    siteName?: string;
    twitterHandle?: string;
    defaultImage?: string;
  }) {
    this.db = db;
    this.baseUrl = options?.baseUrl || 'https://news.mukoko.com';
    this.siteName = options?.siteName || 'Mukoko News';
    this.twitterHandle = options?.twitterHandle || '@mukoko_news';
    this.defaultImage = options?.defaultImage || `${this.baseUrl}/images/og-default.png`;
  }

  /**
   * Generate complete SEO metadata for an article
   */
  async generateArticleSEO(article: {
    id: number;
    slug: string;
    headline: string;
    description?: string;
    article_body?: string;
    author_name?: string;
    article_section_id?: string;
    tags?: string;
    image?: string;
    date_published: string;
    date_modified?: string;
    word_count?: number;
    source?: string;
  }): Promise<ArticleSEO> {
    const canonicalUrl = `${this.baseUrl}/article/${article.slug}`;
    const imageUrl = article.image || this.defaultImage;

    // Generate optimized meta description (155 chars max)
    const metaDescription = this.generateMetaDescription(
      article.description || article.article_body || article.headline,
      155
    );

    // Generate OG description (slightly longer, 200 chars)
    const ogDescription = this.generateMetaDescription(
      article.description || article.article_body || article.headline,
      200
    );

    // Parse tags
    const keywords = article.tags
      ? article.tags.split(',').map(t => t.trim()).filter(Boolean)
      : [];

    // Generate JSON-LD structured data
    const jsonLd = this.generateNewsArticleSchema(article, canonicalUrl, imageUrl);

    return {
      // Core SEO
      title: this.generateSEOTitle(article.headline),
      metaDescription,
      canonicalUrl,
      keywords,

      // Open Graph
      ogTitle: article.headline,
      ogDescription,
      ogImage: imageUrl,
      ogUrl: canonicalUrl,
      ogType: 'article',
      ogSiteName: this.siteName,

      // Article-specific OG
      articlePublishedTime: article.date_published,
      articleModifiedTime: article.date_modified,
      articleAuthor: article.author_name,
      articleSection: article.article_section_id,
      articleTags: keywords,

      // Twitter Card
      twitterCard: 'summary_large_image',
      twitterTitle: article.headline,
      twitterDescription: metaDescription,
      twitterImage: imageUrl,
      twitterSite: this.twitterHandle,
      twitterCreator: undefined, // Could be author's twitter handle

      // JSON-LD
      jsonLd
    };
  }

  /**
   * Generate SEO metadata for the homepage
   */
  generateHomepageSEO(): ArticleSEO {
    const canonicalUrl = this.baseUrl;
    const description = 'Zimbabwe\'s modern news platform. Get the latest news from The Herald, NewsDay, ZimLive, and more - all in one place.';

    const jsonLd: WebsiteSchema = {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: this.siteName,
      url: this.baseUrl,
      description,
      publisher: this.getPublisherSchema(),
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${this.baseUrl}/search?q={search_term_string}`
        },
        'query-input': 'required name=search_term_string'
      }
    };

    return {
      title: `${this.siteName} - Zimbabwe's Modern News Platform`,
      metaDescription: description,
      canonicalUrl,
      keywords: ['Zimbabwe news', 'Harare news', 'African news', 'breaking news', 'Mukoko News'],

      ogTitle: this.siteName,
      ogDescription: description,
      ogImage: this.defaultImage,
      ogUrl: canonicalUrl,
      ogType: 'website',
      ogSiteName: this.siteName,

      twitterCard: 'summary_large_image',
      twitterTitle: this.siteName,
      twitterDescription: description,
      twitterImage: this.defaultImage,
      twitterSite: this.twitterHandle,

      jsonLd
    };
  }

  /**
   * Generate SEO metadata for a category page
   */
  generateCategorySEO(category: string, articleCount: number): ArticleSEO {
    const categoryTitle = this.capitalizeFirst(category);
    const canonicalUrl = `${this.baseUrl}/category/${category}`;
    const description = `Latest ${categoryTitle} news from Zimbabwe. Read ${articleCount}+ articles about ${categoryTitle.toLowerCase()} on Mukoko News.`;

    return {
      title: `${categoryTitle} News - ${this.siteName}`,
      metaDescription: description,
      canonicalUrl,
      keywords: [`${category} news`, 'Zimbabwe news', categoryTitle, this.siteName],

      ogTitle: `${categoryTitle} News`,
      ogDescription: description,
      ogImage: this.defaultImage,
      ogUrl: canonicalUrl,
      ogType: 'website',
      ogSiteName: this.siteName,

      twitterCard: 'summary_large_image',
      twitterTitle: `${categoryTitle} News - ${this.siteName}`,
      twitterDescription: description,
      twitterImage: this.defaultImage,
      twitterSite: this.twitterHandle,

      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: `${categoryTitle} - ${this.siteName}`,
        url: canonicalUrl,
        description,
        publisher: this.getPublisherSchema()
      }
    };
  }

  /**
   * Generate HTML meta tags from SEO metadata
   */
  generateMetaTags(seo: ArticleSEO): string {
    const tags: string[] = [];

    // Core SEO
    tags.push(`<title>${this.escapeHtml(seo.title)}</title>`);
    tags.push(`<meta name="description" content="${this.escapeHtml(seo.metaDescription)}">`);
    tags.push(`<link rel="canonical" href="${seo.canonicalUrl}">`);

    if (seo.keywords.length > 0) {
      tags.push(`<meta name="keywords" content="${this.escapeHtml(seo.keywords.join(', '))}">`);
    }

    // Open Graph
    tags.push(`<meta property="og:title" content="${this.escapeHtml(seo.ogTitle)}">`);
    tags.push(`<meta property="og:description" content="${this.escapeHtml(seo.ogDescription)}">`);
    tags.push(`<meta property="og:image" content="${seo.ogImage}">`);
    tags.push(`<meta property="og:url" content="${seo.ogUrl}">`);
    tags.push(`<meta property="og:type" content="${seo.ogType}">`);
    tags.push(`<meta property="og:site_name" content="${this.escapeHtml(seo.ogSiteName)}">`);

    // Article-specific OG
    if (seo.ogType === 'article') {
      if (seo.articlePublishedTime) {
        tags.push(`<meta property="article:published_time" content="${seo.articlePublishedTime}">`);
      }
      if (seo.articleModifiedTime) {
        tags.push(`<meta property="article:modified_time" content="${seo.articleModifiedTime}">`);
      }
      if (seo.articleAuthor) {
        tags.push(`<meta property="article:author" content="${this.escapeHtml(seo.articleAuthor)}">`);
      }
      if (seo.articleSection) {
        tags.push(`<meta property="article:section" content="${this.escapeHtml(seo.articleSection)}">`);
      }
      if (seo.articleTags && seo.articleTags.length > 0) {
        seo.articleTags.forEach(tag => {
          tags.push(`<meta property="article:tag" content="${this.escapeHtml(tag)}">`);
        });
      }
    }

    // Twitter Card
    tags.push(`<meta name="twitter:card" content="${seo.twitterCard}">`);
    tags.push(`<meta name="twitter:title" content="${this.escapeHtml(seo.twitterTitle)}">`);
    tags.push(`<meta name="twitter:description" content="${this.escapeHtml(seo.twitterDescription)}">`);
    tags.push(`<meta name="twitter:image" content="${seo.twitterImage}">`);

    if (seo.twitterSite) {
      tags.push(`<meta name="twitter:site" content="${seo.twitterSite}">`);
    }
    if (seo.twitterCreator) {
      tags.push(`<meta name="twitter:creator" content="${seo.twitterCreator}">`);
    }

    // JSON-LD
    tags.push(`<script type="application/ld+json">${JSON.stringify(seo.jsonLd)}</script>`);

    return tags.join('\n');
  }

  /**
   * Generate dynamic sitemap for articles
   */
  async generateArticleSitemap(options?: {
    limit?: number;
    category?: string;
    daysBack?: number;
  }): Promise<string> {
    const limit = options?.limit || 1000;
    const daysBack = options?.daysBack || 30;

    let query = `
      SELECT
        slug,
        headline,
        article_section_id,
        keywords,
        image,
        date_published,
        date_modified
      FROM articles
      WHERE status = 'published'
        AND date_published >= datetime('now', '-${daysBack} days')
    `;

    if (options?.category) {
      query += ` AND article_section_id = ?`;
    }

    query += ` ORDER BY date_published DESC LIMIT ${limit}`;

    const params = options?.category ? [options.category] : [];
    const result = await this.db.prepare(query).bind(...params).all();
    const articles = result.results || [];

    const entries: SitemapEntry[] = articles.map((article: any) => ({
      loc: `${this.baseUrl}/article/${article.slug}`,
      lastmod: article.date_modified || article.date_published,
      changefreq: 'daily' as const,
      priority: 0.8,
      news: {
        publication: {
          name: this.siteName,
          language: 'en'
        },
        title: article.headline,
        publication_date: article.date_published,
        keywords: article.keywords
      },
      images: article.image ? [{
        loc: article.image,
        title: article.headline
      }] : undefined
    }));

    return this.buildSitemapXml(entries);
  }

  /**
   * Generate sitemap index pointing to category sitemaps
   */
  async generateSitemapIndex(): Promise<string> {
    const categories = await this.db.prepare(`
      SELECT DISTINCT article_section_id FROM articles WHERE status = 'published'
    `).all();

    const sitemaps: string[] = [];
    const now = new Date().toISOString();

    // Main articles sitemap
    sitemaps.push(`
    <sitemap>
      <loc>${this.baseUrl}/sitemap-articles.xml</loc>
      <lastmod>${now}</lastmod>
    </sitemap>`);

    // Category sitemaps
    for (const cat of (categories.results || [])) {
      sitemaps.push(`
    <sitemap>
      <loc>${this.baseUrl}/sitemap-${(cat as any).article_section_id}.xml</loc>
      <lastmod>${now}</lastmod>
    </sitemap>`);
    }

    // News sitemap (for Google News)
    sitemaps.push(`
    <sitemap>
      <loc>${this.baseUrl}/sitemap-news.xml</loc>
      <lastmod>${now}</lastmod>
    </sitemap>`);

    return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps.join('')}
</sitemapindex>`;
  }

  /**
   * Generate Google News specific sitemap (last 2 days only)
   */
  async generateNewsSitemap(): Promise<string> {
    const result = await this.db.prepare(`
      SELECT
        slug,
        headline,
        article_section_id,
        keywords,
        date_published
      FROM articles
      WHERE status = 'published'
        AND date_published >= datetime('now', '-2 days')
      ORDER BY date_published DESC
      LIMIT 1000
    `).all();

    const articles = result.results || [];

    const entries: SitemapEntry[] = articles.map((article: any) => ({
      loc: `${this.baseUrl}/article/${article.slug}`,
      lastmod: article.date_published,
      changefreq: 'hourly' as const,
      priority: 1.0,
      news: {
        publication: {
          name: this.siteName,
          language: 'en'
        },
        title: article.headline,
        publication_date: article.date_published,
        keywords: article.keywords
      }
    }));

    return this.buildNewsSitemapXml(entries);
  }

  /**
   * Auto-generate and update SEO metadata for articles missing it
   */
  async autoUpdateArticleSEO(batchSize: number = 100): Promise<{
    updated: number;
    errors: number;
    total: number;
  }> {
    // Find articles with missing or outdated SEO data
    const result = await this.db.prepare(`
      SELECT id, slug, headline, description, article_body, author_name, article_section_id, tags,
             image, date_published, date_modified, word_count
      FROM articles
      WHERE status = 'published'
        AND (
          meta_description IS NULL
          OR meta_description = ''
          OR seo_updated_at IS NULL
          OR seo_updated_at < datetime('now', '-7 days')
        )
      ORDER BY date_published DESC
      LIMIT ?
    `).bind(batchSize).all();

    const articles = result.results || [];
    let updated = 0;
    let errors = 0;

    for (const article of articles) {
      try {
        const seo = await this.generateArticleSEO(article as any);

        await this.db.prepare(`
          UPDATE articles
          SET
            meta_description = ?,
            seo_title = ?,
            canonical_url = ?,
            seo_keywords = ?,
            og_image = ?,
            seo_updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(
          seo.metaDescription,
          seo.title,
          seo.canonicalUrl,
          seo.keywords.join(','),
          seo.ogImage,
          (article as any).id
        ).run();

        updated++;
      } catch (error) {
        console.error(`[SEO] Error updating article ${(article as any).id}:`, error);
        errors++;
      }
    }

    return { updated, errors, total: articles.length };
  }

  // === Private Helper Methods ===

  private generateSEOTitle(title: string): string {
    const maxLength = 60;
    const suffix = ` | ${this.siteName}`;

    if (title.length + suffix.length <= maxLength) {
      return title + suffix;
    }

    // Truncate title to fit
    const availableLength = maxLength - suffix.length - 3; // 3 for "..."
    return title.substring(0, availableLength) + '...' + suffix;
  }

  private generateMetaDescription(text: string, maxLength: number): string {
    if (!text) return '';

    // Strip HTML tags iteratively to handle nested/malformed tags
    let cleaned = text;
    let previous: string;
    do {
      previous = cleaned;
      cleaned = cleaned.replace(/<[^>]*>/g, '');
    } while (cleaned !== previous);
    cleaned = cleaned.trim();

    // Strip extra whitespace
    const normalized = cleaned.replace(/\s+/g, ' ');

    if (normalized.length <= maxLength) {
      return normalized;
    }

    // Truncate at word boundary
    const truncated = normalized.substring(0, maxLength - 3);
    const lastSpace = truncated.lastIndexOf(' ');

    if (lastSpace > maxLength - 30) {
      return truncated.substring(0, lastSpace) + '...';
    }

    return truncated + '...';
  }

  private generateNewsArticleSchema(
    article: any,
    canonicalUrl: string,
    imageUrl: string
  ): NewsArticleSchema {
    return {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: article.headline,
      description: article.description || this.generateMetaDescription(article.article_body, 200),
      image: [imageUrl],
      datePublished: article.date_published,
      dateModified: article.date_modified || article.date_published,
      author: article.author_name ? {
        '@type': 'Person',
        name: article.author_name
      } : this.getPublisherSchema(),
      publisher: this.getPublisherSchema(),
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id': canonicalUrl
      },
      articleSection: article.article_section_id,
      keywords: article.keywords,
      wordCount: article.word_count,
      isAccessibleForFree: true
    };
  }

  private getPublisherSchema(): OrganizationSchema {
    return {
      '@type': 'Organization',
      name: this.siteName,
      url: this.baseUrl,
      logo: {
        '@type': 'ImageObject',
        url: `${this.baseUrl}/images/logo.png`,
        width: 512,
        height: 512
      }
    };
  }

  private buildSitemapXml(entries: SitemapEntry[]): string {
    const urlElements = entries.map(entry => {
      let url = `
    <url>
      <loc>${this.escapeXml(entry.loc)}</loc>
      <lastmod>${entry.lastmod}</lastmod>
      <changefreq>${entry.changefreq}</changefreq>
      <priority>${entry.priority}</priority>`;

      if (entry.images && entry.images.length > 0) {
        for (const img of entry.images) {
          url += `
      <image:image>
        <image:loc>${this.escapeXml(img.loc)}</image:loc>
        ${img.title ? `<image:title>${this.escapeXml(img.title)}</image:title>` : ''}
      </image:image>`;
        }
      }

      url += `
    </url>`;
      return url;
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urlElements.join('')}
</urlset>`;
  }

  private buildNewsSitemapXml(entries: SitemapEntry[]): string {
    const urlElements = entries.map(entry => `
    <url>
      <loc>${this.escapeXml(entry.loc)}</loc>
      <news:news>
        <news:publication>
          <news:name>${this.escapeXml(entry.news!.publication.name)}</news:name>
          <news:language>${entry.news!.publication.language}</news:language>
        </news:publication>
        <news:publication_date>${entry.news!.publication_date}</news:publication_date>
        <news:title>${this.escapeXml(entry.news!.title)}</news:title>
        ${entry.news!.keywords ? `<news:keywords>${this.escapeXml(entry.news!.keywords)}</news:keywords>` : ''}
      </news:news>
    </url>`);

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urlElements.join('')}
</urlset>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private capitalizeFirst(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }
}

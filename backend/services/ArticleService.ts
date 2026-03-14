// worker/services/ArticleService.ts
// Service for managing articles in D1 database with slugs and content scraping

interface ScraperConfig {
  contentSelectors: string[];
  excludeSelectors: string[];
  maxContentLength: number;
  timeout: number;
}

interface ArticleFilters {
  article_section_id?: string;
  publisher_name?: string;
  countries?: string[];  // Pan-African support: filter by country IDs
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: string;
  status?: string;
  search?: string;
}

interface ViewData {
  userId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  referrer?: string;
  readingTime?: number;
  scrollDepth?: number;
}

export class ArticleService {
  private db: D1Database;
  private scraperConfig: ScraperConfig;

  constructor(articlesDb: D1Database) {
    this.db = articlesDb;

    // Web scraping configuration
    this.scraperConfig = {
      // Common content selectors for news websites
      contentSelectors: [
        '.entry-content',
        '.post-content', 
        '.article-content',
        '.story-body',
        '.content',
        '.post-body',
        '.article-body',
        'article p',
        '.single-post-content',
        '.td-post-content',
        '[data-testid="article-content"]'
      ],
      // Selectors to remove from content (ads, navigation, etc.)
      excludeSelectors: [
        '.advertisement',
        '.ad-container',
        '.social-share',
        '.related-posts',
        '.comments',
        '.newsletter-signup',
        '.author-bio',
        '.tags',
        '.breadcrumbs',
        'nav',
        'footer',
        '.sidebar'
      ],
      // Maximum content length (characters)
      maxContentLength: 50000,
      // Request timeout in milliseconds
      timeout: 10000
    }
  }

  // Generate URL-friendly slug from title
  generateSlug(title: string | null): string | null {
    if (!title) return null;

    return title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-')     // Replace spaces with hyphens
      .replace(/-+/g, '-')      // Replace multiple hyphens with single
      .trim()                   // Remove leading/trailing spaces
      .substring(0, 80)         // Limit length
      .replace(/-$/, '');       // Remove trailing hyphen
  }

  // Ensure slug is unique by appending number if needed
  async ensureUniqueSlug(baseSlug: string | null, excludeId: number | null = null): Promise<string | null> {
    if (!baseSlug) return null

    let slug = baseSlug
    let counter = 1

    while (true) {
      // Check if slug exists
      const query = excludeId 
        ? 'SELECT id FROM articles WHERE slug = ? AND id != ?'
        : 'SELECT id FROM articles WHERE slug = ?'
      
      const params = excludeId ? [slug, excludeId] : [slug]
      const existing = await this.db.prepare(query).bind(...params).first()

      if (!existing) {
        return slug // Slug is unique
      }

      // Try next variation
      slug = `${baseSlug}-${counter}`
      counter++

      // Prevent infinite loop
      if (counter > 100) {
        slug = `${baseSlug}-${Date.now()}`
        break
      }
    }

    return slug
  }

  // Calculate reading time (average 200 words per minute)
  calculateReadingTime(content) {
    if (!content) return 0
    const wordCount = content.split(/\s+/).length
    return Math.ceil(wordCount / 200)
  }

  // Insert or update article with slug
  async upsertArticle(articleData) {
    try {
      if (!articleData || !articleData.headline) {
        throw new Error('Article headline is required')
      }

      // Generate slug from headline
      const baseSlug = this.generateSlug(articleData.headline)
      if (!baseSlug) {
        throw new Error('Unable to generate slug from headline')
      }

      // Ensure slug is unique
      const slug = await this.ensureUniqueSlug(baseSlug)

      // Calculate word count and reading time
      const articleBody = articleData.article_body || ''
      const wordCount = articleBody ? articleBody.split(/\s+/).filter(word => word.length > 0).length : 0
      const readingTime = this.calculateReadingTime(articleBody)

      // Prepare search content for full-text search
      const searchContent = [
        articleData.headline,
        articleData.description,
        articleBody,
        articleData.tags
      ].filter(Boolean).join(' ')

      // Check if article exists by RSS GUID or URL
      let existingArticle = null
      if (articleData.rss_guid) {
        existingArticle = await this.db.prepare(
          'SELECT id, slug FROM articles WHERE rss_guid = ?'
        ).bind(articleData.rss_guid).first()
      }

      if (!existingArticle && articleData.main_entity_of_page) {
        existingArticle = await this.db.prepare(
          'SELECT id, slug FROM articles WHERE main_entity_of_page = ?'
        ).bind(articleData.main_entity_of_page).first()
      }

      const now = new Date().toISOString()

      if (existingArticle) {
        // Update existing article
        const result = await this.db.prepare(`
          UPDATE articles SET
            headline = ?, description = ?, article_body = ?, author_name = ?,
            publisher_name = ?, main_entity_of_page = ?, article_section_id = ?, about_country_id = ?, tags = ?,
            date_published = ?, date_modified = ?, word_count = ?, reading_time_minutes = ?,
            image = ?, status = ?, priority = ?,
            content_search = ?
          WHERE id = ?
        `).bind(
          articleData.headline,
          articleData.description || '',
          articleBody,
          articleData.author_name || '',
          articleData.publisher_name || '',
          articleData.main_entity_of_page || '',
          articleData.article_section_id || 'general',
          articleData.about_country_id || 'ZW',  // Pan-African support: default to Zimbabwe
          articleData.tags || '',
          articleData.date_published || now,
          now,
          wordCount,
          readingTime,
          articleData.image || '',
          articleData.status || 'published',
          articleData.priority || 0,
          searchContent,
          existingArticle.id
        ).run()

        return {
          id: existingArticle.id,
          slug: existingArticle.slug,
          updated: true,
          ...result
        }
      } else {
        // Insert new article
        const result = await this.db.prepare(`
          INSERT INTO articles (
            slug, headline, description, article_body, author_name, publisher_name, main_entity_of_page,
            article_section_id, about_country_id, tags, date_published, date_created, date_modified, word_count,
            reading_time_minutes, image, status, priority,
            rss_guid, content_search
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          slug,
          articleData.headline,
          articleData.description || '',
          articleBody,
          articleData.author_name || '',
          articleData.publisher_name || '',
          articleData.main_entity_of_page || '',
          articleData.article_section_id || 'general',
          articleData.about_country_id || 'ZW',  // Pan-African support: default to Zimbabwe
          articleData.tags || '',
          articleData.date_published || now,
          now,
          now,
          wordCount,
          readingTime,
          articleData.image || '',
          articleData.status || 'published',
          articleData.priority || 0,
          articleData.rss_guid || '',
          searchContent
        ).run()

        return {
          id: result.meta.last_row_id,
          slug,
          updated: false,
          ...result
        }
      }
    } catch (error) {
      console.error('[ARTICLES] Error upserting article:', error)
      throw error
    }
  }

  // Get article by slug
  async getArticleBySlug(slug) {
    try {
      if (!slug) return null

      const article = await this.db.prepare(`
        SELECT * FROM articles WHERE slug = ? AND status = 'published'
      `).bind(slug).first()

      if (article) {
        // Update view count
        await this.db.prepare(`
          UPDATE articles SET 
            view_count = view_count + 1,
            last_viewed_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(article.id).run()
      }

      return article
    } catch (error) {
      console.error('[ARTICLES] Error getting article by slug:', error)
      throw error
    }
  }

  // Get articles with pagination
  async getArticles(options: {
    article_section_id?: string | null;
    publisher_name?: string | null;
    countries?: string[] | null;  // Pan-African support: filter by country IDs
    limit?: number;
    offset?: number;
    orderBy?: string;
    orderDirection?: string;
    status?: string;
    search?: string | null;
  } = {}) {
    try {
      const {
        article_section_id = null,
        publisher_name = null,
        countries = null,
        limit = 25,
        offset = 0,
        orderBy = 'date_published',
        orderDirection = 'DESC',
        status = 'published',
        search = null
      } = options

      let query = 'SELECT * FROM articles WHERE status = ?'
      const params: (string | number)[] = [status]

      if (article_section_id) {
        query += ' AND article_section_id = ?'
        params.push(article_section_id)
      }

      if (publisher_name) {
        query += ' AND publisher_name = ?'
        params.push(publisher_name)
      }

      // Pan-African support: filter by countries
      if (countries && countries.length > 0) {
        const placeholders = countries.map(() => '?').join(',')
        query += ` AND about_country_id IN (${placeholders})`
        params.push(...countries)
      }

      if (search) {
        query += ' AND content_search LIKE ?'
        params.push(`%${search}%`)
      }

      query += ` ORDER BY ${orderBy} ${orderDirection} LIMIT ? OFFSET ?`
      params.push(limit, offset)

      const articles = await this.db.prepare(query).bind(...params).all()

      return {
        articles: articles.results || [],
        count: articles.results?.length || 0,
        hasMore: (articles.results?.length || 0) === limit
      }
    } catch (error) {
      console.error('[ARTICLES] Error getting articles:', error)
      throw error
    }
  }

  // Bulk insert articles (for RSS import)
  async bulkInsertArticles(articlesData) {
    try {
      if (!articlesData || !Array.isArray(articlesData)) {
        return { success: false, message: 'Invalid articles data' }
      }

      const results = []
      const errors = []

      // Process in batches to avoid overwhelming D1
      const batchSize = 25
      for (let i = 0; i < articlesData.length; i += batchSize) {
        const batch = articlesData.slice(i, i + batchSize)
        
        for (const articleData of batch) {
          try {
            const result = await this.upsertArticle(articleData)
            results.push(result)
          } catch (error) {
            errors.push({
              article: articleData.headline || 'Unknown',
              error: error.message
            })
            console.error('[ARTICLES] Error in bulk insert:', error)
          }
        }

        // Small delay between batches
        if (i + batchSize < articlesData.length) {
          await new Promise(resolve => setTimeout(resolve, 10))
        }
      }

      return {
        success: true,
        inserted: results.filter(r => !r.updated).length,
        updated: results.filter(r => r.updated).length,
        total: results.length,
        errors: errors.length,
        errorDetails: errors.slice(0, 5) // Limit error details
      }
    } catch (error) {
      console.error('[ARTICLES] Error in bulk insert:', error)
      return {
        success: false,
        message: error.message,
        errors: 1
      }
    }
  }

  // Track article analytics
  async trackArticleView(articleId: string | number, context: {
    userId?: string | null;
    sessionId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    referrer?: string | null;
    readingTime?: number | null;
    scrollDepth?: number | null;
  } = {}) {
    try {
      if (!articleId) return

      await this.db.prepare(`
        INSERT INTO article_analytics (
          article_id, event_type, user_id, session_id, ip_address,
          user_agent, referrer, reading_time, scroll_depth
        ) VALUES (?, 'view', ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        articleId,
        context.userId || null,
        context.sessionId || null,
        context.ipAddress || null,
        context.userAgent || null,
        context.referrer || null,
        context.readingTime || null,
        context.scrollDepth || null
      ).run()
    } catch (error) {
      console.error('[ARTICLES] Error tracking article view:', error)
      // Don't throw - analytics shouldn't break the main flow
    }
  }

  // Get article statistics
  async getArticleStats() {
    try {
      const stats = await this.db.prepare(`
        SELECT 
          COUNT(*) as total_articles,
          COUNT(CASE WHEN status = 'published' THEN 1 END) as published_articles,
          AVG(word_count) as avg_word_count,
          AVG(reading_time_minutes) as avg_reading_time,
          SUM(view_count) as total_views
        FROM articles
      `).first()

      return stats || {}
    } catch (error) {
      console.error('[ARTICLES] Error getting article stats:', error)
      return {}
    }
  }

  // Web Scraping Methods for Content Enhancement

  // Scrape full article content from URL
  async scrapeArticleContent(url) {
    if (!url) {
      throw new Error('Article URL is required')
    }

    try {
      console.log(`ArticleService: Scraping content from ${url}`)
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Harare Metro Bot; +https://hararemetro.co.zw)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        signal: AbortSignal.timeout(this.scraperConfig.timeout)
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const html = await response.text()
      const extractedData = this.extractContentFromHTML(html, url)
      
      console.log(`ArticleService: Extracted ${extractedData.content.length} characters from ${url}`)
      if (extractedData.image) {
        console.log(`ArticleService: Found image ${extractedData.image} from ${url}`)
      }
      return extractedData
      
    } catch (error) {
      console.error(`ArticleService: Failed to scrape content from ${url}:`, error.message)
      throw new Error(`Failed to scrape article content: ${error.message}`)
    }
  }

  // Extract main content from HTML
  extractContentFromHTML(html, url) {
    try {
      let extractedContent = ''
      let title = ''
      let description = ''
      let extractedImage = null
      
      // Extract title
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
      if (titleMatch) {
        title = this.cleanText(titleMatch[1])
      }

      // Extract meta description
      const descriptionMatch = html.match(/<meta[^>]*name=["\']description["\'][^>]*content=["\']([^"']+)["\'][^>]*/i)
      if (descriptionMatch) {
        description = this.cleanText(descriptionMatch[1])
      }

      // Extract images
      extractedImage = this.extractMainImage(html, url)

      // Try to extract content using various selectors
      for (const selector of this.scraperConfig.contentSelectors) {
        const content = this.extractContentBySelector(html, selector)
        if (content && content.length > extractedContent.length) {
          extractedContent = content
        }
      }

      // If no content found with selectors, try to extract paragraphs
      if (!extractedContent) {
        extractedContent = this.extractParagraphs(html)
      }

      // Clean and format content
      const cleanContent = this.cleanAndFormatContent(extractedContent)
      
      // Limit content length
      const finalContent = cleanContent.length > this.scraperConfig.maxContentLength
        ? cleanContent.substring(0, this.scraperConfig.maxContentLength) + '...'
        : cleanContent

      return {
        content: finalContent || description || 'Content could not be extracted from this article.',
        image: extractedImage,
        title: title,
        description: description
      }
      
    } catch (error) {
      console.error('ArticleService: HTML parsing error:', error.message)
      return {
        content: 'Error occurred while extracting article content.',
        image: null,
        title: null,
        description: null
      }
    }
  }

  // Extract content by CSS selector (basic implementation for Cloudflare Workers)
  extractContentBySelector(html, selector) {
    try {
      // Convert CSS selector to regex pattern (basic implementation)
      let pattern = ''
      
      if (selector.startsWith('.')) {
        // Class selector
        const className = selector.substring(1)
        pattern = `<[^>]*class=[^>]*\\b${className}\\b[^>]*>([\\s\\S]*?)<\/[^>]*>`
      } else if (selector.startsWith('#')) {
        // ID selector
        const id = selector.substring(1)
        pattern = `<[^>]*id=[^>]*\\b${id}\\b[^>]*>([\\s\\S]*?)<\/[^>]*>`
      } else if (selector === 'article p') {
        // Article paragraphs
        const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
        if (articleMatch) {
          return this.extractParagraphs(articleMatch[1])
        }
        return ''
      } else {
        // Element selector
        pattern = `<${selector}[^>]*>([\\s\\S]*?)<\/${selector}>`
      }

      if (pattern) {
        const regex = new RegExp(pattern, 'i')
        const match = html.match(regex)
        if (match && match[1]) {
          return this.stripHTML(match[1])
        }
      }
      
      return ''
    } catch (error) {
      return ''
    }
  }

  // Extract all paragraphs from HTML
  extractParagraphs(html) {
    const paragraphRegex = /<p[^>]*>([^<]+(?:<[^\/p][^>]*>[^<]*<\/[^>]+>[^<]*)*)<\/p>/gi
    const paragraphs = []
    let match

    while ((match = paragraphRegex.exec(html)) !== null) {
      const paragraphText = this.stripHTML(match[1])
      if (paragraphText.trim().length > 20) { // Only include substantial paragraphs
        paragraphs.push(paragraphText.trim())
      }
    }

    return paragraphs.join('\n\n')
  }

  // Strip HTML tags from text
  // Uses loop-based removal to handle nested/malformed tags safely
  stripHTML(html) {
    let result = html;
    let previousLength;

    // Loop to remove script tags until none remain (handles nested scripts)
    // Pattern matches any whitespace (spaces, tabs, newlines) in closing tag
    do {
      previousLength = result.length;
      result = result.replace(/<script\b[^>]*>[\s\S]*?<\/script[\s\S]*?>/gi, '');
    } while (result.length !== previousLength);

    // Loop to remove style tags until none remain (handles nested styles)
    do {
      previousLength = result.length;
      result = result.replace(/<style\b[^>]*>[\s\S]*?<\/style[\s\S]*?>/gi, '');
    } while (result.length !== previousLength);

    // Remove all remaining HTML tags with multiple passes for nested content
    do {
      previousLength = result.length;
      result = result.replace(/<[^>]+>/g, ' ');
    } while (result.length !== previousLength);

    // Normalize whitespace and trim
    return result.replace(/\s+/g, ' ').trim();
  }

  // Extract main image from HTML
  extractMainImage(html, baseUrl) {
    try {
      const candidates = []
      
      // 1. Open Graph image
      const ogImageMatch = html.match(/<meta[^>]*property=["\']og:image["\'][^>]*content=["\']([^"']+)["\'][^>]*/i)
      if (ogImageMatch) {
        candidates.push({ url: ogImageMatch[1], priority: 10, source: 'og:image' })
      }

      // 2. Twitter Card image
      const twitterImageMatch = html.match(/<meta[^>]*name=["\']twitter:image["\'][^>]*content=["\']([^"']+)["\'][^>]*/i)
      if (twitterImageMatch) {
        candidates.push({ url: twitterImageMatch[1], priority: 9, source: 'twitter:image' })
      }

      // 3. Article featured image selectors
      const featuredImageSelectors = [
        '.featured-image img',
        '.post-thumbnail img',
        '.article-image img',
        '.hero-image img',
        '.entry-image img',
        'article img:first-of-type',
        '.content img:first-of-type'
      ]

      for (const selector of featuredImageSelectors) {
        const imgMatch = this.extractImageBySelector(html, selector)
        if (imgMatch) {
          candidates.push({ url: imgMatch, priority: 8, source: selector })
        }
      }

      // 4. Any large images in content
      const allImagesRegex = /<img[^>]*src=["\']([^"']+)["\'][^>]*>/gi
      let imgMatch
      while ((imgMatch = allImagesRegex.exec(html)) !== null) {
        const imgSrc = imgMatch[1]
        const imgTag = imgMatch[0]
        
        // Check for size indicators in width/height attributes
        const widthMatch = imgTag.match(/width=["\'](\d+)["\']/)
        const heightMatch = imgTag.match(/height=["\'](\d+)["\']/)
        
        let priority = 5
        if (widthMatch && heightMatch) {
          const width = parseInt(widthMatch[1])
          const height = parseInt(heightMatch[1])
          if (width >= 400 && height >= 200) {
            priority = 7 // Large image
          }
        }
        
        // Boost priority for images with article-related classes/alt text
        if (imgTag.match(/class=[^>]*(?:featured|hero|article|main|primary)/i) ||
            imgTag.match(/alt=[^>]*(?:article|story|news)/i)) {
          priority += 2
        }
        
        candidates.push({ url: imgSrc, priority, source: 'content' })
      }

      // Filter and normalize URLs
      const validCandidates = candidates
        .filter(candidate => candidate.url && !candidate.url.includes('data:'))
        .map(candidate => ({
          ...candidate,
          url: this.normalizeImageUrl(candidate.url, baseUrl)
        }))
        .filter(candidate => candidate.url)

      // Sort by priority and return the best match
      if (validCandidates.length > 0) {
        validCandidates.sort((a, b) => b.priority - a.priority)
        return validCandidates[0].url
      }

      return null
    } catch (error) {
      console.error('ArticleService: Image extraction error:', error.message)
      return null
    }
  }

  // Extract image URL from CSS selector
  extractImageBySelector(html, selector) {
    try {
      // Simple implementation for common selectors
      if (selector.includes('img')) {
        const className = selector.split(' ')[0].replace('.', '')
        const pattern = `<[^>]*class=[^>]*\\b${className}\\b[^>]*>[\\s\\S]*?<img[^>]*src=["\']([^"']+)["\']`
        const regex = new RegExp(pattern, 'i')
        const match = html.match(regex)
        if (match) return match[1]
      }
      return null
    } catch (error) {
      return null
    }
  }

  // Normalize image URL (resolve relative URLs)
  normalizeImageUrl(imgUrl, baseUrl) {
    try {
      // If already absolute URL, return as-is
      if (imgUrl.startsWith('http://') || imgUrl.startsWith('https://')) {
        return imgUrl
      }
      
      // If protocol-relative URL
      if (imgUrl.startsWith('//')) {
        const protocol = baseUrl.startsWith('https://') ? 'https:' : 'http:'
        return protocol + imgUrl
      }
      
      // If relative URL, resolve against base URL
      if (imgUrl.startsWith('/')) {
        const urlObj = new URL(baseUrl)
        return `${urlObj.protocol}//${urlObj.hostname}${imgUrl}`
      }
      
      // If relative path without leading slash
      if (!imgUrl.startsWith('/')) {
        const urlObj = new URL(baseUrl)
        const basePath = urlObj.pathname.endsWith('/') 
          ? urlObj.pathname 
          : urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1)
        return `${urlObj.protocol}//${urlObj.hostname}${basePath}${imgUrl}`
      }
      
      return null
    } catch (error) {
      return null
    }
  }

  // Clean and format extracted content
  cleanAndFormatContent(content) {
    return content
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/\n\s*\n/g, '\n\n') // Clean up line breaks
      .replace(/^\s+|\s+$/g, '') // Trim
      .replace(/([.!?])\s*([A-Z])/g, '$1\n\n$2') // Add paragraph breaks after sentences
      .replace(/\n{3,}/g, '\n\n') // Limit consecutive line breaks
  }

  // Clean text content
  // IMPORTANT: Decode &amp; LAST to avoid double-unescaping (e.g., &amp;lt; -> &lt; -> <)
  cleanText(text) {
    return text
      .replace(/\s+/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')  // Decode &amp; LAST to prevent double-unescaping
      .trim()
  }

  // Check if article content needs enhancement (is too short or generic)
  needsContentEnhancement(article) {
    if (!article.description && !article.article_body) {
      return true
    }

    const totalContent = (article.description || '') + (article.article_body || '')
    
    // Check if content is too short
    if (totalContent.length < 200) {
      return true
    }

    // Check for generic/placeholder content
    const genericPhrases = [
      'read more',
      'continue reading',
      'full article',
      'visit website',
      'more details',
      'click here',
      'loading...',
      'content not available'
    ]

    const lowerContent = totalContent.toLowerCase()
    if (genericPhrases.some(phrase => lowerContent.includes(phrase))) {
      return true
    }

    return false
  }

  // Enhance article with scraped content
  async enhanceArticle(article) {
    try {
      if (!this.needsContentEnhancement(article)) {
        console.log(`ArticleService: Article "${article.headline}" has sufficient content, skipping enhancement`)
        return article
      }

      if (!article.link && !article.main_entity_of_page) {
        console.log(`ArticleService: Article "${article.headline}" has no link, cannot enhance`)
        return article
      }

      const url = article.link || article.main_entity_of_page
      console.log(`ArticleService: Enhancing article "${article.headline}" with scraped content`)
      
      const scrapedData = await this.scrapeArticleContent(url)
      
      // Merge content and image intelligently
      const enhancedArticle = {
        ...article,
        article_body: scrapedData.content,
        enhanced: true,
        enhancedAt: new Date().toISOString(),
        originalDescription: article.description
      }

      // Add scraped image if article doesn't have one
      if (scrapedData.image && !article.image) {
        enhancedArticle.image = scrapedData.image
        enhancedArticle.scrapedImage = true
        console.log(`ArticleService: Added scraped image to article "${article.headline}": ${scrapedData.image}`)
      }

      // If original description was very short, replace it with an excerpt from scraped content
      if (!article.description || article.description.length < 100) {
        const excerpt = scrapedData.content.length > 300 
          ? scrapedData.content.substring(0, 300) + '...'
          : scrapedData.content
        enhancedArticle.description = excerpt
      }

      console.log(`ArticleService: Successfully enhanced article "${article.headline}"`)
      return enhancedArticle

    } catch (error) {
      console.error(`ArticleService: Failed to enhance article "${article.headline}":`, error.message)
      
      // Return original article with error flag
      return {
        ...article,
        enhancementError: error.message,
        enhancementAttempted: true,
        enhancementAttemptedAt: new Date().toISOString()
      }
    }
  }

  // Batch enhance multiple articles
  async enhanceArticles(articles, maxConcurrent = 3) {
    console.log(`ArticleService: Enhancing ${articles.length} articles with max ${maxConcurrent} concurrent requests`)
    
    const results = []
    
    // Process articles in batches to avoid overwhelming target servers
    for (let i = 0; i < articles.length; i += maxConcurrent) {
      const batch = articles.slice(i, i + maxConcurrent)
      
      const batchPromises = batch.map(article => 
        this.enhanceArticle(article).catch(error => {
          console.error(`ArticleService: Batch enhancement error for "${article.headline}":`, error.message)
          return {
            ...article,
            enhancementError: error.message,
            enhancementAttempted: true
          }
        })
      )
      
      const batchResults = await Promise.all(batchPromises)
      results.push(...batchResults)
      
      // Small delay between batches to be respectful to target servers
      if (i + maxConcurrent < articles.length) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
    
    const enhancedCount = results.filter(article => article.enhanced).length
    console.log(`ArticleService: Enhanced ${enhancedCount}/${articles.length} articles`)
    
    return results
  }
}

export default ArticleService
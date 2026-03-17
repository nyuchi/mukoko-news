/**
 * Article AI Processing Service
 * Handles AI-powered content analysis, cleaning, and enhancement
 * Features: content cleaning, keyword extraction, image processing, quality scoring
 */

export interface ArticleProcessingResult {
  cleanedContent: string
  extractedImages: string[]
  keywords: Array<{
    keyword: string
    confidence: number
    category: string
  }>
  qualityScore: number
  contentHash: string
  embeddingId?: string
  processingTime: number
}

export interface ContentCleaningOptions {
  removeImages: boolean
  removeRandomChars: boolean
  normalizeWhitespace: boolean
  extractImageUrls: boolean
  minContentLength: number
}

export class ArticleAIService {
  private ai: any // Workers AI binding
  private vectorize?: any // Vectorize binding (optional)
  private images?: any // Cloudflare Images binding (optional)
  private d1Service: any // D1Service instance

  constructor(ai: any, vectorize: any, d1Service: any, images?: any) {
    this.ai = ai
    this.vectorize = vectorize
    this.d1Service = d1Service
    this.images = images
  }

  // Getter for backward compatibility
  private get db(): D1Database {
    return this.d1Service.db
  }

  /**
   * Main AI processing pipeline for articles
   */
  async processArticle(article: {
    id: number
    headline: string
    content: string
    description?: string
    article_section_id?: string
  }): Promise<ArticleProcessingResult> {
    const startTime = Date.now()

    try {
      // Log processing start
      await this.logProcessing(article.id, 'full_processing', 'processing', {
        originalLength: article.content?.length || 0,
        headline: article.headline
      })

      // Step 1: Clean content and extract images
      const cleaningResult = await this.cleanContent(article.content || '', {
        removeImages: true,
        removeRandomChars: true,
        normalizeWhitespace: true,
        extractImageUrls: true,
        minContentLength: 100
      })

      // Step 2: Extract keywords using AI
      const keywords = await this.extractKeywords(article.headline, cleaningResult.cleanedContent, article.article_section_id)

      // Step 3: Calculate quality score
      const qualityScore = await this.calculateQualityScore(article.headline, cleaningResult.cleanedContent)

      // Step 4: Generate content hash for duplicate detection
      const contentHash = await this.generateContentHash(article.headline + cleaningResult.cleanedContent)

      // Step 5: Create embedding (if vectorize is available)
      let embeddingId: string | undefined
      if (this.vectorize && cleaningResult.cleanedContent.length > 50) {
        embeddingId = await this.createEmbedding(article.id, article.headline, cleaningResult.cleanedContent)
      }

      // Step 6: Process images with Cloudflare Images
      const processedImages = await this.processImages(cleaningResult.extractedImages)

      const processingTime = Date.now() - startTime

      const result: ArticleProcessingResult = {
        cleanedContent: cleaningResult.cleanedContent,
        extractedImages: processedImages,
        keywords,
        qualityScore,
        contentHash,
        embeddingId,
        processingTime
      }

      // Update database with results
      await this.updateArticleWithAIResults(article.id, result)

      // Log successful completion
      await this.logProcessing(article.id, 'full_processing', 'completed', result)

      return result
    } catch (error) {
      const processingTime = Date.now() - startTime
      
      // Log failure
      await this.logProcessing(article.id, 'full_processing', 'failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime
      })

      throw error
    }
  }

  /**
   * Advanced content cleaning using AI and regex patterns
   */
  async cleanContent(rawContent: string, options: ContentCleaningOptions): Promise<{
    cleanedContent: string
    extractedImages: string[]
    removedCharCount: number
  }> {
    if (!rawContent || rawContent.length < options.minContentLength) {
      return {
        cleanedContent: rawContent || '',
        extractedImages: [],
        removedCharCount: 0
      }
    }

    const originalLength = rawContent.length
    let content = rawContent
    const extractedImages: string[] = []

    // Step 1: Extract image URLs before removing them
    if (options.extractImageUrls) {
      const imageRegexes = [
        /<img[^>]+src="([^"]+)"/gi,           // HTML img tags
        /!\[.*?\]\(([^)]+)\)/g,              // Markdown images
        /https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?/gi, // Direct image URLs
        /src="([^"]*\.(jpg|jpeg|png|gif|webp|svg)[^"]*)"/gi // src attributes
      ]

      imageRegexes.forEach(regex => {
        let match
        while ((match = regex.exec(content)) !== null) {
          const imageUrl = match[1] || match[0]
          if (imageUrl && !extractedImages.includes(imageUrl)) {
            extractedImages.push(imageUrl)
          }
        }
      })
    }

    // Step 2: Remove images and image-related content
    if (options.removeImages) {
      // Use loop-based removal to handle nested/malformed tags
      let previousLength;
      do {
        previousLength = content.length;
        content = content.replace(/<img[^>]*>/gi, '');
      } while (content.length !== previousLength);

      do {
        previousLength = content.length;
        content = content.replace(/<figure[^>]*>[\s\S]*?<\/figure[\s\S]*?>/gi, '');
      } while (content.length !== previousLength);

      content = content
        .replace(/!\[.*?\]\([^)]+\)/g, '') // Remove markdown images
        .replace(/src="[^"]*"/gi, '') // Remove src attributes
        .replace(/\[caption[^\]]*\].*?\[\/caption\]/gi, '') // Remove WordPress captions
    }

    // Step 3: Remove random characters and noise using AI
    if (options.removeRandomChars && content.length > 200) {
      try {
        const cleanedByAI = await this.ai.run('@cf/meta/llama-3-8b-instruct', {
          prompt: `Clean this Zimbabwe news article content by removing:
- Random characters and symbols that aren't part of normal text
- HTML tags and encoded entities
- Advertisement text and social media handles
- Repeated characters (like ---- or ===)
- Email addresses and phone numbers that are not part of the story
- Keep all actual news content, quotes, names, places, and important details

Original content:
${content.substring(0, 2000)}

Return only the cleaned text content, no explanations:`,
          max_tokens: 1000
        })

        if (cleanedByAI?.response?.trim()) {
          content = cleanedByAI.response.trim()
        }
      } catch (error) {
        console.warn('AI content cleaning failed, using regex fallback:', error)
        
        // Fallback to regex-based cleaning
        content = content
          .replace(/[^\w\s\-.,!?;:()"'\[\]\/]/g, ' ') // Keep only common punctuation
          .replace(/\s{2,}/g, ' ') // Remove multiple spaces
          .replace(/(.)\1{3,}/g, '$1$1') // Remove repeated characters (more than 3)
      }
    }

    // Step 4: Normalize whitespace
    if (options.normalizeWhitespace) {
      content = content
        .replace(/\r\n/g, '\n') // Normalize line endings
        .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
        .replace(/\t/g, ' ') // Replace tabs with spaces
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .trim()
    }

    // Step 5: Remove HTML entities and tags (loop-based for nested tags)
    content = content.replace(/&[a-zA-Z0-9#]+;/g, ' '); // HTML entities
    let prevLen;
    do {
      prevLen = content.length;
      content = content.replace(/<[^>]*>/g, '');
    } while (content.length !== prevLen);
    content = content.replace(/\s+/g, ' ').trim(); // Clean up spaces

    const removedCharCount = originalLength - content.length

    return {
      cleanedContent: content,
      extractedImages,
      removedCharCount
    }
  }

  /**
   * Extract keywords using AI and match against existing category keywords
   */
  async extractKeywords(title: string, content: string, existingCategory?: string): Promise<Array<{
    keyword: string
    confidence: number
    category: string
  }>> {
    if (!content || content.length < 50) {
      return []
    }

    try {
      // Get existing keywords from database for context
      const existingKeywords = await this.db
        .prepare(`
          SELECT k.keyword, k.article_section_id, k.relevance_score
          FROM defined_terms k
          JOIN article_sections c ON k.article_section_id = c.id
          WHERE c.enabled = true
          ORDER BY k.usage_count DESC, k.relevance_score DESC
          LIMIT 50
        `)
        .all()

      const keywordList = existingKeywords.results.map((k: any) => k.keyword).join(', ')

      // Use AI to extract and match keywords
      const aiResponse = await this.ai.run('@cf/meta/llama-3-8b-instruct', {
        prompt: `Analyze this Zimbabwe news article and extract relevant keywords.

Article Title: ${title}
Article Content: ${content.substring(0, 1500)}

Available Keywords: ${keywordList}

Instructions:
1. Identify the most relevant keywords from the available list that match this article
2. Consider Zimbabwe-specific context (politics, business, sports, etc.)
3. Return max 8 keywords
4. Rate confidence 0.0-1.0 for each keyword

Return JSON format:
{
  "keywords": [
    {"keyword": "government", "confidence": 0.95, "reasoning": "article discusses government policy"},
    {"keyword": "economy", "confidence": 0.8, "reasoning": "mentions economic impact"}
  ]
}`,
        max_tokens: 500
      })

      let extractedKeywords: Array<{keyword: string, confidence: number, category: string}> = []

      if (aiResponse?.response) {
        try {
          const parsed = JSON.parse(aiResponse.response)
          if (parsed.keywords && Array.isArray(parsed.keywords)) {
            // Match extracted keywords with database keywords to get categories
            const dbKeywords = existingKeywords.results as Array<{ keyword: string; article_section_id: string }>
            for (const kw of parsed.keywords) {
              const dbKeyword = dbKeywords.find((k) =>
                k.keyword.toLowerCase() === kw.keyword.toLowerCase()
              )

              if (dbKeyword && kw.confidence > 0.5) {
                extractedKeywords.push({
                  keyword: kw.keyword,
                  confidence: kw.confidence,
                  category: dbKeyword.article_section_id
                })
              }
            }
          }
        } catch (parseError) {
          console.warn('Failed to parse AI keyword extraction:', parseError)
        }
      }

      // Fallback: simple keyword matching if AI failed
      if (extractedKeywords.length === 0) {
        const contentLower = (title + ' ' + content).toLowerCase()

        for (const kw of existingKeywords.results.slice(0, 20) as Array<{ keyword: string; article_section_id: string }>) {
          if (contentLower.includes(kw.keyword.toLowerCase())) {
            extractedKeywords.push({
              keyword: kw.keyword,
              confidence: 0.7,
              category: kw.article_section_id
            })
          }
        }
      }

      return extractedKeywords.slice(0, 8) // Limit to 8 keywords
    } catch (error) {
      console.error('Keyword extraction failed:', error)
      return []
    }
  }

  /**
   * Calculate content quality score using AI
   */
  async calculateQualityScore(title: string, content: string): Promise<number> {
    if (!content || content.length < 100) {
      return 0.3 // Low score for short content
    }

    try {
      const aiResponse = await this.ai.run('@cf/meta/llama-3-8b-instruct', {
        prompt: `Rate the quality of this Zimbabwe news article on a scale of 0.0 to 1.0.

Consider:
- Content completeness and depth
- Readability and clarity  
- Factual information presence
- Professional journalism standards
- Relevance to Zimbabwe audience

Title: ${title}
Content: ${content.substring(0, 1000)}

Return only a number between 0.0 and 1.0 (e.g., 0.75):`,
        max_tokens: 10
      })

      if (aiResponse?.response) {
        const score = parseFloat(aiResponse.response.trim())
        if (!isNaN(score) && score >= 0 && score <= 1) {
          return score
        }
      }

      // Fallback scoring based on content characteristics
      let score = 0.5 // Base score
      
      if (content.length > 500) score += 0.1
      if (content.length > 1000) score += 0.1
      if (title.length > 20 && title.length < 100) score += 0.1
      if (content.includes('Zimbabwe') || content.includes('Harare')) score += 0.1
      if (!/[^\w\s]/.test(content.substring(0, 200))) score += 0.1 // Clean text
      
      return Math.min(score, 1.0)
    } catch (error) {
      console.error('Quality scoring failed:', error)
      return 0.5 // Default middle score
    }
  }

  /**
   * Process extracted images with Cloudflare Images
   */
  async processImages(imageUrls: string[]): Promise<string[]> {
    if (!this.images || imageUrls.length === 0) {
      return imageUrls // Return original URLs if no image service
    }

    const processedImages: string[] = []

    for (const url of imageUrls.slice(0, 5)) { // Limit to 5 images
      try {
        if (this.isValidImageUrl(url)) {
          // Upload to Cloudflare Images for optimization
          const uploadResponse = await this.images.upload(url)
          if (uploadResponse?.success) {
            processedImages.push(uploadResponse.result.variants[0]) // Optimized URL
          } else {
            processedImages.push(url) // Keep original if upload fails
          }
        }
      } catch (error) {
        console.warn(`Failed to process image ${url}:`, error)
        processedImages.push(url) // Keep original URL
      }
    }

    return processedImages
  }

  /**
   * Create vector embedding for semantic search
   */
  async createEmbedding(articleId: number, title: string, content: string): Promise<string | undefined> {
    if (!this.vectorize) {
      return undefined
    }

    try {
      // Create text for embedding (title + first part of content)
      const text = `${title}\n${content.substring(0, 500)}`
      
      // Generate embedding using Workers AI
      const embedding = await this.ai.run('@cf/baai/bge-m3', {
        text: text
      })

      if (embedding?.data?.[0]) {
        // Store in Vectorize
        const embeddingId = `article_${articleId}`
        
        await this.vectorize.upsert([{
          id: embeddingId,
          values: embedding.data[0],
          metadata: {
            articleId: articleId,
            title: title,
            contentLength: content.length,
            createdAt: new Date().toISOString()
          }
        }])

        return embeddingId
      }
    } catch (error) {
      console.error('Embedding creation failed:', error)
    }

    return undefined
  }

  /**
   * Generate content hash for duplicate detection
   */
  async generateContentHash(content: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(content.toLowerCase().replace(/\s+/g, ' ').trim())
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  /**
   * Update article in database with AI processing results
   */
  async updateArticleWithAIResults(articleId: number, result: ArticleProcessingResult): Promise<void> {
    try {
      // Update article with AI results
      await this.db
        .prepare(`
          UPDATE articles SET
            ai_keywords = ?,
            quality_score = ?,
            embedding_id = ?,
            content_hash = ?,
            processed_content = ?,
            extracted_images = ?,
            ai_processed_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .bind(
          JSON.stringify(result.keywords),
          result.qualityScore,
          result.embeddingId || null,
          result.contentHash,
          result.cleanedContent,
          JSON.stringify(result.extractedImages),
          articleId
        )
        .run()

      // Insert keyword relationships
      for (const keyword of result.keywords) {
        // Find keyword ID
        const keywordRecord = await this.db
          .prepare('SELECT id FROM defined_terms WHERE keyword = ?')
          .bind(keyword.keyword)
          .first()

        if (keywordRecord) {
          // Insert article-keyword relationship
          await this.db
            .prepare(`
              INSERT OR REPLACE INTO article_keywords (
                article_id, keyword_id, confidence_score, extraction_method
              ) VALUES (?, ?, ?, 'ai')
            `)
            .bind(articleId, keywordRecord.id, keyword.confidence)
            .run()
        }
      }
    } catch (error) {
      console.error('Failed to update article with AI results:', error)
    }
  }

  /**
   * Log AI processing events
   */
  async logProcessing(
    articleId: number, 
    processingType: string, 
    status: string, 
    data: any,
    aiModel: string = '@cf/meta/llama-3-8b-instruct'
  ): Promise<void> {
    try {
      const logData = {
        input_data: status === 'processing' ? data : null,
        output_data: status === 'completed' ? data : null,
        error_message: status === 'failed' ? data.error : null,
        processing_time: data.processingTime || null,
        completed_at: status === 'completed' || status === 'failed' ? new Date().toISOString() : null
      }

      await this.db
        .prepare(`
          INSERT INTO ai_processing_log (
            article_id, processing_type, status, input_data, output_data,
            processing_time, error_message, ai_model, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          articleId,
          processingType,
          status,
          logData.input_data ? JSON.stringify(logData.input_data) : null,
          logData.output_data ? JSON.stringify(logData.output_data) : null,
          logData.processing_time,
          logData.error_message,
          aiModel,
          logData.completed_at
        )
        .run()
    } catch (error) {
      console.error('Failed to log AI processing:', error)
    }
  }

  /**
   * Extract author information from byline and content
   */
  async extractAuthors(byline: string, title: string, sourceOutlet: string): Promise<{
    authors: Array<{
      name: string;
      normalizedName: string;
      title?: string;
      outlet?: string;
      contributionType: 'primary' | 'contributor' | 'editor';
      confidence: number;
      bylineOrder?: number;
    }>;
    confidence: number;
  }> {
    const prompt = `
    Extract author information from this Zimbabwe news article byline and context.
    
    Byline: "${byline}"
    Article Title: "${title}"
    Source Outlet: "${sourceOutlet}"
    
    Common Zimbabwe journalists and patterns:
    - "By [Author Name]" format
    - "Staff Reporter" for anonymous reporting
    - "[Author Name], [Title]" format
    - Multiple authors separated by "and" or ","
    - Job titles: Reporter, Senior Reporter, Chief Reporter, Editor, Correspondent, etc.
    
    Return a JSON object with:
    {
      "authors": [
        {
          "name": "Full Name",
          "normalizedName": "full_name_lowercase",
          "title": "Reporter/Editor/etc or null",
          "outlet": "${sourceOutlet}",
          "contributionType": "primary",
          "confidence": 0.95,
          "bylineOrder": 1
        }
      ],
      "confidence": 0.90
    }
    
    For "Staff Reporter" or similar, use that as the name. Extract job titles when present.
    `;

    try {
      const response = await this.ai.run('@cf/meta/llama-3-8b-instruct', {
        messages: [
          { role: 'system', content: 'You are an expert at extracting author information from Zimbabwe news articles. Be precise with name normalization.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 800,
        temperature: 0.2
      });

      const result = JSON.parse(response.response);
      
      // Normalize author names
      const authors = (result.authors || []).map((author: any, index: number) => ({
        ...author,
        normalizedName: this.normalizeAuthorName(author.name),
        bylineOrder: author.bylineOrder || (index + 1),
        outlet: author.outlet || sourceOutlet
      }));

      return {
        authors,
        confidence: result.confidence || 0.7
      };

    } catch (error) {
      console.error('Author extraction failed:', error);
      
      // Fallback: try to extract basic name from byline
      const fallbackAuthor = this.extractBasicAuthor(byline, sourceOutlet);
      
      return {
        authors: fallbackAuthor ? [fallbackAuthor] : [],
        confidence: fallbackAuthor ? 0.5 : 0
      };
    }
  }

  /**
   * Classify content type and characteristics
   */
  async classifyContent(title: string, content: string): Promise<{
    contentType: string;
    contentSubtype?: string;
    urgencyLevel: string;
    geographicScope: string;
    targetAudience: string;
    confidence: number;
  }> {
    const prompt = `
    Classify this Zimbabwe news article content:
    
    Title: "${title}"
    Content: "${content.substring(0, 1500)}..."
    
    Classify into these categories:
    
    Content Types: news, opinion, analysis, feature, sports, business, entertainment, lifestyle
    Content Subtypes: breaking, investigative, profile, review, commentary, editorial, interview
    Urgency Levels: breaking, urgent, standard, archive
    Geographic Scope: local, national, regional, international
    Target Audience: general, business, youth, academic, specialized
    
    Return JSON:
    {
      "contentType": "news",
      "contentSubtype": "breaking",
      "urgencyLevel": "urgent", 
      "geographicScope": "national",
      "targetAudience": "general",
      "confidence": 0.85
    }
    
    Focus on Zimbabwe context and local relevance.
    `;

    try {
      const response = await this.ai.run('@cf/meta/llama-3-8b-instruct', {
        messages: [
          { role: 'system', content: 'You are an expert content classifier for Zimbabwe news media. Focus on accurate categorization.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500,
        temperature: 0.2
      });

      const result = JSON.parse(response.response);
      
      return {
        contentType: result.contentType || 'news',
        contentSubtype: result.contentSubtype,
        urgencyLevel: result.urgencyLevel || 'standard',
        geographicScope: result.geographicScope || 'national',
        targetAudience: result.targetAudience || 'general',
        confidence: result.confidence || 0.7
      };

    } catch (error) {
      console.error('Content classification failed:', error);
      return {
        contentType: 'news',
        urgencyLevel: 'standard',
        geographicScope: 'national',
        targetAudience: 'general',
        confidence: 0.3
      };
    }
  }

  /**
   * AI-based news category classification.
   * Uses Workers AI to classify articles into the proper news category.
   * More accurate than keyword matching for ambiguous content.
   *
   * @param title - Article title
   * @param description - Article description or summary
   * @param content - Full article content (optional, will use first 1500 chars)
   * @returns Category ID and confidence score
   */
  async classifyNewsCategory(
    title: string,
    description?: string,
    content?: string
  ): Promise<{ category: string; confidence: number }> {
    // Valid categories for Pan-African news
    const validCategories = [
      'politics',
      'economy',
      'technology',
      'sports',
      'health',
      'education',
      'entertainment',
      'international',
      'agriculture',
      'crime',
      'environment',
      'general'
    ];

    const textContent = content
      ? content.substring(0, 1500)
      : description || '';

    const prompt = `
    Classify this Pan-African news article into exactly ONE category.

    Title: "${title}"
    Content: "${textContent}..."

    Available categories:
    - politics: Government, elections, parliament, policy, political parties
    - economy: Business, finance, markets, trade, inflation, currency, banking
    - technology: Tech, digital, startups, AI, software, mobile, internet
    - sports: Football, cricket, rugby, athletics, sports news
    - health: Medical, healthcare, hospitals, disease, wellness
    - education: Schools, universities, students, education policy
    - entertainment: Music, movies, celebrities, arts, culture
    - international: World news, foreign affairs, global events
    - agriculture: Farming, crops, livestock, rural development
    - crime: Police, courts, arrests, criminal justice
    - environment: Climate, conservation, wildlife, pollution
    - general: Other news that doesn't fit above categories

    IMPORTANT: Return ONLY valid JSON with category ID and confidence:
    {"category": "politics", "confidence": 0.85}

    Choose the single most relevant category. Confidence should be between 0.5 and 1.0.
    `;

    try {
      const response = await this.ai.run('@cf/meta/llama-3-8b-instruct', {
        messages: [
          {
            role: 'system',
            content: 'You are a news article classifier for Pan-African media. Return only valid JSON with category and confidence.'
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 100,
        temperature: 0.1
      });

      // Parse the response
      const responseText = response.response.trim();

      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[^}]+\}/);
      if (!jsonMatch) {
        console.warn('[ArticleAIService] No JSON found in category response:', responseText);
        return { category: 'general', confidence: 0.3 };
      }

      const result = JSON.parse(jsonMatch[0]);
      const category = String(result.category || 'general').toLowerCase();
      const confidence = Math.max(0.3, Math.min(1, parseFloat(result.confidence) || 0.5));

      // Validate category is in our list
      if (!validCategories.includes(category)) {
        console.warn(`[ArticleAIService] Invalid category "${category}", defaulting to general`);
        return { category: 'general', confidence: 0.3 };
      }

      console.log(`[ArticleAIService] Classified "${title.substring(0, 50)}..." as '${category}' (confidence: ${confidence})`);
      return { category, confidence };

    } catch (error) {
      console.error('[ArticleAIService] Category classification failed:', error);
      return { category: 'general', confidence: 0.3 };
    }
  }

  /**
   * Assess grammar quality
   */
  async assessGrammar(content: string): Promise<number> {
    if (!content || content.length < 50) return 0;

    const prompt = `
    Assess the grammar quality of this Zimbabwe news content:
    
    "${content.substring(0, 1000)}..."
    
    Rate grammar quality from 0.0 to 1.0 considering:
    - Sentence structure
    - Spelling accuracy
    - Punctuation
    - Word choice
    - Clarity
    
    Return only a number between 0.0 and 1.0.
    `;

    try {
      const response = await this.ai.run('@cf/meta/llama-3-8b-instruct', {
        messages: [
          { role: 'system', content: 'You are a grammar and writing quality assessor. Return only a decimal number.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 50,
        temperature: 0.1
      });

      const score = parseFloat(response.response.trim());
      return isNaN(score) ? 0.7 : Math.max(0, Math.min(1, score));

    } catch (error) {
      console.error('Grammar assessment failed:', error);
      return 0.7; // Default moderate score
    }
  }

  /**
   * Assess headline quality
   */
  async assessHeadlineQuality(title: string): Promise<number> {
    if (!title) return 0;

    const prompt = `
    Rate this Zimbabwe news headline quality from 0.0 to 1.0:
    
    "${title}"
    
    Consider:
    - Clarity and informativeness
    - Appropriate length (not too long/short)
    - Zimbabwe context relevance
    - Engaging but not clickbait
    - Accuracy and specificity
    
    Return only a number between 0.0 and 1.0.
    `;

    try {
      const response = await this.ai.run('@cf/meta/llama-3-8b-instruct', {
        messages: [
          { role: 'system', content: 'You are a headline quality assessor. Return only a decimal number.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 50,
        temperature: 0.1
      });

      const score = parseFloat(response.response.trim());
      return isNaN(score) ? 0.7 : Math.max(0, Math.min(1, score));

    } catch (error) {
      console.error('Headline assessment failed:', error);
      return 0.7;
    }
  }

  /**
   * Assess topic relevance to Zimbabwe
   */
  async assessTopicRelevance(title: string, content: string): Promise<number> {
    const prompt = `
    Rate how relevant this article is to Zimbabwe from 0.0 to 1.0:
    
    Title: "${title}"
    Content: "${content.substring(0, 800)}..."
    
    Consider:
    - Direct Zimbabwe focus
    - Local impact and relevance
    - Zimbabwe people, places, institutions mentioned
    - Domestic vs international news
    
    Return only a number between 0.0 and 1.0.
    `;

    try {
      const response = await this.ai.run('@cf/meta/llama-3-8b-instruct', {
        messages: [
          { role: 'system', content: 'You are a Zimbabwe news relevance assessor. Return only a decimal number.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 50,
        temperature: 0.1
      });

      const score = parseFloat(response.response.trim());
      return isNaN(score) ? 0.5 : Math.max(0, Math.min(1, score));

    } catch (error) {
      console.error('Topic relevance assessment failed:', error);
      return 0.5;
    }
  }

  /**
   * Normalize author name for deduplication
   */
  private normalizeAuthorName(name: string): string {
    return name.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '_')
      .trim();
  }

  /**
   * Fallback author extraction using simple patterns
   */
  private extractBasicAuthor(byline: string, outlet: string): any | null {
    if (!byline) return null;

    // Common patterns
    const patterns = [
      /^By\s+(.+)$/i,
      /^(.+),\s*Reporter$/i,
      /^(.+)\s*-\s*Reporter$/i,
      /^([A-Za-z\s]+)$/
    ];

    for (const pattern of patterns) {
      const match = byline.match(pattern);
      if (match) {
        const name = match[1].trim();
        return {
          name,
          normalizedName: this.normalizeAuthorName(name),
          outlet,
          contributionType: 'primary' as const,
          confidence: 0.6,
          bylineOrder: 1
        };
      }
    }

    return null;
  }

  /**
   * Validate image URL
   */
  private isValidImageUrl(url: string): boolean {
    try {
      const urlObj = new URL(url)
      const isHttp = urlObj.protocol === 'http:' || urlObj.protocol === 'https:'
      const isImage = /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i.test(urlObj.pathname)
      const isReasonableSize = url.length < 500 // Avoid extremely long URLs
      
      return isHttp && isImage && isReasonableSize
    } catch {
      return false
    }
  }
}
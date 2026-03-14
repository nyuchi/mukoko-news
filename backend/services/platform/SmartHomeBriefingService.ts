/**
 * SmartHomeBriefingService - Smart home and IoT news briefing endpoints
 *
 * No competitor offers smart home/IoT integration. Mukoko leapfrogs everyone.
 *
 * Provides formatted news briefings for:
 * - Amazon Alexa Flash Briefing (JSON feed)
 * - Google Home / Google Assistant (Actions on Google format)
 * - Apple HomePod (Audio-friendly summaries)
 * - Generic IoT devices (simplified JSON)
 *
 * Features:
 * - Country-specific briefings
 * - Category filtering
 * - Configurable length (1-10 stories)
 * - Audio-friendly text (no abbreviations, clear pronunciation)
 * - Time-aware greetings (Good morning/afternoon/evening)
 * - SSML markup for voice assistants
 */

export interface BriefingOptions {
  country?: string;
  category?: string;
  limit?: number;
  format: 'alexa' | 'google' | 'apple' | 'generic';
  timezone?: string;
  language?: string;
}

// Alexa Flash Briefing feed item
export interface AlexaFlashBriefingItem {
  uid: string;
  updateDate: string;
  titleText: string;
  mainText: string;
  streamUrl?: string;
  redirectionUrl: string;
}

// Google Assistant response
export interface GoogleAssistantResponse {
  speech: string;
  displayText: string;
  items: Array<{
    title: string;
    description: string;
    url: string;
    image?: { url: string; accessibilityText: string };
  }>;
}

// Generic IoT briefing
export interface GenericBriefing {
  greeting: string;
  summary: string;
  stories: Array<{
    id: string;
    headline: string;
    summary: string;
    source: string;
    country: string;
    category: string;
    url: string;
    published_at: string;
    audio_text: string; // SSML-friendly version
  }>;
  metadata: {
    generated_at: string;
    country: string;
    story_count: number;
    next_update: string;
  };
}

// Time-aware greetings (African cultural flair)
const GREETINGS: Record<string, Record<string, string>> = {
  en: {
    morning: 'Good morning! Here are your top stories from across Africa',
    afternoon: 'Good afternoon! Here is your midday news update',
    evening: 'Good evening! Here are today\'s key stories',
    night: 'Here are the latest stories from Mukoko News',
  },
  // Shona greetings
  sn: {
    morning: 'Mangwanani! Heano mashoko asvika kubva muAfrica',
    afternoon: 'Masikati! Heano mashoko emasikati',
    evening: 'Manheru! Heano mashoko ekunze',
    night: 'Heano mashoko matsva kubva kuMukoko News',
  },
  // Zulu greetings
  zu: {
    morning: 'Sawubona! Naziya izindaba eziphezulu zaseAfrika',
    afternoon: 'Sawubona! Naziya izindaba zasemini',
    evening: 'Sawubona! Naziya izindaba zanamhlanje',
    night: 'Naziya izindaba zakamuva zeMukoko News',
  },
  // Swahili greetings
  sw: {
    morning: 'Habari za asubuhi! Hizi ni habari kuu kutoka Afrika',
    afternoon: 'Habari za mchana! Hizi ni habari za mchana',
    evening: 'Habari za jioni! Hizi ni habari za leo',
    night: 'Hizi ni habari za hivi karibuni za Mukoko News',
  },
};

export class SmartHomeBriefingService {
  constructor(private db: D1Database) {}

  /**
   * Generate a briefing in the requested format
   */
  async generateBriefing(options: BriefingOptions): Promise<unknown> {
    const articles = await this.getTopArticles(options);

    switch (options.format) {
      case 'alexa':
        return this.formatAlexaBriefing(articles, options);
      case 'google':
        return this.formatGoogleBriefing(articles, options);
      case 'apple':
        return this.formatAppleBriefing(articles, options);
      case 'generic':
      default:
        return this.formatGenericBriefing(articles, options);
    }
  }

  /**
   * Format for Amazon Alexa Flash Briefing
   */
  private formatAlexaBriefing(
    articles: BriefingArticle[],
    options: BriefingOptions
  ): AlexaFlashBriefingItem[] {
    return articles.map(article => ({
      uid: article.id,
      updateDate: new Date(article.published_at).toISOString(),
      titleText: article.title,
      mainText: this.makeAudioFriendly(article.description || article.title),
      redirectionUrl: `https://news.mukoko.com/article/${article.id}`,
    }));
  }

  /**
   * Format for Google Assistant / Google Home
   */
  private formatGoogleBriefing(
    articles: BriefingArticle[],
    options: BriefingOptions
  ): GoogleAssistantResponse {
    const greeting = this.getGreeting(options.timezone, options.language);
    const summaries = articles.map(a =>
      this.makeAudioFriendly(a.description || a.title)
    );

    const speech = `<speak>
      ${greeting}.
      <break time="500ms"/>
      ${summaries.map((s, i) => `
        Story ${i + 1}: ${s}
        <break time="300ms"/>
      `).join('')}
      That's your Mukoko News briefing. Stay informed, Africa!
    </speak>`;

    return {
      speech,
      displayText: `${greeting}\n\n${articles.map((a, i) =>
        `${i + 1}. ${a.title}`
      ).join('\n')}`,
      items: articles.map(article => ({
        title: article.title,
        description: article.description || '',
        url: `https://news.mukoko.com/article/${article.id}`,
        image: article.image_url ? {
          url: article.image_url,
          accessibilityText: article.title,
        } : undefined,
      })),
    };
  }

  /**
   * Format for Apple HomePod (audio-optimized)
   */
  private formatAppleBriefing(
    articles: BriefingArticle[],
    options: BriefingOptions
  ): { ssml: string; text: string; articles: unknown[] } {
    const greeting = this.getGreeting(options.timezone, options.language);

    const ssml = `<speak>
      ${greeting}.
      <break time="500ms"/>
      ${articles.map((a, i) => `
        <p>
          ${i === 0 ? 'The top story:' : `Story ${i + 1}:`}
          ${this.makeAudioFriendly(a.title)}.
          <break time="200ms"/>
          ${this.makeAudioFriendly(a.description || '')}.
          From ${this.makeAudioFriendly(a.source_name)}.
          <break time="400ms"/>
        </p>
      `).join('')}
      <p>That's your Mukoko News briefing. More stories at news dot mukoko dot com.</p>
    </speak>`;

    return {
      ssml,
      text: articles.map((a, i) =>
        `${i + 1}. ${a.title} — ${a.source_name}`
      ).join('\n'),
      articles: articles.map(a => ({
        id: a.id,
        title: a.title,
        source: a.source_name,
        url: `https://news.mukoko.com/article/${a.id}`,
      })),
    };
  }

  /**
   * Format for generic IoT / custom integration
   */
  private formatGenericBriefing(
    articles: BriefingArticle[],
    options: BriefingOptions
  ): GenericBriefing {
    const greeting = this.getGreeting(options.timezone, options.language);
    const summary = articles.length > 0
      ? `${articles.length} stories from ${this.getUniqueCount(articles, 'source_name')} sources across ${this.getUniqueCount(articles, 'country_code')} countries`
      : 'No stories available at this time';

    return {
      greeting,
      summary,
      stories: articles.map(article => ({
        id: article.id,
        headline: article.title,
        summary: article.description || '',
        source: article.source_name,
        country: article.country_code,
        category: article.category || 'general',
        url: `https://news.mukoko.com/article/${article.id}`,
        published_at: article.published_at,
        audio_text: this.makeAudioFriendly(
          `${article.title}. ${article.description || ''}. From ${article.source_name}.`
        ),
      })),
      metadata: {
        generated_at: new Date().toISOString(),
        country: options.country ?? 'all',
        story_count: articles.length,
        next_update: this.getNextUpdateTime(),
      },
    };
  }

  // --- Data Access ---

  private async getTopArticles(options: BriefingOptions): Promise<BriefingArticle[]> {
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

    const limit = Math.min(options.limit ?? 5, 10);
    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const result = await this.db.prepare(`
      SELECT a.id, a.title, a.description, a.image_url, a.published_at,
             a.country_id as country_code,
             rs.name as source_name
      FROM articles a
      LEFT JOIN rss_sources rs ON a.source_id = rs.id
      ${whereClause}
      ORDER BY a.published_at DESC
      LIMIT ?
    `).bind(...params, limit).all();

    return (result.results ?? []) as unknown as BriefingArticle[];
  }

  // --- Helpers ---

  private getGreeting(timezone?: string, language?: string): string {
    const lang = language ?? 'en';
    const greetings = GREETINGS[lang] ?? GREETINGS.en;

    // Determine time of day
    const now = new Date();
    let hour = now.getUTCHours();

    // Adjust for timezone offset (simplified, uses numeric offset)
    if (timezone) {
      const match = timezone.match(/([+-])(\d{1,2})/);
      if (match) {
        const offset = parseInt(match[2]) * (match[1] === '+' ? 1 : -1);
        hour = (hour + offset + 24) % 24;
      }
    }

    if (hour >= 5 && hour < 12) return greetings.morning;
    if (hour >= 12 && hour < 17) return greetings.afternoon;
    if (hour >= 17 && hour < 21) return greetings.evening;
    return greetings.night;
  }

  private makeAudioFriendly(text: string): string {
    return text
      // Remove HTML tags
      .replace(/<[^>]+>/g, '')
      // Expand common abbreviations
      .replace(/\bPM\b/g, 'Prime Minister')
      .replace(/\bMP\b/g, 'Member of Parliament')
      .replace(/\bGDP\b/g, 'G D P')
      .replace(/\bIMF\b/g, 'I M F')
      .replace(/\bAU\b/g, 'African Union')
      .replace(/\bUN\b/g, 'United Nations')
      .replace(/\bWHO\b/g, 'World Health Organization')
      .replace(/\bZSE\b/g, 'Zimbabwe Stock Exchange')
      .replace(/\bJSE\b/g, 'Johannesburg Stock Exchange')
      // Replace currency symbols
      .replace(/\$(\d)/g, '$1 dollars')
      .replace(/£(\d)/g, '$1 pounds')
      .replace(/€(\d)/g, '$1 euros')
      // Clean up whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  private getUniqueCount(articles: BriefingArticle[], field: keyof BriefingArticle): number {
    return new Set(articles.map(a => a[field])).size;
  }

  private getNextUpdateTime(): string {
    const next = new Date();
    next.setMinutes(next.getMinutes() + 30);
    return next.toISOString();
  }
}

interface BriefingArticle {
  id: string;
  title: string;
  description: string;
  image_url: string | null;
  published_at: string;
  country_code: string;
  source_name: string;
  category?: string;
}

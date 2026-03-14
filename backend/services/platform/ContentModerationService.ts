/**
 * ContentModerationService - Fake news detection, bias checking, cultural alignment
 *
 * Mukoko is not biased but is African culturally aligned and first.
 * This service flags content that:
 * - Contains misinformation or unverifiable claims
 * - Uses manipulative language patterns
 * - Contains hate speech or incitement
 * - Misrepresents African context or perpetuates harmful stereotypes
 * - Lacks source attribution or verifiable facts
 *
 * Uses Workers AI for content analysis with African context awareness.
 * Human moderators review flagged content — AI assists but doesn't censor.
 */

export interface ModerationResult {
  articleId: string;
  overallScore: number; // 0-100, higher = more trustworthy
  flags: ModerationFlag[];
  recommendation: 'approve' | 'review' | 'flag' | 'reject';
  culturalAlignment: CulturalAlignmentScore;
  factCheckSignals: FactCheckSignal[];
  processedAt: string;
  model: string;
}

export interface ModerationFlag {
  type: ModerationFlagType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  evidence: string;
  confidence: number; // 0-1
}

export type ModerationFlagType =
  | 'fake_news'          // Misinformation, fabricated claims
  | 'misleading'         // Clickbait, sensationalism, out-of-context
  | 'hate_speech'        // Ethnic, religious, gender-based hatred
  | 'incitement'         // Calls to violence or unrest
  | 'bias'               // Extreme political/editorial bias without disclosure
  | 'stereotype'         // Harmful stereotypes about African people/countries
  | 'unverified'         // Claims without sources or verifiable facts
  | 'manipulative'       // Emotional manipulation, fear-mongering
  | 'plagiarism'         // Content copied without attribution
  | 'quality'            // Low quality (grammar, coherence, substance)
  | 'cultural_insensitivity'; // Content insensitive to African cultures

export interface CulturalAlignmentScore {
  score: number; // 0-100
  africanPerspective: boolean;   // Is this told from an African viewpoint?
  localContext: boolean;          // Does it provide local context?
  respectfulLanguage: boolean;    // Uses respectful terminology?
  communityRelevance: boolean;    // Relevant to African communities?
  notes: string[];
}

export interface FactCheckSignal {
  claim: string;
  verifiable: boolean;
  sourcesCited: boolean;
  knownMisinformation: boolean;
  confidence: number;
}

export interface ModerationConfig {
  autoApproveThreshold: number;  // Score above this → auto-approve (default: 80)
  autoFlagThreshold: number;     // Score below this → auto-flag (default: 40)
  enableAIModeration: boolean;   // Use AI for automated checks
  requireHumanReview: boolean;   // Always require human review
  blockedDomains: string[];      // Known misinformation sources
  trustedDomains: string[];      // Pre-verified trusted sources
}

// Known misinformation patterns in African media landscape
const MISINFORMATION_PATTERNS = [
  // Clickbait patterns
  /you won't believe/i,
  /shocking truth/i,
  /what they don't want you to know/i,
  /secret revealed/i,
  /breaking.*exclusive.*must see/i,

  // Fake authority patterns
  /according to sources close to/i,
  /insiders reveal/i,
  /leaked documents show/i,

  // Manipulation patterns
  /share before they delete/i,
  /this is being censored/i,
  /mainstream media won't report/i,
];

// Harmful stereotype patterns about Africa
const STEREOTYPE_PATTERNS = [
  /dark continent/i,
  /third world/i,
  /primitive/i,
  /uncivilized/i,
  /tribal warfare/i,
  /backward countr/i,
  /shithole/i,
  /basket case/i,
];

// Hate speech patterns (multilingual coverage for primary markets)
const HATE_SPEECH_PATTERNS = [
  // General incitement
  /kill all/i,
  /exterminate/i,
  /burn them/i,
  /cleanse the/i,

  // Ethnic targeting patterns (context-dependent, AI verifies)
  /cockroach(es)?.*\b(people|them|they)\b/i,
  /vermin.*\b(people|them|they)\b/i,
];

export class ContentModerationService {
  private ai: Ai;
  private db: D1Database;
  private config: ModerationConfig;

  constructor(ai: Ai, db: D1Database, config?: Partial<ModerationConfig>) {
    this.ai = ai;
    this.db = db;
    this.config = {
      autoApproveThreshold: config?.autoApproveThreshold ?? 80,
      autoFlagThreshold: config?.autoFlagThreshold ?? 40,
      enableAIModeration: config?.enableAIModeration ?? true,
      requireHumanReview: config?.requireHumanReview ?? false,
      blockedDomains: config?.blockedDomains ?? [],
      trustedDomains: config?.trustedDomains ?? [],
    };
  }

  /**
   * Moderate an article through the full pipeline
   */
  async moderateArticle(article: {
    id: string;
    title: string;
    content: string;
    description?: string;
    source_url: string;
    source_name: string;
    author?: string;
    country_code?: string;
  }): Promise<ModerationResult> {
    const flags: ModerationFlag[] = [];
    const factCheckSignals: FactCheckSignal[] = [];

    // 1. Pattern-based checks (fast, no AI needed)
    const patternFlags = this.checkPatterns(article.title, article.content);
    flags.push(...patternFlags);

    // 2. Source reputation check
    const sourceFlags = this.checkSourceReputation(article.source_url);
    flags.push(...sourceFlags);

    // 3. AI-powered deep analysis (if enabled)
    let aiScore = 70; // Default neutral score
    let culturalAlignment: CulturalAlignmentScore = {
      score: 50,
      africanPerspective: false,
      localContext: false,
      respectfulLanguage: true,
      communityRelevance: false,
      notes: [],
    };

    if (this.config.enableAIModeration) {
      try {
        const aiResult = await this.aiModerate(article);
        aiScore = aiResult.score;
        flags.push(...aiResult.flags);
        culturalAlignment = aiResult.culturalAlignment;
        factCheckSignals.push(...aiResult.factCheckSignals);
      } catch (error) {
        console.error('[MODERATION] AI analysis failed, using pattern-only:', error);
      }
    }

    // 4. Calculate overall score
    const overallScore = this.calculateOverallScore(aiScore, flags, culturalAlignment);

    // 5. Determine recommendation
    const recommendation = this.getRecommendation(overallScore, flags);

    const result: ModerationResult = {
      articleId: article.id,
      overallScore,
      flags,
      recommendation,
      culturalAlignment,
      factCheckSignals,
      processedAt: new Date().toISOString(),
      model: this.config.enableAIModeration ? '@cf/meta/llama-3.1-8b-instruct' : 'pattern-only',
    };

    // 6. Store moderation result
    await this.storeModerationResult(result);

    return result;
  }

  /**
   * Batch moderate multiple articles
   */
  async moderateBatch(articles: Array<{
    id: string;
    title: string;
    content: string;
    description?: string;
    source_url: string;
    source_name: string;
    author?: string;
    country_code?: string;
  }>): Promise<ModerationResult[]> {
    // Process in parallel with concurrency limit
    const results: ModerationResult[] = [];
    const batchSize = 5;

    for (let i = 0; i < articles.length; i += batchSize) {
      const batch = articles.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(article => this.moderateArticle(article))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Get moderation history for an article
   */
  async getModerationHistory(articleId: string): Promise<ModerationResult[]> {
    const result = await this.db.prepare(`
      SELECT * FROM content_moderation_log
      WHERE article_id = ?
      ORDER BY processed_at DESC
    `).bind(articleId).all();

    return (result.results ?? []).map((row: Record<string, unknown>) => ({
      articleId: row.article_id as string,
      overallScore: row.overall_score as number,
      flags: JSON.parse((row.flags as string) || '[]'),
      recommendation: row.recommendation as ModerationResult['recommendation'],
      culturalAlignment: JSON.parse((row.cultural_alignment as string) || '{}'),
      factCheckSignals: JSON.parse((row.fact_check_signals as string) || '[]'),
      processedAt: row.processed_at as string,
      model: row.model as string,
    }));
  }

  /**
   * Get moderation statistics
   */
  async getStats(days: number = 30): Promise<{
    total: number;
    approved: number;
    flagged: number;
    rejected: number;
    avgScore: number;
    topFlagTypes: Array<{ type: string; count: number }>;
  }> {
    const result = await this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN recommendation = 'approve' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN recommendation IN ('flag', 'review') THEN 1 ELSE 0 END) as flagged,
        SUM(CASE WHEN recommendation = 'reject' THEN 1 ELSE 0 END) as rejected,
        AVG(overall_score) as avg_score
      FROM content_moderation_log
      WHERE processed_at >= datetime('now', '-' || ? || ' days')
    `).bind(days).first<{
      total: number;
      approved: number;
      flagged: number;
      rejected: number;
      avg_score: number;
    }>();

    return {
      total: result?.total ?? 0,
      approved: result?.approved ?? 0,
      flagged: result?.flagged ?? 0,
      rejected: result?.rejected ?? 0,
      avgScore: Math.round(result?.avg_score ?? 0),
      topFlagTypes: [], // Would require a separate query
    };
  }

  /**
   * Update moderation config dynamically
   */
  updateConfig(updates: Partial<ModerationConfig>): void {
    Object.assign(this.config, updates);
  }

  /**
   * Add/remove domains from block/trust lists
   */
  async updateDomainList(
    list: 'blocked' | 'trusted',
    action: 'add' | 'remove',
    domain: string
  ): Promise<void> {
    const targetList = list === 'blocked' ? this.config.blockedDomains : this.config.trustedDomains;
    if (action === 'add') {
      if (!targetList.includes(domain)) targetList.push(domain);
    } else {
      const index = targetList.indexOf(domain);
      if (index !== -1) targetList.splice(index, 1);
    }
  }

  // --- Private Methods ---

  private checkPatterns(title: string, content: string): ModerationFlag[] {
    const flags: ModerationFlag[] = [];
    const fullText = `${title} ${content}`;

    // Check misinformation patterns
    for (const pattern of MISINFORMATION_PATTERNS) {
      const match = fullText.match(pattern);
      if (match) {
        flags.push({
          type: 'misleading',
          severity: 'medium',
          description: `Detected potential clickbait/manipulation pattern`,
          evidence: match[0],
          confidence: 0.7,
        });
      }
    }

    // Check stereotype patterns
    for (const pattern of STEREOTYPE_PATTERNS) {
      const match = fullText.match(pattern);
      if (match) {
        flags.push({
          type: 'stereotype',
          severity: 'high',
          description: 'Contains harmful stereotype about Africa/Africans',
          evidence: match[0],
          confidence: 0.9,
        });
      }
    }

    // Check hate speech patterns
    for (const pattern of HATE_SPEECH_PATTERNS) {
      const match = fullText.match(pattern);
      if (match) {
        flags.push({
          type: 'hate_speech',
          severity: 'critical',
          description: 'Potential hate speech or incitement detected',
          evidence: match[0],
          confidence: 0.8,
        });
      }
    }

    // Check for excessive caps (shouting/clickbait)
    const capsRatio = (title.match(/[A-Z]/g)?.length ?? 0) / Math.max(title.length, 1);
    if (capsRatio > 0.6 && title.length > 10) {
      flags.push({
        type: 'misleading',
        severity: 'low',
        description: 'Excessive capitalization suggests clickbait',
        evidence: title,
        confidence: 0.5,
      });
    }

    // Check for no sources cited in content
    const hasSourceCitation = /according to|said|reported|cited|source:|via /i.test(content);
    if (!hasSourceCitation && content.length > 500) {
      flags.push({
        type: 'unverified',
        severity: 'low',
        description: 'No source citations found in substantial article',
        evidence: 'No attribution patterns detected',
        confidence: 0.4,
      });
    }

    return flags;
  }

  private checkSourceReputation(sourceUrl: string): ModerationFlag[] {
    const flags: ModerationFlag[] = [];

    try {
      const domain = new URL(sourceUrl).hostname.replace(/^www\./, '');

      if (this.config.blockedDomains.includes(domain)) {
        flags.push({
          type: 'fake_news',
          severity: 'critical',
          description: `Source domain is on the blocked list: ${domain}`,
          evidence: sourceUrl,
          confidence: 0.95,
        });
      }
    } catch {
      flags.push({
        type: 'unverified',
        severity: 'medium',
        description: 'Invalid source URL',
        evidence: sourceUrl,
        confidence: 0.9,
      });
    }

    return flags;
  }

  private async aiModerate(article: {
    title: string;
    content: string;
    description?: string;
    source_name: string;
    country_code?: string;
  }): Promise<{
    score: number;
    flags: ModerationFlag[];
    culturalAlignment: CulturalAlignmentScore;
    factCheckSignals: FactCheckSignal[];
  }> {
    const truncatedContent = article.content.slice(0, 3000); // Limit for AI context

    const prompt = `You are a content moderation AI for Mukoko News, a Pan-African news platform.
Mukoko is African culturally aligned and first — not biased, but centered on African perspectives.

Analyze this article and respond ONLY with valid JSON (no markdown, no explanation):

Title: ${article.title}
Source: ${article.source_name}
Country: ${article.country_code ?? 'Unknown'}
Content: ${truncatedContent}

Respond with this exact JSON structure:
{
  "trustworthiness_score": <0-100, higher is more trustworthy>,
  "flags": [
    {"type": "<fake_news|misleading|hate_speech|bias|stereotype|unverified|cultural_insensitivity>", "severity": "<low|medium|high|critical>", "description": "<brief explanation>", "confidence": <0.0-1.0>}
  ],
  "cultural_alignment": {
    "score": <0-100>,
    "african_perspective": <true|false>,
    "local_context": <true|false>,
    "respectful_language": <true|false>,
    "community_relevance": <true|false>,
    "notes": ["<observation>"]
  },
  "fact_check": [
    {"claim": "<key claim>", "verifiable": <true|false>, "sources_cited": <true|false>, "known_misinformation": <true|false>, "confidence": <0.0-1.0>}
  ]
}`;

    const response = await this.ai.run('@cf/meta/llama-3.1-8b-instruct' as any, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1024,
      temperature: 0.1,
    }) as { response?: string };

    try {
      const responseText = response?.response ?? '';
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in AI response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      const flags: ModerationFlag[] = (parsed.flags ?? []).map((f: Record<string, unknown>) => ({
        type: f.type as ModerationFlagType,
        severity: f.severity as ModerationFlag['severity'],
        description: String(f.description ?? ''),
        evidence: 'AI analysis',
        confidence: Number(f.confidence ?? 0.5),
      }));

      const culturalAlignment: CulturalAlignmentScore = {
        score: Number(parsed.cultural_alignment?.score ?? 50),
        africanPerspective: Boolean(parsed.cultural_alignment?.african_perspective),
        localContext: Boolean(parsed.cultural_alignment?.local_context),
        respectfulLanguage: Boolean(parsed.cultural_alignment?.respectful_language ?? true),
        communityRelevance: Boolean(parsed.cultural_alignment?.community_relevance),
        notes: (parsed.cultural_alignment?.notes ?? []).map(String),
      };

      const factCheckSignals: FactCheckSignal[] = (parsed.fact_check ?? []).map((f: Record<string, unknown>) => ({
        claim: String(f.claim ?? ''),
        verifiable: Boolean(f.verifiable),
        sourcesCited: Boolean(f.sources_cited),
        knownMisinformation: Boolean(f.known_misinformation),
        confidence: Number(f.confidence ?? 0.5),
      }));

      return {
        score: Number(parsed.trustworthiness_score ?? 50),
        flags,
        culturalAlignment,
        factCheckSignals,
      };
    } catch (error) {
      console.error('[MODERATION] Failed to parse AI response:', error);
      return {
        score: 50,
        flags: [],
        culturalAlignment: {
          score: 50,
          africanPerspective: false,
          localContext: false,
          respectfulLanguage: true,
          communityRelevance: false,
          notes: ['AI analysis failed, manual review recommended'],
        },
        factCheckSignals: [],
      };
    }
  }

  private calculateOverallScore(
    aiScore: number,
    flags: ModerationFlag[],
    cultural: CulturalAlignmentScore
  ): number {
    let score = aiScore;

    // Penalize for flags
    for (const flag of flags) {
      const penalties: Record<string, number> = {
        critical: 30,
        high: 20,
        medium: 10,
        low: 5,
      };
      score -= penalties[flag.severity] * flag.confidence;
    }

    // Boost for cultural alignment
    if (cultural.africanPerspective) score += 5;
    if (cultural.localContext) score += 3;
    if (cultural.respectfulLanguage) score += 2;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private getRecommendation(
    score: number,
    flags: ModerationFlag[]
  ): ModerationResult['recommendation'] {
    // Critical flags always require review
    const hasCritical = flags.some(f => f.severity === 'critical');
    if (hasCritical) return 'reject';

    const hasHigh = flags.some(f => f.severity === 'high');
    if (hasHigh) return 'flag';

    if (this.config.requireHumanReview) return 'review';

    if (score >= this.config.autoApproveThreshold) return 'approve';
    if (score <= this.config.autoFlagThreshold) return 'flag';

    return 'review';
  }

  private async storeModerationResult(result: ModerationResult): Promise<void> {
    try {
      await this.db.prepare(`
        INSERT INTO content_moderation_log
          (article_id, overall_score, flags, recommendation, cultural_alignment,
           fact_check_signals, processed_at, model)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        result.articleId,
        result.overallScore,
        JSON.stringify(result.flags),
        result.recommendation,
        JSON.stringify(result.culturalAlignment),
        JSON.stringify(result.factCheckSignals),
        result.processedAt,
        result.model
      ).run();
    } catch (error) {
      // Table may not exist yet, log and continue
      console.error('[MODERATION] Failed to store result:', error);
    }
  }
}

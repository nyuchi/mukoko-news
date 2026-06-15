import Anthropic from '@anthropic-ai/sdk';
import type { Env, Article, EnrichmentResult, NamedEntity } from './types';

// Tool definitions for Claude
const ENRICHMENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'classify_article',
    description: 'Classify an article into one or more topic categories from the African news context.',
    input_schema: {
      type: 'object' as const,
      properties: {
        primary_category: {
          type: 'string',
          enum: ['politics', 'economy', 'business', 'technology', 'sports', 'health', 'education', 'entertainment', 'international', 'agriculture', 'crime', 'environment', 'science', 'culture', 'lifestyle', 'travel', 'food', 'general'],
          description: 'Primary category for the article',
        },
        secondary_categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Up to 2 additional relevant categories',
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Confidence score 0-1',
        },
      },
      required: ['primary_category', 'confidence'],
    },
  },
  {
    name: 'extract_keywords_and_entities',
    description: 'Extract keywords and named entities (people, organizations, places, events) from the article.',
    input_schema: {
      type: 'object' as const,
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Top 5-10 keywords or key phrases',
        },
        named_entities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string', enum: ['PERSON', 'ORGANIZATION', 'LOCATION', 'EVENT', 'OTHER'] },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['name', 'type', 'confidence'],
          },
        },
        sentiment: {
          type: 'string',
          enum: ['positive', 'negative', 'neutral', 'mixed'],
        },
      },
      required: ['keywords', 'named_entities', 'sentiment'],
    },
  },
  {
    name: 'score_quality',
    description: 'Score the article quality on multiple dimensions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        overall_score: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Overall quality score 0-1',
        },
        signals: {
          type: 'object',
          properties: {
            headline_quality: { type: 'number', minimum: 0, maximum: 1 },
            content_depth: { type: 'number', minimum: 0, maximum: 1 },
            factual_markers: { type: 'number', minimum: 0, maximum: 1 },
            local_relevance: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['headline_quality', 'content_depth', 'factual_markers', 'local_relevance'],
        },
        summary: {
          type: 'string',
          maxLength: 280,
          description: 'One-sentence summary of the article',
        },
      },
      required: ['overall_score', 'signals', 'summary'],
    },
  },
];

interface ToolResults {
  classification?: { primary_category: string; secondary_categories?: string[]; confidence: number };
  entities?: { keywords: string[]; named_entities: NamedEntity[]; sentiment: string };
  quality?: { overall_score: number; signals: Record<string, number>; summary: string };
}

export async function enrichArticle(article: Article, env: Env): Promise<Partial<EnrichmentResult>> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    baseURL: `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ID || '125a2dfbc21f76a25c980609609e8218'}/mukoko-ai-gateway/anthropic`,
  });

  const content = [
    `Headline: ${article.headline}`,
    article.description ? `Description: ${article.description}` : '',
    article.articleBodyProcessed
      ? `Content (first 1500 chars): ${article.articleBodyProcessed.slice(0, 1500)}`
      : '',
    `Country: ${article.countryCode || 'ZW'}, Language: ${article.inLanguage || 'en'}`,
  ].filter(Boolean).join('\n\n');

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `You are enriching an African news article for the Mukoko News platform. Use ALL THREE tools to fully enrich this article:\n\n${content}`,
    },
  ];

  const toolResults: ToolResults = {};
  let iterations = 0;
  const MAX_ITERATIONS = 5;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      tools: ENRICHMENT_TOOLS,
      messages,
    });

    if (response.stop_reason === 'end_turn') break;

    if (response.stop_reason === 'tool_use') {
      const assistantContent: Anthropic.ContentBlock[] = response.content;
      messages.push({ role: 'assistant', content: assistantContent });

      const toolUseBlocks = assistantContent.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[];
      const toolResultContent: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        const input = toolUse.input as Record<string, unknown>;
        let result: string;

        if (toolUse.name === 'classify_article') {
          toolResults.classification = input as typeof toolResults.classification;
          result = JSON.stringify({ classified: true, category: input.primary_category });
        } else if (toolUse.name === 'extract_keywords_and_entities') {
          toolResults.entities = input as typeof toolResults.entities;
          result = JSON.stringify({ extracted: true, count: (input.keywords as string[]).length });
        } else if (toolUse.name === 'score_quality') {
          toolResults.quality = input as typeof toolResults.quality;
          result = JSON.stringify({ scored: true, score: input.overall_score });
        } else {
          result = JSON.stringify({ error: 'Unknown tool' });
        }

        toolResultContent.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      messages.push({ role: 'user', content: toolResultContent });
    } else {
      break;
    }
  }

  return {
    categories: [
      toolResults.classification?.primary_category,
      ...(toolResults.classification?.secondary_categories ?? []),
    ].filter((c): c is string => Boolean(c)),
    keywords: toolResults.entities?.keywords ?? [],
    namedEntities: (toolResults.entities?.named_entities ?? []) as NamedEntity[],
    qualityScore: toolResults.quality?.overall_score ?? 0,
    qualitySignals: toolResults.quality?.signals ?? {},
    sentiment: toolResults.entities?.sentiment,
    summary: toolResults.quality?.summary,
  };
}

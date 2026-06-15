import type { Env, Article, EnrichmentResult, NamedEntity } from './types';

const ACCOUNT_ID = '125a2dfbc21f76a25c980609609e8218';
const GATEWAY = 'shamwari';
const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT =
  'You are an African news article enrichment AI for Mukoko News. Respond only with valid JSON — no markdown, no explanation.';

function buildPrompt(article: Article): string {
  const content = [
    `Headline: ${article.headline}`,
    article.description ? `Description: ${article.description}` : '',
    article.articleBodyProcessed
      ? `Content: ${article.articleBodyProcessed.slice(0, 1500)}`
      : '',
    `Country: ${article.countryCode ?? 'ZW'}, Language: ${article.inLanguage ?? 'en'}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return `Enrich this African news article. Return a single JSON object with exactly these fields:

{
  "primary_category": one of ["politics","economy","business","technology","sports","health","education","entertainment","international","agriculture","crime","environment","science","culture","lifestyle","travel","food","general"],
  "secondary_categories": array of up to 2 additional categories from the same list,
  "confidence": number 0-1,
  "keywords": array of 5-10 key phrases,
  "named_entities": array of {"name":string,"type":one of ["PERSON","ORGANIZATION","LOCATION","EVENT","OTHER"],"confidence":number 0-1},
  "sentiment": one of ["positive","negative","neutral","mixed"],
  "overall_score": number 0-1,
  "signals": {"headline_quality":0-1,"content_depth":0-1,"factual_markers":0-1,"local_relevance":0-1},
  "summary": "one sentence, max 280 chars"
}

Article:
${content}`;
}

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
  stop_reason: string;
}

export async function enrichArticle(article: Article, env: Env): Promise<Partial<EnrichmentResult>> {
  const resp = await fetch(
    `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY}/anthropic/v1/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildPrompt(article) }],
      }),
    }
  );

  if (!resp.ok) {
    throw new Error(`Anthropic via Shamwari gateway: ${resp.status} ${await resp.text()}`);
  }

  const result = (await resp.json()) as AnthropicResponse;
  const text = result.content.find((b) => b.type === 'text')?.text ?? '';

  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    console.error('[ENRICH] Failed to parse AI response:', text.slice(0, 200));
  }

  return {
    categories: [
      data.primary_category as string | undefined,
      ...((data.secondary_categories as string[]) ?? []),
    ].filter((c): c is string => Boolean(c)),
    keywords: (data.keywords as string[]) ?? [],
    namedEntities: (data.named_entities as NamedEntity[]) ?? [],
    qualityScore: (data.overall_score as number) ?? 0,
    qualitySignals: (data.signals as Record<string, number>) ?? {},
    sentiment: data.sentiment as string | undefined,
    summary: data.summary as string | undefined,
  };
}

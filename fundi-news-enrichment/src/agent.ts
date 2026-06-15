import type { Env, Article, EnrichmentResult, NamedEntity } from './types';

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

export async function enrichArticle(article: Article, env: Env): Promise<Partial<EnrichmentResult>> {
  const result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<typeof env.AI.run>[0], {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildPrompt(article) },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1024,
  });

  const text = typeof result === 'object' && result !== null && 'response' in result
    ? String((result as { response: unknown }).response)
    : '';

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

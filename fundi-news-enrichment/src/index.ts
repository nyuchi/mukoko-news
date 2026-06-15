import { Hono } from 'hono';
import type { Env, EnrichRequest, OrgEnrichRequest } from './types';
import { getDb } from './services/mongo';
import { enrichArticle } from './agent';
import { generateEmbedding } from './services/embeddings';

const app = new Hono<{ Bindings: Env }>();

function requireToken(c: { req: { header: (name: string) => string | undefined }; env: Env }): boolean {
  const auth = c.req.header('authorization') ?? '';
  const token = c.env.ENRICHMENT_API_TOKEN;
  return !token || auth === `Bearer ${token}`;
}

app.get('/health', (c) => c.json({ status: 'ok', service: 'fundi-news-enrichment' }));

app.post('/api/enrich', async (c) => {
  if (!requireToken(c)) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<EnrichRequest>();
  const articleIds: string[] = body.articleIds ?? [];

  if (!articleIds.length) return c.json({ ok: false, error: 'No articleIds provided' }, 400);

  const db = await getDb(c.env.MONGODB_URI);
  const articles = await db
    .collection('articles')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .find({ _id: { $in: articleIds as any[] }, aiProcessed: { $ne: true } })
    .limit(50)
    .toArray();

  let processed = 0;
  let errors = 0;

  for (const article of articles) {
    try {
      const enrichment = await enrichArticle(article as unknown as import('./types').Article, c.env);

      // Generate vector embedding from headline + summary
      const embeddingText = `${article.headline} ${enrichment.summary ?? ''}`.trim();
      const embedding = await generateEmbedding(embeddingText, c.env);

      await db.collection('articles').updateOne(
        { _id: article._id },
        {
          $set: {
            aiProcessed: true,
            aiProcessedAt: new Date(),
            qualityScore: enrichment.qualityScore ?? 0,
            aiQualitySignals: enrichment.qualitySignals,
            aiSummary: enrichment.summary,
            aiSentiment: enrichment.sentiment,
            aiKeywords: enrichment.keywords,
            aiNamedEntities: enrichment.namedEntities,
            aiCategories: enrichment.categories,
            embedding: embedding,
            embeddingModel: embedding ? 'bge-m3' : null,
            updatedAt: new Date(),
          },
        }
      );
      processed++;
    } catch (err) {
      console.error(`[ENRICH] Failed to enrich article ${article._id}:`, err);
      errors++;
    }
  }

  return c.json({ ok: true, processed, errors, total: articles.length });
});

// Place/entity enrichment — calls fundi-ingestion.nyuchi.dev
app.post('/api/enrich/org', async (c) => {
  if (!requireToken(c)) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<OrgEnrichRequest>();

  if (!c.env.FUNDI_INGESTION_URL) {
    return c.json({ ok: false, error: 'FUNDI_INGESTION_URL not configured' }, 503);
  }

  try {
    const resp = await fetch(`${c.env.FUNDI_INGESTION_URL}/api/enrich/entity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${c.env.FUNDI_INGESTION_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    const result = await resp.json() as Record<string, unknown>;
    return c.json({ ok: resp.ok, result });
  } catch (err) {
    console.error('[ENRICH] fundi-ingestion call failed:', err);
    return c.json({ ok: false, error: 'Place enrichment service unavailable' }, 503);
  }
});

export default {
  fetch: app.fetch,
};

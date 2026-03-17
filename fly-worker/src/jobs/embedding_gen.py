"""Embedding generation job.

Generates vector embeddings for articles using Voyage AI.
Called inline after AI processing, with a fallback scheduled catch-up.
"""

import json

from src.db import get_pool
from src.services.embedding import generate_embedding


async def generate_embeddings_batch(article_ids: list[str]) -> None:
    """Generate embeddings for a batch of articles.

    Called inline by rss_collector after ai_processor completes.
    Article IDs are UUID strings.
    """
    if not article_ids:
        return

    pool = await get_pool()
    generated = 0
    errors = 0

    for article_id in article_ids:
        try:
            async with pool.acquire() as conn:
                article = await conn.fetchrow(
                    """SELECT id::text, headline, description, article_body_processed
                       FROM news.news_article WHERE id = $1::uuid AND embedding IS NULL""",
                    article_id,
                )

            if not article:
                continue

            # Build text for embedding
            parts = [
                article["headline"] or "",
                article["description"] or "",
                (article["article_body_processed"] or "")[:4000],
            ]
            text = " ".join(p for p in parts if p)

            if not text.strip():
                continue

            embedding = await generate_embedding(text)
            if embedding:
                async with pool.acquire() as conn:
                    await conn.execute(
                        """UPDATE news.news_article SET
                           embedding = $2,
                           sync_status = 'pending_sync',
                           updated_at = NOW()
                           WHERE id = $1::uuid""",
                        article_id,
                        json.dumps(embedding),
                    )
                generated += 1
            else:
                errors += 1

        except Exception as e:
            print(f"[EMBED] Error for article {article_id}: {e}")
            errors += 1

    print(f"[EMBED] Generated {generated}/{len(article_ids)} embeddings ({errors} errors)")


async def generate_missing_embeddings() -> None:
    """Fallback: find articles missing embeddings and generate them."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id::text FROM news.news_article
               WHERE ai_processed = TRUE AND embedding IS NULL
               ORDER BY ingested_at ASC
               LIMIT 20"""
        )

    if rows:
        ids = [row["id"] for row in rows]
        print(f"[EMBED] Found {len(ids)} articles missing embeddings")
        await generate_embeddings_batch(ids)

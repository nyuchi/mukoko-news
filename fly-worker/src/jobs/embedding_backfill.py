"""Embedding backfill job.

Generates BGE-M3 embeddings for articles that were processed before
the embedding pipeline was added. Runs periodically until all articles
have embeddings.
"""

from src.db import get_pool
from src.services.embeddings import embed_text, build_article_text


async def backfill_embeddings() -> None:
    """Generate embeddings for articles that don't have them yet.

    Processes in batches of 20 to avoid overwhelming the CF Workers AI API.
    """
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id::text, headline, description, articlebody,
                      article_body_processed
               FROM news.news_article
               WHERE ai_processed = TRUE
                 AND embedding_vector IS NULL
               ORDER BY datepublished DESC
               LIMIT 20"""
        )

    if not rows:
        return

    print(f"[EMBEDDINGS] Backfilling {len(rows)} articles...")
    success = 0

    for row in rows:
        article = dict(row)
        text = build_article_text(article)
        if not text:
            continue

        embedding = await embed_text(text)
        if embedding is None:
            continue

        embedding_str = "[" + ",".join(str(v) for v in embedding) + "]"

        async with pool.acquire() as conn:
            await conn.execute(
                """UPDATE news.news_article SET
                       embedding_vector = $2::vector,
                       embedding_model = 'bge-m3'
                   WHERE id = $1::uuid""",
                article["id"],
                embedding_str,
            )

        success += 1

    print(f"[EMBEDDINGS] Backfilled {success}/{len(rows)} articles")

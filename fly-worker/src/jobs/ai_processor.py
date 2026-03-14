"""AI article processing job.

Runs inline after RSS collection. Extracts keywords, scores quality,
generates content hash, and links keywords to articles.
"""

import json

from src.db import get_pool
from src.services.content_cleaner import extract_text, count_words
from src.services.keyword_extractor import extract_keywords
from src.services.quality_scorer import score_article


async def process_articles_batch(article_ids: list[int]) -> None:
    """Process a batch of newly inserted articles with AI.

    Called inline by rss_collector after inserting new articles.
    """
    if not article_ids:
        return

    pool = await get_pool()
    processed = 0
    errors = 0

    for article_id in article_ids:
        try:
            await _process_single(pool, article_id)
            processed += 1
        except Exception as e:
            print(f"[AI] Error processing article {article_id}: {e}")
            errors += 1

    print(f"[AI] Processed {processed}/{len(article_ids)} articles ({errors} errors)")


async def process_unprocessed() -> None:
    """Fallback: find and process any articles that were missed.

    Called on schedule as a catch-up mechanism.
    """
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id FROM articles
               WHERE ai_processed = FALSE
               ORDER BY date_created ASC
               LIMIT 50"""
        )

    if rows:
        ids = [row["id"] for row in rows]
        print(f"[AI] Found {len(ids)} unprocessed articles")
        await process_articles_batch(ids)


async def _process_single(pool, article_id: int) -> None:
    """Process a single article: keywords, quality, update record."""
    async with pool.acquire() as conn:
        article = await conn.fetchrow(
            """SELECT id, headline, description, article_body,
                      article_body_processed, article_section_id,
                      author_name, image, publisher_id
               FROM articles WHERE id = $1""",
            article_id,
        )

    if not article:
        return

    article_dict = dict(article)

    # 1. Extract plain text if not already done
    plain_text = extract_text(article_dict.get("article_body", "") or "")
    word_count = count_words(plain_text)

    # 2. Score quality
    quality_result = score_article(article_dict)
    quality_score = quality_result["quality_score"]

    # 3. Extract keywords
    async with pool.acquire() as conn:
        # Load known terms
        known_terms = await conn.fetch(
            "SELECT id, name, term_code FROM defined_terms WHERE enabled = TRUE"
        )
        known_terms = [dict(t) for t in known_terms]

        # Load section classification keywords
        section_keywords = []
        section_id = article_dict.get("article_section_id")
        if section_id:
            section = await conn.fetchrow(
                "SELECT classification_keywords FROM article_sections WHERE id = $1",
                section_id,
            )
            if section and section["classification_keywords"]:
                kw_data = section["classification_keywords"]
                if isinstance(kw_data, str):
                    section_keywords = json.loads(kw_data)
                else:
                    section_keywords = kw_data

    keywords = await extract_keywords(article_dict, known_terms, section_keywords)

    # 4. Write results
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Update article
            keyword_names = [k["name"] for k in keywords]
            await conn.execute(
                """UPDATE articles SET
                   ai_processed = TRUE,
                   ai_processed_at = NOW(),
                   quality_score = $2,
                   word_count = $3,
                   keywords = $4,
                   updated_at = NOW(),
                   sync_status = 'pending'
                   WHERE id = $1""",
                article_id,
                quality_score,
                word_count,
                json.dumps(keyword_names),
            )

            # Upsert keywords and create links
            for kw in keywords:
                # Ensure the term exists
                await conn.execute(
                    """INSERT INTO defined_terms (id, name, term_code, article_count)
                       VALUES ($1, $2, $3, 1)
                       ON CONFLICT (id) DO UPDATE SET
                           article_count = defined_terms.article_count + 1,
                           updated_at = NOW()""",
                    kw["term_id"],
                    kw["name"],
                    kw["term_id"],
                )

                # Link article to keyword
                await conn.execute(
                    """INSERT INTO article_keywords (article_id, term_id, relevance_score, source)
                       VALUES ($1, $2, $3, $4)
                       ON CONFLICT (article_id, term_id) DO NOTHING""",
                    article_id,
                    kw["term_id"],
                    kw["relevance_score"],
                    kw["source"],
                )

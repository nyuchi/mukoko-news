"""AI article processing job.

Runs inline after RSS collection. Extracts keywords, scores quality,
generates content hash, and links keywords to articles.
"""

from src.db import get_pool
from src.services.content_cleaner import extract_text, count_words
from src.services.keyword_extractor import extract_keywords
from src.services.quality_scorer import score_article
from src.services.couchdb import get_couchdb
from src.services.embeddings import embed_text, build_article_text


async def process_articles_batch(article_ids: list[str]) -> None:
    """Process a batch of newly inserted articles with AI.

    Called inline by rss_collector after inserting new articles.
    Article IDs are UUID strings.
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
            """SELECT id::text FROM news.news_article
               WHERE ai_processed = FALSE
               ORDER BY ingested_at ASC
               LIMIT 50"""
        )

    if rows:
        ids = [row["id"] for row in rows]
        print(f"[AI] Found {len(ids)} unprocessed articles")
        await process_articles_batch(ids)


async def _process_single(pool, article_id: str) -> None:
    """Process a single article: keywords, quality, update record."""
    async with pool.acquire() as conn:
        article = await conn.fetchrow(
            """SELECT id::text, headline, description, articlebody,
                      article_body_processed, articlesection,
                      author, image, publisher_organization_id, couchdb_doc_id
               FROM news.news_article WHERE id = $1::uuid""",
            article_id,
        )

    if not article:
        return

    article_dict = dict(article)

    # Try reading body from CouchDB first
    couchdb_id = article_dict.get("couchdb_doc_id")
    if couchdb_id:
        try:
            doc = await get_couchdb().get_doc(couchdb_id)
            if doc:
                article_dict["articlebody"] = doc.get("articlebody") or article_dict.get("articlebody", "")
        except Exception:
            pass  # Fall through to Postgres body

    # 1. Extract plain text if not already done
    plain_text = extract_text(article_dict.get("articlebody", "") or "")
    word_count = count_words(plain_text)

    # 2. Score quality
    quality_result = score_article(article_dict)
    quality_score = quality_result["quality_score"]

    # 3. Extract keywords
    async with pool.acquire() as conn:
        # Load known terms
        known_terms = await conn.fetch(
            "SELECT id, name, term_code FROM news.defined_term WHERE enabled = TRUE"
        )
        known_terms = [dict(t) for t in known_terms]

        # Load section classification keywords
        section_keywords = []
        section_slug = article_dict.get("articlesection")
        if section_slug:
            section = await conn.fetchrow(
                "SELECT classification_keywords FROM engagement.interest_category WHERE slug = $1",
                section_slug,
            )
            if section and section["classification_keywords"]:
                kw_data = section["classification_keywords"]
                if isinstance(kw_data, str):
                    import json
                    section_keywords = json.loads(kw_data)
                else:
                    section_keywords = kw_data

    keywords = await extract_keywords(article_dict, known_terms, section_keywords)

    # 4. Generate BGE-M3 embedding via Cloudflare Workers AI
    embed_text_str = build_article_text(article_dict)
    embedding = await embed_text(embed_text_str)

    # 5. Write results
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Update article — keywords is TEXT[], pass as Python list directly
            keyword_names = [k["name"] for k in keywords]

            if embedding:
                # Store embedding as pgvector
                embedding_str = "[" + ",".join(str(v) for v in embedding) + "]"
                await conn.execute(
                    """UPDATE news.news_article SET
                       ai_processed = TRUE,
                       ai_processed_at = NOW(),
                       quality_score = $2,
                       wordcount = $3,
                       keywords = $4,
                       embedding_vector = $5::vector,
                       embedding_model = 'bge-m3',
                       updated_at = NOW(),
                       sync_status = 'pending_sync'
                       WHERE id = $1::uuid""",
                    article_id,
                    quality_score,
                    word_count,
                    keyword_names,
                    embedding_str,
                )
            else:
                await conn.execute(
                    """UPDATE news.news_article SET
                       ai_processed = TRUE,
                       ai_processed_at = NOW(),
                       quality_score = $2,
                       wordcount = $3,
                       keywords = $4,
                       updated_at = NOW(),
                       sync_status = 'pending_sync'
                       WHERE id = $1::uuid""",
                    article_id,
                    quality_score,
                    word_count,
                    keyword_names,
                )

            # Upsert keywords and create links
            for kw in keywords:
                # Ensure the term exists
                await conn.execute(
                    """INSERT INTO news.defined_term (id, name, term_code, article_count)
                       VALUES ($1, $2, $3, 1)
                       ON CONFLICT (id) DO UPDATE SET
                           article_count = news.defined_term.article_count + 1,
                           updated_at = NOW()""",
                    kw["term_id"],
                    kw["name"],
                    kw["term_id"],
                )

                # Link article to keyword
                await conn.execute(
                    """INSERT INTO news.article_keyword (article_id, term_id, relevance_score, source)
                       VALUES ($1::uuid, $2, $3, $4)
                       ON CONFLICT (article_id, term_id) DO NOTHING""",
                    article_id,
                    kw["term_id"],
                    kw["relevance_score"],
                    kw["source"],
                )

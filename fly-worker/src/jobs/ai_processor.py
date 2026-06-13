"""AI article processing job.

Runs inline after RSS collection. Extracts keywords, scores quality,
generates embeddings, and updates articles in MongoDB.
"""

from datetime import datetime, timezone

from src.services.mongodb import get_db
from src.services.content_cleaner import extract_text, count_words
from src.services.keyword_extractor import extract_keywords
from src.services.quality_scorer import score_article
from src.services.embeddings import embed_text, build_article_text
from src.services.article_scraper import scrape_article


async def process_articles_batch(article_ids: list[str]) -> None:
    if not article_ids:
        return

    db = get_db()
    processed = 0
    errors = 0

    for article_id in article_ids:
        try:
            await _process_single(db, article_id)
            processed += 1
        except Exception as e:
            print(f"[AI] Error processing article {article_id}: {e}")
            errors += 1

    print(f"[AI] Processed {processed}/{len(article_ids)} articles ({errors} errors)")


async def process_unprocessed() -> None:
    """Fallback: find and process any articles that were missed."""
    db = get_db()
    rows = await db["articles"].find(
        {"ai_processed": False},
        {"_id": 1},
    ).sort("date_published", 1).limit(50).to_list(50)

    if rows:
        ids = [row["_id"] for row in rows]
        print(f"[AI] Found {len(ids)} unprocessed articles")
        await process_articles_batch(ids)


async def _process_single(db, article_id: str) -> None:
    article = await db["articles"].find_one({"_id": article_id})
    if not article:
        return

    # Scrape full article from source URL if RSS content is thin
    rss_body = article.get("article_body", "") or ""
    rss_word_count = count_words(extract_text(rss_body))
    source_url = article.get("url", "")

    if rss_word_count < 200 and source_url:
        scraped = await scrape_article(source_url)
        if scraped and scraped["word_count"] > rss_word_count:
            article["article_body"] = scraped["body_html"]
            if not article.get("description") and scraped.get("excerpt"):
                article["description"] = scraped["excerpt"]
            print(f"[AI] Scraped full article: {rss_word_count} → {scraped['word_count']} words")

    plain_text = extract_text(article.get("article_body", "") or "")
    word_count = count_words(plain_text)

    quality_result = score_article(article)
    quality_score = quality_result["quality_score"]

    # Load known terms from keywords collection (remap _id → id for extractor)
    known_terms_raw = await db["keywords"].find(
        {"enabled": True}, {"_id": 1, "name": 1}
    ).to_list(None)
    known_terms = [{"id": t["_id"], "name": t["name"]} for t in known_terms_raw]

    keywords = await extract_keywords(article, known_terms)
    keyword_names = [k["name"] for k in keywords]

    embed_text_str = build_article_text(article)
    embedding = await embed_text(embed_text_str)

    now = datetime.now(timezone.utc)
    update: dict = {
        "$set": {
            "ai_processed": True,
            "ai_processed_at": now,
            "quality_score": quality_score,
            "word_count": word_count,
            "keywords": keyword_names,
            "sync_status": "pending_sync",
            "updated_at": now,
        }
    }

    if embedding:
        update["$set"]["embedding"] = embedding
        update["$set"]["embedding_model"] = "bge-m3"

    await db["articles"].update_one({"_id": article_id}, update)

    # Upsert keyword entries (track article_count per term)
    for kw in keywords:
        await db["keywords"].update_one(
            {"_id": kw["term_id"]},
            {"$set": {"name": kw["name"]}, "$inc": {"article_count": 1}},
            upsert=True,
        )

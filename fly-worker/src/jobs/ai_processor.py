"""AI article processing job.

Runs inline after RSS collection. Extracts keywords (stored as tags),
scores quality, generates embeddings, and updates articles in MongoDB.
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
        {"aiProcessed": False},
        {"_id": 1},
    ).sort("datePublished", 1).limit(50).to_list(50)

    if rows:
        ids = [row["_id"] for row in rows]
        print(f"[AI] Found {len(ids)} unprocessed articles")
        await process_articles_batch(ids)


async def _process_single(db, article_id: str) -> None:
    article = await db["articles"].find_one({"_id": article_id})
    if not article:
        return

    # Scrape full article if RSS body is thin
    rss_body = article.get("articleBody", "") or ""
    rss_word_count = count_words(extract_text(rss_body))
    source_url = article.get("externalUrl", "")

    if rss_word_count < 200 and source_url:
        scraped = await scrape_article(source_url)
        if scraped and scraped["word_count"] > rss_word_count:
            article["articleBody"] = scraped["body_html"]
            if not article.get("description") and scraped.get("excerpt"):
                article["description"] = scraped["excerpt"]
            print(f"[AI] Scraped full article: {rss_word_count} → {scraped['word_count']} words")

    plain_text = extract_text(article.get("articleBody", "") or "")
    word_count = count_words(plain_text)

    # Map to expected keys for quality_scorer and keyword_extractor
    article_for_processing = {
        "headline": article.get("headline", ""),
        "description": article.get("description", ""),
        "article_body": article.get("articleBody", "") or article.get("articleBodyProcessed", ""),
    }

    quality_result = score_article(article_for_processing)
    quality_score = quality_result["quality_score"]

    # Load known tags (remap _id → id for extractor)
    known_terms_raw = await db["tags"].find(
        {}, {"_id": 1, "name": 1}
    ).to_list(None)
    known_terms = [{"id": t["_id"], "name": t["name"]} for t in known_terms_raw]

    keywords = await extract_keywords(article_for_processing, known_terms)
    keyword_names = [k["name"] for k in keywords]

    # Resolve or create tag documents, collect their IDs
    tag_ids = []
    for kw in keywords:
        tag_slug = kw["term_id"]
        tag_id = await _upsert_tag(db, tag_slug, kw["name"])
        if tag_id:
            tag_ids.append(tag_id)

    embed_text_str = build_article_text(article_for_processing)
    embedding = await embed_text(embed_text_str)

    now = datetime.now(timezone.utc)
    update: dict = {
        "$set": {
            "tagIds": tag_ids,
            "wordCount": word_count,
            "aiProcessed": True,
            "aiProcessedAt": now,
            "qualityScore": quality_score,
            "updatedAt": now,
        }
    }

    if embedding:
        update["$set"]["embedding"] = embedding
        update["$set"]["embeddingModel"] = "bge-m3"

    await db["articles"].update_one({"_id": article_id}, update)


async def _upsert_tag(db, tag_slug: str, name: str) -> str | None:
    """Upsert a tag and return its _id."""
    import re
    clean_slug = re.sub(r"[^\w-]", "", tag_slug.lower())[:100] or "unknown"

    result = await db["tags"].find_one_and_update(
        {"_id": clean_slug},
        {
            "$setOnInsert": {
                "_id": clean_slug,
                "_schemaVersion": "v3.1",
                "tagSlug": clean_slug,
                "name": name,
                "articleCount": 0,
                "createdAt": datetime.now(timezone.utc),
                "updatedAt": datetime.now(timezone.utc),
            },
            "$inc": {"articleCount": 1},
            "$set": {"updatedAt": datetime.now(timezone.utc)},
        },
        upsert=True,
        return_document=True,
    )
    return result["_id"] if result else clean_slug

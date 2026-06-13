"""RSS feed collection job.

Fetches RSS feeds from all enabled feed sources, parses articles,
deduplicates, inserts new articles, then runs AI processing inline.
"""

import time
import uuid
from datetime import datetime, timezone

import httpx

from src.config import settings
from src.services.mongodb import get_db
from src.services.rss_parser import parse_feed
from src.services.content_cleaner import clean_html, extract_text, count_words, estimate_reading_time
from src.jobs.ai_processor import process_articles_batch


async def collect_feeds() -> None:
    """Main RSS collection job. Runs every 15 minutes."""
    start = time.time()
    db = get_db()
    stats = {"sources": 0, "fetched": 0, "inserted": 0, "errors": 0, "skipped": 0}

    try:
        sources = await db["feed_sources"].find(
            {"is_active": True}
        ).sort([("priority", -1), ("consecutive_failures", 1)]).to_list(None)

        stats["sources"] = len(sources)
        print(f"[RSS] Starting collection for {len(sources)} sources")

        batch_size = settings.rss_batch_size
        new_article_ids = []

        for i in range(0, len(sources), batch_size):
            batch = sources[i: i + batch_size]
            batch_ids = await _process_batch(batch, db, stats)
            new_article_ids.extend(batch_ids)

        if new_article_ids:
            print(f"[RSS] Processing {len(new_article_ids)} new articles with AI...")
            await process_articles_batch(new_article_ids)

        duration = int((time.time() - start) * 1000)
        print(
            f"[RSS] Complete: {stats['inserted']} new, "
            f"{stats['skipped']} dupes, {stats['errors']} errors "
            f"({duration}ms)"
        )

        await db["pipeline_logs"].insert_one({
            "job_type": "rss_collection",
            "status": "success",
            "articles_collected": stats["fetched"],
            "articles_processed": stats["inserted"],
            "errors": stats["errors"],
            "duration_ms": duration,
            "metadata": stats,
            "started_at": datetime.fromtimestamp(start, tz=timezone.utc),
            "completed_at": datetime.now(timezone.utc),
        })

    except Exception as e:
        print(f"[RSS] Collection failed: {e}")
        duration = int((time.time() - start) * 1000)
        await db["pipeline_logs"].insert_one({
            "job_type": "rss_collection",
            "status": "failed",
            "errors": stats["errors"],
            "duration_ms": duration,
            "error_message": str(e),
            "started_at": datetime.fromtimestamp(start, tz=timezone.utc),
            "completed_at": datetime.now(timezone.utc),
        })


async def _process_batch(sources: list, db, stats: dict) -> list[str]:
    """Fetch and process a batch of RSS sources. Returns new article IDs."""
    new_ids = []

    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=settings.rss_fetch_timeout,
    ) as client:
        for source in sources:
            try:
                if source.get("consecutive_failures", 0) >= 8:
                    continue

                response = await client.get(source["feed_url"])
                if response.status_code != 200:
                    await _record_failure(db, source, f"HTTP {response.status_code}")
                    stats["errors"] += 1
                    continue

                feed_data = parse_feed(response.text, source)
                articles = feed_data["articles"]
                stats["fetched"] += len(articles)

                ids = await _insert_articles(db, articles, stats)
                new_ids.extend(ids)

                await _record_success(db, source, len(articles))

            except httpx.TimeoutException:
                await _record_failure(db, source, "Timeout")
                stats["errors"] += 1
            except Exception as e:
                await _record_failure(db, source, str(e)[:500])
                stats["errors"] += 1

    return new_ids


async def _insert_articles(db, articles: list[dict], stats: dict) -> list[str]:
    """Insert new articles, skipping duplicates. Returns list of new article IDs."""
    new_ids = []

    for article in articles:
        existing = await db["articles"].find_one({
            "$or": [
                {"source_feed_id": article["source_feed_id"]},
                {"url": article["mainentityofpage"]},
            ]
        }, {"_id": 1})

        if existing:
            stats["skipped"] += 1
            continue

        raw_body = article.get("article_body", "") or ""
        cleaned_body = clean_html(raw_body) if raw_body else ""
        plain_text = extract_text(raw_body) if raw_body else ""
        word_count = count_words(plain_text)
        reading_time = estimate_reading_time(word_count)

        slug = article["slug"]
        if await db["articles"].find_one({"slug": slug}, {"_id": 1}):
            slug = f"{slug}-{article['source_fingerprint'][:8]}"

        article_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)

        doc = {
            "_id": article_id,
            "headline": article["headline"],
            "description": article.get("description", ""),
            "article_body": raw_body,
            "article_body_processed": cleaned_body,
            "slug": slug,
            "url": article["mainentityofpage"],
            "source_feed_id": article["source_feed_id"],
            "image": article.get("image"),
            "author": article.get("author"),
            "publisher_id": str(article.get("publisher_organization_id") or ""),
            "publisher": article.get("publisher"),
            "section": article.get("articlesection", "general"),
            "country": article.get("primary_location_country", "ZW"),
            "date_published": article.get("datepublished"),
            "source_fingerprint": article["source_fingerprint"],
            "language": article.get("inlanguage", "en"),
            "word_count": word_count,
            "reading_time_minutes": reading_time,
            "status": "published",
            "ingestion_method": "rss_feed",
            "ai_processed": False,
            "ai_processed_at": None,
            "quality_score": 0.0,
            "keywords": [],
            "embedding": None,
            "embedding_model": None,
            "engagement": {"views": 0, "likes": 0, "bookmarks": 0, "shares": 0, "score": 0.0},
            "sync_status": "pending_sync",
            "ingested_at": now,
            "updated_at": now,
        }

        try:
            await db["articles"].insert_one(doc)
            new_ids.append(article_id)
            stats["inserted"] += 1
        except Exception as e:
            print(f"[RSS] Insert failed for {article.get('mainentityofpage', '?')}: {e}")

    return new_ids


async def _record_success(db, source: dict, articles_count: int) -> None:
    now = datetime.now(timezone.utc)
    await db["feed_sources"].update_one(
        {"_id": source["_id"]},
        {"$set": {
            "last_fetched_at": now,
            "last_successful_fetch_at": now,
            "consecutive_failures": 0,
            "updated_at": now,
        }, "$inc": {"total_fetch_count": 1}},
    )


async def _record_failure(db, source: dict, error: str) -> None:
    now = datetime.now(timezone.utc)
    await db["feed_sources"].update_one(
        {"_id": source["_id"]},
        {"$set": {
            "last_fetched_at": now,
            "last_fetch_error": error,
            "updated_at": now,
        }, "$inc": {"consecutive_failures": 1, "total_error_count": 1}},
    )

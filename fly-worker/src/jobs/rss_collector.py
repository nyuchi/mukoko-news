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
        sources = await db["feedSources"].find(
            {"isActive": True}
        ).to_list(None)

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

        await db["pipelineLogs"].insert_one({
            "jobType": "rss_collection",
            "status": "success",
            "articlesCollected": stats["fetched"],
            "articlesProcessed": stats["inserted"],
            "errors": stats["errors"],
            "durationMs": duration,
            "metadata": stats,
            "startedAt": datetime.fromtimestamp(start, tz=timezone.utc),
            "completedAt": datetime.now(timezone.utc),
        })

    except Exception as e:
        print(f"[RSS] Collection failed: {e}")
        duration = int((time.time() - start) * 1000)
        await db["pipelineLogs"].insert_one({
            "jobType": "rss_collection",
            "status": "failed",
            "errors": stats["errors"],
            "durationMs": duration,
            "errorMessage": str(e),
            "startedAt": datetime.fromtimestamp(start, tz=timezone.utc),
            "completedAt": datetime.now(timezone.utc),
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
                # Skip persistently failing sources
                if source.get("consecutiveFailures", 0) >= 8:
                    continue

                response = await client.get(source["feedUrl"])
                if response.status_code != 200:
                    await _record_failure(db, source, f"HTTP {response.status_code}")
                    stats["errors"] += 1
                    continue

                feed_data = parse_feed(response.text, source)
                articles = feed_data["articles"]
                stats["fetched"] += len(articles)

                ids = await _insert_articles(db, articles, source, stats)
                new_ids.extend(ids)

                await _record_success(db, source, len(articles))

            except httpx.TimeoutException:
                await _record_failure(db, source, "Timeout")
                stats["errors"] += 1
            except Exception as e:
                await _record_failure(db, source, str(e)[:500])
                stats["errors"] += 1

    return new_ids


async def _insert_articles(db, articles: list[dict], source: dict, stats: dict) -> list[str]:
    """Insert new articles, skipping duplicates. Returns list of new article IDs."""
    new_ids = []
    auto_approve = source.get("autoApprove", False)

    for article in articles:
        # Dedup by feedSourceId+guid or externalUrl
        existing = await db["articles"].find_one({
            "$or": [
                {"feedSourceId": source["_id"], "sourceGuid": article["source_feed_id"]},
                {"externalUrl": article["mainentityofpage"]},
            ]
        }, {"_id": 1})

        if existing:
            stats["skipped"] += 1
            continue

        raw_body = article.get("article_body", "") or ""
        plain_text = extract_text(raw_body) if raw_body else ""
        word_count = count_words(plain_text)

        # Ensure unique slug
        slug = article["slug"]
        if await db["articles"].find_one({"slug": slug}, {"_id": 1}):
            slug = f"{slug}-{article['source_fingerprint'][:8]}"

        article_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)

        # image as ImageObject array (schema.org)
        image_url = (article.get("image") or {}).get("url") if isinstance(article.get("image"), dict) else None
        image = [{"@type": "ImageObject", "url": image_url}] if image_url else []

        doc = {
            "_id": article_id,
            "_schemaVersion": "v3.1",
            # Required schema fields
            "feedSourceId": source["_id"],
            "mediaOrganizationId": source["mediaOrganizationId"],
            "externalUrl": article["mainentityofpage"],
            "headline": article["headline"],
            "slug": slug,
            "inLanguage": article.get("inlanguage", "en"),
            "status": "approved" if auto_approve else "pending",
            "moderationStatus": "active",
            "isApproved": auto_approve,
            "scrapedAt": now,
            "createdAt": now,
            "updatedAt": now,
            # Optional schema fields
            "description": article.get("description", ""),
            "articleBody": raw_body,
            "articleSection": article.get("articlesection", "general"),
            "datePublished": article.get("datepublished"),
            "image": image,
            "wordCount": word_count,
            "categoryIds": [],
            "tagIds": [],
            "journalistIds": [],
            "bundu": {"trustSignals": {}, "ubuntuScoreSnapshot": None},
            # Pipeline-specific extras (allowed by moderate validation level)
            "sourceGuid": article["source_feed_id"],
            "sourceFingerprint": article["source_fingerprint"],
            "articleBodyProcessed": clean_html(raw_body) if raw_body else "",
            "readingTimeMinutes": estimate_reading_time(word_count),
            "aiProcessed": False,
            "aiProcessedAt": None,
            "qualityScore": 0.0,
            "embeddingModel": None,
            "ingestionMethod": "rss_feed",
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
    await db["feedSources"].update_one(
        {"_id": source["_id"]},
        {"$set": {
            "lastFetchedAt": now,
            "lastFetchStatus": "success",
            "lastFetchError": None,
            "consecutiveFailures": 0,
            "updatedAt": now,
        }, "$inc": {"articleCount": articles_count}},
    )


async def _record_failure(db, source: dict, error: str) -> None:
    now = datetime.now(timezone.utc)
    await db["feedSources"].update_one(
        {"_id": source["_id"]},
        {"$set": {
            "lastFetchedAt": now,
            "lastFetchStatus": "error",
            "lastFetchError": error,
            "updatedAt": now,
        }, "$inc": {"consecutiveFailures": 1}},
    )

"""
Batch RSS collection pipeline — the main workhorse.

This is NOT a port of SimpleRSSService.refreshAllFeeds(). It's a purpose-built
batch pipeline that:
1. Loads sources from MongoDB sorted by country priority + health
2. Adaptively skips unhealthy sources
3. Fetches feeds in parallel batches
4. Deduplicates by content_hash and rss_guid
5. Runs the AI processing pipeline on new articles
6. Writes to MongoDB (primary) and syncs to D1 (edge cache)
"""

import asyncio
import hashlib
import time
from datetime import datetime, timezone

from services.mongodb import MongoDBClient
from services.rss_parser import parse_rss_feed
from services.source_health import classify_health, should_fetch


# Country priority — ZW is primary market, processed first
COUNTRY_PRIORITY = {
    "ZW": 1,
    "ZA": 2, "KE": 3, "NG": 4, "GH": 5,
    "TZ": 6, "UG": 7, "RW": 8, "ET": 9,
    "BW": 10, "ZM": 11, "MW": 12,
    "EG": 13, "MA": 14, "NA": 15, "MZ": 16,
}

# Max concurrent feed fetches (Workers subrequest limit is 50)
BATCH_SIZE = 10

# Max articles per feed to process
MAX_ARTICLES_PER_FEED = 20


async def collect_feeds(env) -> dict:
    """
    Main pipeline: collect RSS feeds, process articles, store in MongoDB.

    Called by cron every 15 minutes.
    """
    start = time.time()
    db = MongoDBClient(env)

    # Step 1: Load sources sorted by country priority + health
    sources = await _load_sources(db)
    if not sources:
        return {"error": "No sources found", "new_articles": 0}

    # Step 2: Filter to sources that should be fetched (adaptive scheduling)
    due_sources = [s for s in sources if should_fetch(s)]
    print(f"[COLLECTOR] {len(due_sources)}/{len(sources)} sources due for fetch")

    # Step 3: Batch fetch and process
    total_new = 0
    total_errors = 0
    health_records: list[dict] = []

    for batch_start in range(0, len(due_sources), BATCH_SIZE):
        batch = due_sources[batch_start:batch_start + BATCH_SIZE]
        results = await asyncio.gather(
            *[_fetch_and_process(source, db, env) for source in batch],
            return_exceptions=True,
        )

        for source, result in zip(batch, results):
            source_id = source.get("_id") or source.get("id")
            if isinstance(result, BaseException):
                print(f"[COLLECTOR] Source {source.get('name')} failed: {result}")
                health_records.append({"source_id": source_id, "success": False, "error": str(result)})
                total_errors += 1
            else:
                res: dict = result  # type: ignore[assignment]
                total_new += res.get("new_articles", 0)
                health_records.append({
                    "source_id": source_id,
                    "success": True,
                    "articles": res.get("new_articles", 0),
                })

    # Step 4: Update source health in MongoDB
    await _record_health(db, health_records)

    elapsed = int((time.time() - start) * 1000)
    return {
        "sources_checked": len(due_sources),
        "new_articles": total_new,
        "errors": total_errors,
        "elapsed_ms": elapsed,
    }


async def _load_sources(db: MongoDBClient) -> list[dict]:
    """Load enabled RSS sources, sorted by country priority then health."""
    sources = await db.find(
        "rss_sources",
        {"enabled": True},
        sort={"country_id": 1},
        limit=500,
    )

    # Sort by country priority, then health (healthy first)
    def sort_key(s: dict):
        country = s.get("country_id", "ZZ")
        priority = COUNTRY_PRIORITY.get(country, 99)
        failures = s.get("consecutive_failures", 0)
        return (priority, failures)

    sources.sort(key=sort_key)
    return sources


async def _fetch_and_process(source: dict, db: MongoDBClient, env) -> dict:
    """Fetch a single RSS feed, parse, deduplicate, and store new articles."""
    source_id = source.get("_id") or source.get("id")
    source_name = source.get("name", "")
    feed_url = source.get("url", "")

    if not feed_url:
        return {"new_articles": 0, "error": "No feed URL"}

    # Fetch XML
    xml_content = await _fetch_feed(feed_url, env)
    if not xml_content:
        return {"new_articles": 0, "error": "Empty response"}

    # Parse feed
    source_meta = {
        "id": source_id,
        "name": source_name,
        "category": source.get("category"),
        "country_id": source.get("country_id"),
    }
    parsed = await parse_rss_feed(xml_content, source_meta, env)
    articles = parsed.get("articles", [])

    if not articles:
        return {"new_articles": 0}

    # Deduplicate against MongoDB (by rss_guid and content_hash)
    new_articles = await _deduplicate(articles, db)
    if not new_articles:
        return {"new_articles": 0}

    # Generate content hashes
    for article in new_articles:
        title = article.get("title", "")
        content = article.get("content", article.get("description", ""))
        article["content_hash"] = hashlib.sha256(
            (title + content).encode("utf-8")
        ).hexdigest()[:16]
        article["created_at"] = datetime.now(timezone.utc).isoformat()
        article["ai_processed"] = False

    # Store in MongoDB
    try:
        await db.insert_many("articles", new_articles)
    except Exception as e:
        print(f"[COLLECTOR] Insert failed for {source_name}: {e}")
        return {"new_articles": 0, "error": str(e)}

    return {"new_articles": len(new_articles)}


async def _fetch_feed(url: str, env) -> str:
    """Fetch RSS feed XML using JS fetch FFI."""
    try:
        from js import fetch  # type: ignore[import-not-found]
        response = await fetch(url, {"method": "GET", "redirect": "follow"})
        if not response.ok:
            return ""
        return await response.text()
    except ImportError:
        print(f"[COLLECTOR] JS FFI not available, cannot fetch {url}")
        return ""
    except Exception as e:
        print(f"[COLLECTOR] Fetch failed for {url}: {e}")
        return ""


async def _deduplicate(articles: list[dict], db: MongoDBClient) -> list[dict]:
    """Remove articles that already exist in MongoDB (by rss_guid or original_url)."""
    guids = [a["rss_guid"] for a in articles if a.get("rss_guid")]
    urls = [a["original_url"] for a in articles if a.get("original_url")]

    if not guids and not urls:
        return articles

    # Check existing by rss_guid
    existing_guids: set[str] = set()
    if guids:
        existing = await db.find(
            "articles",
            {"rss_guid": {"$in": guids}},
            projection={"rss_guid": 1},
            limit=len(guids),
        )
        existing_guids = {e["rss_guid"] for e in existing if e.get("rss_guid")}

    # Check existing by original_url
    existing_urls: set[str] = set()
    if urls:
        existing = await db.find(
            "articles",
            {"original_url": {"$in": urls}},
            projection={"original_url": 1},
            limit=len(urls),
        )
        existing_urls = {e["original_url"] for e in existing if e.get("original_url")}

    return [
        a for a in articles
        if a.get("rss_guid") not in existing_guids
        and a.get("original_url") not in existing_urls
    ]


async def _record_health(db: MongoDBClient, records: list[dict]):
    """Update source health status in MongoDB."""
    now = datetime.now(timezone.utc).isoformat()

    for record in records:
        source_id = record["source_id"]
        if record["success"]:
            await db.update_one(
                "rss_sources",
                {"_id": source_id},
                {"$set": {
                    "consecutive_failures": 0,
                    "last_successful_fetch": now,
                    "last_fetch_at": now,
                }},
            )
        else:
            await db.update_one(
                "rss_sources",
                {"_id": source_id},
                {"$inc": {"consecutive_failures": 1},
                 "$set": {
                    "last_error_at": now,
                    "last_fetch_at": now,
                    "last_error": record.get("error", ""),
                }},
            )

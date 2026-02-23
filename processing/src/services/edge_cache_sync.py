"""
Edge cache sync — replicate recent MongoDB data to D1.

D1 serves as a fast-read edge cache for African markets with limited
bandwidth. This syncs the latest articles, keywords, and categories
from MongoDB (source of truth) to D1 (edge cache).

Called by cron every hour.
"""

import time
from services.mongodb import MongoDBClient


async def sync_edge_cache(env) -> dict:
    """
    Sync recent articles from MongoDB → D1 edge cache.

    Steps:
    1. Fetch articles updated in the last 2 hours from MongoDB
    2. Upsert into D1 articles table
    3. Sync keywords and categories
    4. Log sync stats
    """
    start = time.time()
    db = MongoDBClient(env)
    d1 = getattr(env, "EDGE_CACHE_DB", None)

    if not d1:
        return {"error": "D1 binding not available", "synced": 0}

    stats = {"articles": 0, "keywords": 0, "categories": 0, "errors": 0}

    # Sync articles (last 2 hours — overlap ensures we don't miss any)
    try:
        from datetime import datetime, timezone, timedelta
        since = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()

        articles = await db.find(
            "articles",
            {"$or": [
                {"created_at": {"$gte": since}},
                {"updated_at": {"$gte": since}},
            ]},
            projection={
                "title": 1, "slug": 1, "description": 1, "content_snippet": 1,
                "author": 1, "source": 1, "source_id": 1, "category_id": 1,
                "country_id": 1, "published_at": 1, "image_url": 1,
                "original_url": 1, "rss_guid": 1, "view_count": 1,
                "like_count": 1, "bookmark_count": 1, "quality_score": 1,
                "ai_processed": 1,
            },
            sort={"published_at": -1},
            limit=200,
        )

        for article in articles:
            try:
                await _upsert_article(d1, article)
                stats["articles"] += 1
            except Exception as e:
                stats["errors"] += 1
                if stats["errors"] <= 3:
                    print(f"[SYNC] Article upsert failed: {e}")

    except Exception as e:
        print(f"[SYNC] Article sync failed: {e}")
        stats["errors"] += 1

    # Sync keywords
    try:
        keywords = await db.find(
            "keywords",
            {},
            sort={"usage_count": -1},
            limit=500,
        )
        for kw in keywords:
            try:
                await _upsert_keyword(d1, kw)
                stats["keywords"] += 1
            except Exception:
                stats["errors"] += 1

    except Exception as e:
        print(f"[SYNC] Keyword sync failed: {e}")

    # Sync categories
    try:
        categories = await db.find("categories", {}, limit=50)
        for cat in categories:
            try:
                await _upsert_category(d1, cat)
                stats["categories"] += 1
            except Exception:
                stats["errors"] += 1

    except Exception as e:
        print(f"[SYNC] Category sync failed: {e}")

    elapsed = int((time.time() - start) * 1000)
    stats["elapsed_ms"] = elapsed
    print(f"[SYNC] Completed: {stats['articles']} articles, {stats['keywords']} keywords, {stats['categories']} categories in {elapsed}ms")
    return stats


async def _upsert_article(d1, article: dict):
    """Upsert a single article into D1 edge cache."""
    article_id = article.get("_id") or article.get("id")
    if not article_id:
        return

    await d1.prepare("""
        INSERT OR REPLACE INTO articles (
            id, title, slug, description, author, source, source_id,
            category_id, country_id, published_at, image_url, original_url,
            rss_guid, view_count, like_count, bookmark_count, quality_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """).bind(
        str(article_id),
        article.get("title", ""),
        article.get("slug", ""),
        (article.get("description") or "")[:500],
        article.get("author", ""),
        article.get("source", ""),
        article.get("source_id"),
        article.get("category_id"),
        article.get("country_id"),
        article.get("published_at", ""),
        article.get("image_url", ""),
        article.get("original_url", ""),
        article.get("rss_guid", ""),
        article.get("view_count", 0),
        article.get("like_count", 0),
        article.get("bookmark_count", 0),
        article.get("quality_score"),
    ).run()


async def _upsert_keyword(d1, keyword: dict):
    """Upsert a keyword into D1 edge cache."""
    kw_id = keyword.get("_id") or keyword.get("id")
    if not kw_id:
        return

    await d1.prepare("""
        INSERT OR REPLACE INTO keywords (id, name, article_count, usage_count, relevance_score, enabled)
        VALUES (?, ?, ?, ?, ?, ?)
    """).bind(
        str(kw_id),
        keyword.get("name", ""),
        keyword.get("article_count", 0),
        keyword.get("usage_count", 0),
        keyword.get("relevance_score", 0.0),
        1 if keyword.get("enabled", True) else 0,
    ).run()


async def _upsert_category(d1, category: dict):
    """Upsert a category into D1 edge cache."""
    cat_id = category.get("_id") or category.get("id")
    if not cat_id:
        return

    await d1.prepare("""
        INSERT OR REPLACE INTO categories (id, name, emoji, description, enabled, color)
        VALUES (?, ?, ?, ?, ?, ?)
    """).bind(
        str(cat_id),
        category.get("name", ""),
        category.get("emoji", ""),
        category.get("description", ""),
        1 if category.get("enabled", True) else 0,
        category.get("color", ""),
    ).run()

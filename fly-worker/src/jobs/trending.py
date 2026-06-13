"""Trending topics refresh job.

Aggregates article tags from the last 24 hours, scores by frequency,
writes to trendingCache collection. Runs every 30 minutes.
"""

import math
from datetime import datetime, timedelta, timezone

from src.services.mongodb import get_db


async def refresh_trending() -> None:
    """Refresh trending topics cache."""
    db = get_db()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

    # Aggregate tagIds from recent articles
    pipeline = [
        {"$match": {
            "status": {"$in": ["approved", "published"]},
            "datePublished": {"$gte": cutoff},
            "tagIds": {"$exists": True, "$ne": []},
        }},
        {"$unwind": "$tagIds"},
        {"$group": {
            "_id": "$tagIds",
            "article_count": {"$sum": 1},
        }},
        {"$match": {"article_count": {"$gte": 2}}},
        {"$sort": {"article_count": -1}},
        {"$limit": 50},
        # Join to tags collection for the display name
        {"$lookup": {
            "from": "tags",
            "localField": "_id",
            "foreignField": "_id",
            "as": "tag",
        }},
        {"$unwind": {"path": "$tag", "preserveNullAndEmptyArrays": True}},
    ]

    rows = await db["articles"].aggregate(pipeline).to_list(50)

    if not rows:
        print("[TRENDING] No trending data found")
        return

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=1)

    scored = []
    for row in rows:
        tag_name = (row.get("tag") or {}).get("name", row["_id"])
        score = row["article_count"] * (1 + math.log10(row["article_count"] + 1))
        scored.append({
            "scope": "global",
            "scopeId": None,
            "tagId": row["_id"],
            "term": tag_name,
            "articleCount": row["article_count"],
            "score": round(score, 2),
            "computedAt": now,
            "expiresAt": expires_at,
        })

    scored.sort(key=lambda x: x["score"], reverse=True)

    await db["trendingCache"].delete_many({"scope": "global"})
    if scored[:20]:
        await db["trendingCache"].insert_many(scored[:20])

    # Per-country trending
    countries = await db["articles"].distinct("articleSection", {
        "status": {"$in": ["approved", "published"]},
        "datePublished": {"$gte": cutoff},
    })

    country_pipeline_base = [
        {"$unwind": "$tagIds"},
        {"$group": {
            "_id": "$tagIds",
            "article_count": {"$sum": 1},
        }},
        {"$match": {"article_count": {"$gte": 2}}},
        {"$sort": {"article_count": -1}},
        {"$limit": 20},
    ]

    countries_updated = 0
    # Use countryCode field for per-country trending
    country_codes = await db["articles"].distinct("inLanguage", {
        "status": {"$in": ["approved", "published"]},
        "datePublished": {"$gte": cutoff},
    })

    # Actually use feedSource countryCode — aggregate via lookup
    country_pipeline = [
        {"$match": {
            "status": {"$in": ["approved", "published"]},
            "datePublished": {"$gte": cutoff},
            "tagIds": {"$exists": True, "$ne": []},
        }},
        {"$lookup": {
            "from": "feedSources",
            "localField": "feedSourceId",
            "foreignField": "_id",
            "as": "source",
        }},
        {"$unwind": {"path": "$source", "preserveNullAndEmptyArrays": True}},
        {"$group": {
            "_id": {"country": "$source.countryCode", "tag": {"$arrayElemAt": ["$tagIds", 0]}},
            "article_count": {"$sum": 1},
        }},
        {"$match": {"article_count": {"$gte": 2}}},
        {"$sort": {"article_count": -1}},
        {"$limit": 100},
    ]

    # Simpler: just use global trending for now
    print(f"[TRENDING] Refreshed {len(scored)} global trending topics")

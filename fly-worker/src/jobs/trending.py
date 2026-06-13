"""Trending topics refresh job.

Aggregates article keywords from the last 24 hours, scores them by
frequency and engagement, writes to trending_cache collection.
"""

import math
from datetime import datetime, timedelta, timezone

from src.services.mongodb import get_db


async def refresh_trending() -> None:
    """Refresh trending topics cache. Runs every 30 minutes."""
    db = get_db()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

    pipeline = [
        {"$match": {
            "status": "published",
            "date_published": {"$gte": cutoff},
            "keywords": {"$exists": True, "$ne": []},
        }},
        {"$unwind": "$keywords"},
        {"$group": {
            "_id": "$keywords",
            "article_count": {"$sum": 1},
            "total_views": {"$sum": "$engagement.views"},
            "total_likes": {"$sum": "$engagement.likes"},
            "total_bookmarks": {"$sum": "$engagement.bookmarks"},
        }},
        {"$match": {"article_count": {"$gte": 2}}},
        {"$sort": {"article_count": -1}},
        {"$limit": 50},
    ]

    rows = await db["articles"].aggregate(pipeline).to_list(50)

    if not rows:
        print("[TRENDING] No trending data found")
        return

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=1)

    scored = []
    for row in rows:
        engagement = (
            row["total_views"]
            + row["total_likes"] * 3
            + row["total_bookmarks"] * 2
            + 1
        )
        score = row["article_count"] * (1 + math.log10(engagement))
        scored.append({
            "scope": "global",
            "scope_id": None,
            "term": row["_id"],
            "article_count": row["article_count"],
            "score": round(score, 2),
            "computed_at": now,
            "expires_at": expires_at,
        })

    scored.sort(key=lambda x: x["score"], reverse=True)

    await db["trending_cache"].delete_many({"scope": "global"})
    if scored[:20]:
        await db["trending_cache"].insert_many(scored[:20])

    # Per-country trending
    countries = await db["articles"].distinct("country", {
        "status": "published",
        "date_published": {"$gte": cutoff},
    })

    for country in countries:
        country_pipeline = [
            {"$match": {
                "status": "published",
                "date_published": {"$gte": cutoff},
                "country": country,
                "keywords": {"$exists": True, "$ne": []},
            }},
            {"$unwind": "$keywords"},
            {"$group": {
                "_id": "$keywords",
                "article_count": {"$sum": 1},
                "total_views": {"$sum": "$engagement.views"},
                "total_likes": {"$sum": "$engagement.likes"},
            }},
            {"$match": {"article_count": {"$gte": 2}}},
            {"$sort": {"article_count": -1}},
            {"$limit": 20},
        ]

        country_rows = await db["articles"].aggregate(country_pipeline).to_list(20)
        if country_rows:
            await db["trending_cache"].delete_many({"scope": "country", "scope_id": country})
            await db["trending_cache"].insert_many([
                {
                    "scope": "country",
                    "scope_id": country,
                    "term": row["_id"],
                    "article_count": row["article_count"],
                    "score": round(row["article_count"] * (1 + math.log10(
                        row["total_views"] + row["total_likes"] * 3 + 1
                    )), 2),
                    "computed_at": now,
                    "expires_at": expires_at,
                }
                for row in country_rows
            ])

    print(f"[TRENDING] Refreshed {len(scored)} global + {len(countries)} country scopes")

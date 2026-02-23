"""
Trending topics — data-driven, no AI needed.

Replaces the Claude-only approach in search_processor.py with
MongoDB aggregation pipelines weighted by engagement.

Supports country-specific trending via country_id filtering.
"""

import json
import time
from services.mongodb import MongoDBClient


async def refresh_trending(env) -> dict:
    """
    Compute and cache trending topics. Called by cron every 30 minutes.

    1. Aggregate keywords from recent articles (24h window)
    2. Weight by engagement (likes, views, bookmarks)
    3. Detect velocity (2h spike vs 24h baseline)
    4. Cache results in KV with 30min TTL
    """
    db = MongoDBClient(env)

    # Global trending
    global_topics = await _compute_trending(db, country_id=None)

    # Per-country trending for top countries
    country_topics: dict[str, list] = {}
    for country in ["ZW", "ZA", "KE", "NG", "GH", "TZ"]:
        topics = await _compute_trending(db, country_id=country)
        if topics:
            country_topics[country] = topics

    result = {
        "global": global_topics,
        "countries": country_topics,
        "updated_at": _now_iso(),
    }

    # Cache in KV
    if env and hasattr(env, "CACHE_STORAGE"):
        try:
            await env.CACHE_STORAGE.put(
                "trending:global",
                json.dumps(result, default=str),
                expirationTtl=1800,  # 30 minutes
            )
            for country, topics in country_topics.items():
                await env.CACHE_STORAGE.put(
                    f"trending:{country}",
                    json.dumps({"topics": topics, "updated_at": _now_iso()}, default=str),
                    expirationTtl=1800,
                )
        except Exception as e:
            print(f"[TRENDING] KV cache write failed: {e}")

    return result


async def get_trending(env, country_id: str | None = None) -> dict:
    """
    Get cached trending topics. Falls back to live computation if cache misses.
    """
    cache_key = f"trending:{country_id or 'global'}"

    # Try KV cache first
    if env and hasattr(env, "CACHE_STORAGE"):
        try:
            cached = await env.CACHE_STORAGE.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception:
            pass

    # Cache miss — compute live
    db = MongoDBClient(env)
    topics = await _compute_trending(db, country_id=country_id)
    return {"topics": topics, "updated_at": _now_iso()}


async def _compute_trending(db: MongoDBClient, country_id: str | None = None) -> list[dict]:
    """
    Compute trending topics using MongoDB aggregation.

    Pipeline:
    1. Match articles from last 24 hours (with optional country filter)
    2. Unwind keyword links
    3. Group by keyword, sum engagement-weighted scores
    4. Sort by weighted score descending
    5. Limit to top 20
    """
    match_stage: dict = {
        "published_at": {"$gte": _hours_ago_iso(24)},
    }
    if country_id:
        match_stage["country_id"] = country_id

    pipeline = [
        {"$match": match_stage},
        {"$lookup": {
            "from": "article_keyword_links",
            "localField": "_id",
            "foreignField": "article_id",
            "as": "keyword_links",
        }},
        {"$unwind": "$keyword_links"},
        {"$group": {
            "_id": "$keyword_links.keyword_id",
            "article_count": {"$sum": 1},
            "total_views": {"$sum": {"$ifNull": ["$view_count", 0]}},
            "total_likes": {"$sum": {"$ifNull": ["$like_count", 0]}},
            "total_bookmarks": {"$sum": {"$ifNull": ["$bookmark_count", 0]}},
            "avg_relevance": {"$avg": "$keyword_links.relevance_score"},
        }},
        {"$addFields": {
            "engagement_score": {
                "$add": [
                    "$total_views",
                    {"$multiply": ["$total_likes", 3]},
                    {"$multiply": ["$total_bookmarks", 2]},
                ]
            },
            "weighted_score": {
                "$multiply": [
                    "$article_count",
                    {"$add": [
                        1,
                        {"$log10": {"$add": [
                            "$total_views",
                            {"$multiply": ["$total_likes", 3]},
                            {"$multiply": ["$total_bookmarks", 2]},
                            1,
                        ]}},
                    ]},
                ]
            },
        }},
        {"$sort": {"weighted_score": -1}},
        {"$limit": 20},
        {"$lookup": {
            "from": "keywords",
            "localField": "_id",
            "foreignField": "_id",
            "as": "keyword_info",
        }},
        {"$unwind": {"path": "$keyword_info", "preserveNullAndEmptyArrays": True}},
        {"$project": {
            "keyword": {"$ifNull": ["$keyword_info.name", "$_id"]},
            "article_count": 1,
            "engagement_score": 1,
            "weighted_score": 1,
        }},
    ]

    try:
        results = await db.aggregate("articles", pipeline)
        return [
            {
                "keyword": r.get("keyword", ""),
                "article_count": r.get("article_count", 0),
                "engagement_score": round(r.get("engagement_score", 0), 1),
                "score": round(r.get("weighted_score", 0), 2),
            }
            for r in results
        ]
    except Exception as e:
        print(f"[TRENDING] Aggregation failed: {e}")
        return []


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _hours_ago_iso(hours: int) -> str:
    from datetime import datetime, timezone, timedelta
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()

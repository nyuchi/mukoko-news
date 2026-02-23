"""
Analytics aggregation — MongoDB-powered insights for the frontend.

Provides:
  - Enhanced stats with MongoDB counts + growth rates
  - Trending categories with engagement-weighted scoring
  - Content insights (top performing articles, engagement velocity)

Called by the TS backend via ProcessingClient for frontend consumption.
"""

import re

from services.mongodb import MongoDBClient


async def get_enhanced_stats(env) -> dict:
    """
    Aggregate platform stats from MongoDB.

    Returns article counts, source health summary, and recent activity.
    """
    db = MongoDBClient(env)

    total_articles = await db.count("articles")
    active_sources = await db.count("sources", {"enabled": True})

    # Articles published in last 24h
    today_articles = await db.count("articles", {
        "published_at": {"$gte": _hours_ago_iso(24)},
    })

    # Articles published in last 7 days
    week_articles = await db.count("articles", {
        "published_at": {"$gte": _hours_ago_iso(168)},
    })

    # Category breakdown
    category_pipeline = [
        {"$group": {
            "_id": "$category_id",
            "count": {"$sum": 1},
        }},
        {"$sort": {"count": -1}},
        {"$limit": 20},
    ]
    categories = await db.aggregate("articles", category_pipeline)
    category_count = len(categories)

    return {
        "database": {
            "total_articles": total_articles,
            "active_sources": active_sources,
            "categories": category_count,
            "today_articles": today_articles,
            "week_articles": week_articles,
        },
        "source": "mongodb",
        "timestamp": _now_iso(),
    }


async def get_trending_categories(env, limit: int = 8) -> dict:
    """
    Compute trending categories with growth rate from MongoDB aggregation.

    Growth rate = (articles in last 24h) / (articles in 24h-48h window) - 1
    So a growth_rate of 0.5 means 50% more articles today vs yesterday.
    """
    db = MongoDBClient(env)

    now_24h = _hours_ago_iso(24)
    ago_48h = _hours_ago_iso(48)

    # Recent 24h articles by category
    recent_pipeline = [
        {"$match": {"published_at": {"$gte": now_24h}}},
        {"$group": {
            "_id": "$category_id",
            "article_count": {"$sum": 1},
            "total_views": {"$sum": {"$ifNull": ["$view_count", 0]}},
            "total_likes": {"$sum": {"$ifNull": ["$like_count", 0]}},
        }},
        {"$sort": {"article_count": -1}},
        {"$limit": limit * 2},  # Fetch extra to compute growth
    ]
    recent = await db.aggregate("articles", recent_pipeline)

    # Previous 24h (24-48h ago) for growth comparison
    prev_pipeline = [
        {"$match": {"published_at": {"$gte": ago_48h, "$lt": now_24h}}},
        {"$group": {
            "_id": "$category_id",
            "article_count": {"$sum": 1},
        }},
    ]
    previous = await db.aggregate("articles", prev_pipeline)
    prev_map = {r["_id"]: r["article_count"] for r in previous}

    trending = []
    for cat in recent[:limit]:
        cat_id = cat["_id"] or "uncategorized"
        count = cat["article_count"]
        prev_count = prev_map.get(cat_id, 0)

        # Growth rate: (today - yesterday) / max(yesterday, 1)
        growth = (count - prev_count) / max(prev_count, 1)

        trending.append({
            "id": cat_id,
            "name": _category_display_name(cat_id),
            "slug": cat_id,
            "article_count": count,
            "growth_rate": round(growth, 2),
            "engagement": cat.get("total_views", 0) + cat.get("total_likes", 0) * 3,
        })

    # Sort by engagement-weighted score (articles * engagement)
    trending.sort(key=lambda x: x["article_count"] * max(x["engagement"], 1), reverse=True)

    return {
        "success": True,
        "trending": trending[:limit],
        "source": "mongodb",
        "timestamp": _now_iso(),
    }


async def get_content_insights(env, country_id: str | None = None) -> dict:
    """
    Generate content insights from MongoDB aggregation.

    Returns:
    - Top performing articles (by engagement velocity)
    - Category momentum (which categories are accelerating)
    - Source productivity (articles per source in last 24h)
    """
    db = MongoDBClient(env)

    match_stage: dict = {"published_at": {"$gte": _hours_ago_iso(24)}}
    if country_id and re.fullmatch(r"[A-Z]{2}", country_id):
        match_stage["country_id"] = country_id

    # Top articles by engagement
    top_pipeline = [
        {"$match": match_stage},
        {"$addFields": {
            "engagement_score": {
                "$add": [
                    {"$ifNull": ["$view_count", 0]},
                    {"$multiply": [{"$ifNull": ["$like_count", 0]}, 3]},
                    {"$multiply": [{"$ifNull": ["$bookmark_count", 0]}, 2]},
                ]
            }
        }},
        {"$sort": {"engagement_score": -1}},
        {"$limit": 10},
        {"$project": {
            "title": 1,
            "source": 1,
            "category_id": 1,
            "country_id": 1,
            "engagement_score": 1,
            "view_count": 1,
            "like_count": 1,
            "published_at": 1,
        }},
    ]
    top_articles = await db.aggregate("articles", top_pipeline)

    # Source productivity
    source_pipeline = [
        {"$match": match_stage},
        {"$group": {
            "_id": "$source",
            "article_count": {"$sum": 1},
            "avg_engagement": {"$avg": {
                "$add": [
                    {"$ifNull": ["$view_count", 0]},
                    {"$multiply": [{"$ifNull": ["$like_count", 0]}, 3]},
                ]
            }},
        }},
        {"$sort": {"article_count": -1}},
        {"$limit": 15},
    ]
    sources = await db.aggregate("articles", source_pipeline)

    return {
        "top_articles": top_articles,
        "source_productivity": sources,
        "country_id": country_id,
        "source": "mongodb",
        "timestamp": _now_iso(),
    }


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

# Category display names — matches CategoryManager in TS
_CATEGORY_NAMES = {
    "politics": "Politics",
    "business": "Business",
    "technology": "Technology",
    "sports": "Sports",
    "entertainment": "Entertainment",
    "health": "Health",
    "science": "Science",
    "world": "World",
    "opinion": "Opinion",
    "lifestyle": "Lifestyle",
    "education": "Education",
    "environment": "Environment",
    "agriculture": "Agriculture",
    "mining": "Mining",
}


def _category_display_name(cat_id: str) -> str:
    return _CATEGORY_NAMES.get(cat_id, cat_id.replace("_", " ").title())


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _hours_ago_iso(hours: int) -> str:
    from datetime import datetime, timezone, timedelta
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()

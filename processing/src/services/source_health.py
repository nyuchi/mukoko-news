"""
Source health management — adaptive fetch intervals + quality scoring.

Goes beyond the TS SourceHealthService's simple consecutive_failures counter
by incorporating article quality, engagement data, and adaptive scheduling.
"""

from datetime import datetime, timezone
from services.mongodb import MongoDBClient


# Health thresholds (consecutive failures)
HEALTH_THRESHOLDS = {
    "healthy": 0,       # 0 failures
    "degraded": 1,      # 1-3 failures
    "failing": 4,       # 4-7 failures
    "critical": 8,      # 8+ failures
}

# Adaptive fetch intervals (minutes) based on health status
FETCH_INTERVALS = {
    "healthy": 15,
    "degraded": 30,
    "failing": 60,
    "critical": None,   # Skip fetching
}


def classify_health(consecutive_failures: int) -> str:
    """Classify source health based on consecutive failures."""
    if consecutive_failures >= HEALTH_THRESHOLDS["critical"]:
        return "critical"
    if consecutive_failures >= HEALTH_THRESHOLDS["failing"]:
        return "failing"
    if consecutive_failures >= HEALTH_THRESHOLDS["degraded"]:
        return "degraded"
    return "healthy"


def should_fetch(source: dict) -> bool:
    """Determine if a source should be fetched based on health and timing."""
    health = classify_health(source.get("consecutive_failures", 0))
    interval = FETCH_INTERVALS.get(health)

    if interval is None:
        return False  # Critical sources are skipped

    last_fetch = source.get("last_successful_fetch") or source.get("last_fetch_at")
    if not last_fetch:
        return True  # Never fetched — always fetch

    try:
        if isinstance(last_fetch, str):
            last = datetime.fromisoformat(last_fetch.replace("Z", "+00:00"))
        else:
            last = last_fetch
        now = datetime.now(timezone.utc)
        minutes_since = (now - last).total_seconds() / 60
        return minutes_since >= interval
    except (ValueError, TypeError):
        return True


async def check_source_health(env) -> dict:
    """
    Evaluate all sources and compute health + quality scores.

    Called by cron every 6 hours.
    """
    db = MongoDBClient(env)

    # Load all enabled sources
    sources = await db.find("rss_sources", {"enabled": True}, limit=500)
    if not sources:
        return {"sources": 0, "alerts": []}

    alerts: list[dict] = []
    updates: list[dict] = []

    for source in sources:
        source_id = source.get("_id") or source.get("id")
        failures = source.get("consecutive_failures", 0)
        health = classify_health(failures)
        prev_health = source.get("health_status", "healthy")

        # Compute source quality score from recent articles
        quality = await _compute_source_quality(db, source_id)

        update = {
            "health_status": health,
            "source_quality_score": quality["score"],
            "avg_article_quality": quality["avg_quality"],
            "avg_engagement": quality["avg_engagement"],
            "article_count_7d": quality["article_count"],
        }
        updates.append({"source_id": source_id, "update": update})

        # Alert if health degraded
        if health != prev_health and _health_rank(health) > _health_rank(prev_health):
            alerts.append({
                "source_id": source_id,
                "source_name": source.get("name", ""),
                "previous": prev_health,
                "current": health,
                "consecutive_failures": failures,
                "quality_score": quality["score"],
            })

    # Batch update sources in MongoDB
    for item in updates:
        await db.update_one(
            "rss_sources",
            {"_id": item["source_id"]},
            {"$set": item["update"]},
        )

    return {
        "sources": len(sources),
        "alerts": alerts,
        "healthy": sum(1 for s in sources if classify_health(s.get("consecutive_failures", 0)) == "healthy"),
        "degraded": sum(1 for s in sources if classify_health(s.get("consecutive_failures", 0)) == "degraded"),
        "failing": sum(1 for s in sources if classify_health(s.get("consecutive_failures", 0)) == "failing"),
        "critical": sum(1 for s in sources if classify_health(s.get("consecutive_failures", 0)) == "critical"),
    }


async def get_source_health_summary(env) -> dict:
    """Get health summary for all sources (used by /sources/health route)."""
    db = MongoDBClient(env)
    sources = await db.find(
        "rss_sources",
        {"enabled": True},
        projection={
            "name": 1, "url": 1, "country_id": 1,
            "health_status": 1, "consecutive_failures": 1,
            "source_quality_score": 1, "last_successful_fetch": 1,
        },
        sort={"health_status": 1, "source_quality_score": -1},
        limit=500,
    )
    return {"sources": sources}


async def _compute_source_quality(db: MongoDBClient, source_id) -> dict:
    """Compute quality metrics for a source from its recent articles."""
    pipeline = [
        {"$match": {
            "source_id": source_id,
            "published_at": {"$gte": {"$date": {"$subtract": ["$$NOW", 604800000]}}},
        }},
        {"$group": {
            "_id": None,
            "avg_quality": {"$avg": "$quality_score"},
            "avg_views": {"$avg": "$view_count"},
            "avg_likes": {"$avg": "$like_count"},
            "avg_bookmarks": {"$avg": "$bookmark_count"},
            "count": {"$sum": 1},
        }},
    ]

    try:
        results = await db.aggregate("articles", pipeline)
        if results:
            r = results[0]
            avg_quality = r.get("avg_quality", 0.5) or 0.5
            avg_engagement = (
                (r.get("avg_views", 0) or 0)
                + (r.get("avg_likes", 0) or 0) * 3
                + (r.get("avg_bookmarks", 0) or 0) * 2
            )
            count = r.get("count", 0)

            # Composite score: 60% quality + 30% engagement + 10% volume
            import math
            eng_score = min(math.log10(max(avg_engagement, 1) + 1) / 3, 1.0)
            vol_score = min(count / 50, 1.0)
            score = round(avg_quality * 0.6 + eng_score * 0.3 + vol_score * 0.1, 2)

            return {
                "score": score,
                "avg_quality": round(avg_quality, 2),
                "avg_engagement": round(avg_engagement, 1),
                "article_count": count,
            }
    except Exception as e:
        print(f"[SOURCE_HEALTH] Quality computation failed for {source_id}: {e}")

    return {"score": 0.5, "avg_quality": 0.5, "avg_engagement": 0.0, "article_count": 0}


def _health_rank(status: str) -> int:
    """Rank health status (higher = worse)."""
    return {"healthy": 0, "degraded": 1, "failing": 2, "critical": 3}.get(status, 0)

"""Source health check job.

Evaluates all enabled feed sources and classifies their health status.
Runs every 6 hours.
"""

from datetime import datetime, timedelta, timezone

from src.services.mongodb import get_db


async def check_source_health() -> None:
    """Evaluate and update health status for all enabled feed sources."""
    db = get_db()

    sources = await db["feed_sources"].find({"is_active": True}).to_list(None)
    if not sources:
        return

    updated = 0
    seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)

    for source in sources:
        failures = source.get("consecutive_failures", 0) or 0
        if failures == 0:
            new_status = "healthy"
        elif failures <= 3:
            new_status = "degraded"
        elif failures <= 7:
            new_status = "failing"
        else:
            new_status = "critical"

        last_success = source.get("last_successful_fetch_at")
        if last_success:
            hours_since = (datetime.now(timezone.utc) - last_success).total_seconds() / 3600
            if hours_since > 48 and new_status == "healthy":
                new_status = "degraded"

        quality_score = await _calc_source_quality(db, source.get("publisher_id", ""), seven_days_ago)

        await db["feed_sources"].update_one(
            {"_id": source["_id"]},
            {"$set": {
                "health_status": new_status,
                "quality_score": quality_score,
                "updated_at": datetime.now(timezone.utc),
            }},
        )
        updated += 1

    print(f"[HEALTH] Updated {updated}/{len(sources)} source health statuses")


async def _calc_source_quality(db, publisher_id: str, since: datetime) -> float:
    pipeline = [
        {"$match": {
            "publisher_id": publisher_id,
            "date_published": {"$gte": since},
            "status": "published",
        }},
        {"$group": {
            "_id": None,
            "article_count": {"$sum": 1},
            "avg_quality": {"$avg": "$quality_score"},
            "avg_engagement": {"$avg": "$engagement.score"},
        }},
    ]

    result = await db["articles"].aggregate(pipeline).to_list(1)
    if not result or result[0]["article_count"] == 0:
        return 0.0

    stats = result[0]
    quality = (stats.get("avg_quality") or 0) / 100.0
    engagement = min(1.0, (stats.get("avg_engagement") or 0) / 50.0)
    volume = min(1.0, stats["article_count"] / 50.0)

    return round((quality * 0.6 + engagement * 0.3 + volume * 0.1) * 100, 2)

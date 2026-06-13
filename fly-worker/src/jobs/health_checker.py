"""Source health check job.

Evaluates all enabled feed sources and updates their trust signals.
Runs every 6 hours.
"""

from datetime import datetime, timedelta, timezone

from src.services.mongodb import get_db


async def check_source_health() -> None:
    """Evaluate and update health status for all enabled feed sources."""
    db = get_db()

    sources = await db["feedSources"].find({"isActive": True}).to_list(None)
    if not sources:
        return

    updated = 0
    seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)

    for source in sources:
        # Consecutive failures tracked as pipeline extra field
        failures = source.get("consecutiveFailures", 0) or 0
        if failures == 0:
            health = "healthy"
        elif failures <= 3:
            health = "degraded"
        elif failures <= 7:
            health = "failing"
        else:
            health = "critical"

        last_success = source.get("lastFetchedAt")
        if last_success and health == "healthy":
            hours_since = (datetime.now(timezone.utc) - last_success).total_seconds() / 3600
            if hours_since > 48:
                health = "degraded"

        trust_score = await _calc_trust_score(db, source["_id"], seven_days_ago)

        await db["feedSources"].update_one(
            {"_id": source["_id"]},
            {"$set": {
                "trustScore": trust_score,
                "sourceHealth": health,
                "updatedAt": datetime.now(timezone.utc),
            }},
        )
        updated += 1

    print(f"[HEALTH] Updated {updated}/{len(sources)} source health statuses")


async def _calc_trust_score(db, feed_source_id: str, since: datetime) -> float:
    """Calculate trust score from recent article quality scores."""
    pipeline = [
        {"$match": {
            "feedSourceId": feed_source_id,
            "datePublished": {"$gte": since},
            "status": {"$in": ["approved", "published"]},
        }},
        {"$group": {
            "_id": None,
            "article_count": {"$sum": 1},
            "avg_quality": {"$avg": "$qualityScore"},
        }},
    ]

    result = await db["articles"].aggregate(pipeline).to_list(1)
    if not result or result[0]["article_count"] == 0:
        return 0.0

    stats = result[0]
    quality = (stats.get("avg_quality") or 0) / 100.0
    volume = min(1.0, stats["article_count"] / 50.0)

    return round((quality * 0.7 + volume * 0.3) * 100, 2)

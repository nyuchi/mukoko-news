"""Stale data cleanup job.

Removes archived articles older than 90 days, expired trending cache
entries, and old pipeline logs. Runs daily at 3:00 UTC.
"""

from datetime import datetime, timedelta, timezone

from src.services.mongodb import get_db


async def cleanup_stale_data() -> None:
    """Clean up stale data from MongoDB."""
    db = get_db()
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    log_cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    stats = {"archived": 0, "expired_cache": 0, "old_logs": 0}

    # Delete archived articles older than 90 days
    result = await db["articles"].delete_many({
        "status": "archived",
        "datePublished": {"$lt": cutoff},
    })
    stats["archived"] = result.deleted_count

    # Remove expired trending cache entries
    result = await db["trendingCache"].delete_many({
        "expiresAt": {"$lt": datetime.now(timezone.utc)},
    })
    stats["expired_cache"] = result.deleted_count

    # Clean old pipeline logs
    result = await db["pipelineLogs"].delete_many({
        "completedAt": {"$lt": log_cutoff},
    })
    stats["old_logs"] = result.deleted_count

    # Recalculate tag article counts
    tags = await db["tags"].find({}, {"_id": 1}).to_list(None)
    for tag in tags:
        count = await db["articles"].count_documents({
            "tagIds": tag["_id"],
            "status": {"$in": ["approved", "published"]},
        })
        await db["tags"].update_one(
            {"_id": tag["_id"]},
            {"$set": {"articleCount": count, "updatedAt": datetime.now(timezone.utc)}},
        )

    total = sum(stats.values())
    if total > 0:
        print(f"[CLEANUP] Removed: {stats}")
    else:
        print("[CLEANUP] Nothing to clean")

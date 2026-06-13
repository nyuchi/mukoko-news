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

    result = await db["articles"].delete_many({
        "status": "archived",
        "date_published": {"$lt": cutoff},
    })
    stats["archived"] = result.deleted_count

    result = await db["trending_cache"].delete_many({
        "expires_at": {"$lt": datetime.now(timezone.utc)},
    })
    stats["expired_cache"] = result.deleted_count

    result = await db["pipeline_logs"].delete_many({
        "completed_at": {"$lt": log_cutoff},
    })
    stats["old_logs"] = result.deleted_count

    # Recalculate keyword article counts
    keywords = await db["keywords"].find({}, {"_id": 1}).to_list(None)
    for kw in keywords:
        count = await db["articles"].count_documents({
            "keywords": kw["_id"],
            "status": "published",
        })
        await db["keywords"].update_one(
            {"_id": kw["_id"]},
            {"$set": {"article_count": count}},
        )

    total = sum(stats.values())
    if total > 0:
        print(f"[CLEANUP] Removed: {stats}")
    else:
        print("[CLEANUP] Nothing to clean")

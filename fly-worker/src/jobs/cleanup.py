"""Stale data cleanup job.

Removes archived articles older than 90 days, orphaned keyword links,
and expired trending cache entries.
Runs daily at 3:00 UTC.
"""

from datetime import datetime, timedelta, timezone

from src.db import get_pool


async def cleanup_stale_data() -> None:
    """Clean up stale data from the database."""
    pool = await get_pool()
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    stats = {"archived": 0, "orphaned_links": 0, "expired_cache": 0, "old_logs": 0}

    async with pool.acquire() as conn:
        # 1. Delete archived articles older than 90 days
        result = await conn.execute(
            """DELETE FROM articles
               WHERE status = 'archived'
                 AND date_published < $1""",
            cutoff,
        )
        stats["archived"] = _parse_count(result)

        # 2. Clean orphaned article_keywords (article deleted)
        result = await conn.execute(
            """DELETE FROM article_keywords
               WHERE article_id NOT IN (SELECT id FROM articles)"""
        )
        stats["orphaned_links"] = _parse_count(result)

        # 3. Clean orphaned article_authors
        await conn.execute(
            """DELETE FROM article_authors
               WHERE article_id NOT IN (SELECT id FROM articles)"""
        )

        # 4. Remove expired trending cache (backup for TTL)
        result = await conn.execute(
            "DELETE FROM trending_cache WHERE expires_at < NOW()"
        )
        stats["expired_cache"] = _parse_count(result)

        # 5. Clean old collection logs (keep 30 days)
        log_cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        result = await conn.execute(
            "DELETE FROM collection_log WHERE created_at < $1", log_cutoff
        )
        stats["old_logs"] = _parse_count(result)

        # 6. Clean old sync logs (keep 30 days)
        await conn.execute(
            "DELETE FROM sync_log WHERE created_at < $1", log_cutoff
        )

        # 7. Recalculate keyword article counts
        await conn.execute(
            """UPDATE defined_terms SET
               article_count = (
                   SELECT COUNT(*) FROM article_keywords
                   WHERE article_keywords.term_id = defined_terms.id
               )"""
        )

    total = sum(stats.values())
    if total > 0:
        print(f"[CLEANUP] Removed: {stats}")
    else:
        print("[CLEANUP] Nothing to clean")


def _parse_count(result: str) -> int:
    """Parse row count from asyncpg command result like 'DELETE 5'."""
    try:
        return int(result.split()[-1])
    except (ValueError, IndexError):
        return 0

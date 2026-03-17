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
            """DELETE FROM news.news_article
               WHERE status = 'archived'
                 AND datepublished < $1""",
            cutoff,
        )
        stats["archived"] = _parse_count(result)

        # 2. Clean orphaned article_keywords (article deleted)
        result = await conn.execute(
            """DELETE FROM news.article_keyword
               WHERE article_id NOT IN (SELECT id FROM news.news_article)"""
        )
        stats["orphaned_links"] = _parse_count(result)

        # 3. Clean orphaned article_authorships
        await conn.execute(
            """DELETE FROM news.article_authorship
               WHERE article_id NOT IN (SELECT id FROM news.news_article)"""
        )

        # 4. Remove expired trending cache (backup for TTL)
        result = await conn.execute(
            "DELETE FROM news.trending_cache WHERE expires_at < NOW()"
        )
        stats["expired_cache"] = _parse_count(result)

        # 5. Clean old collection logs (keep 30 days)
        log_cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        result = await conn.execute(
            "DELETE FROM system.collection_log WHERE created_at < $1", log_cutoff
        )
        stats["old_logs"] = _parse_count(result)

        # 6. Clean old sync logs (keep 30 days)
        await conn.execute(
            "DELETE FROM sync.sync_log WHERE created_at < $1", log_cutoff
        )

        # 7. Recalculate keyword article counts
        await conn.execute(
            """UPDATE news.defined_term SET
               article_count = (
                   SELECT COUNT(*) FROM news.article_keyword
                   WHERE news.article_keyword.term_id = news.defined_term.id
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

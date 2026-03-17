"""Source health check job.

Evaluates all enabled feed sources and classifies their health status.
Runs every 6 hours.
"""

from datetime import datetime, timedelta, timezone

from src.db import get_pool


async def check_source_health() -> None:
    """Evaluate and update health status for all enabled feed sources."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        sources = await conn.fetch(
            """SELECT id, organization_id, consecutive_failures, total_fetch_count,
                      total_error_count, last_successful_fetch_at,
                      last_fetched_at, health_status
               FROM news.feed_source
               WHERE is_active = TRUE"""
        )

    if not sources:
        return

    updated = 0
    seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)

    async with pool.acquire() as conn:
        for source in sources:
            s = dict(source)

            # Determine health status
            failures = s.get("consecutive_failures", 0) or 0
            if failures == 0:
                new_status = "healthy"
            elif failures <= 3:
                new_status = "degraded"
            elif failures <= 7:
                new_status = "failing"
            else:
                new_status = "critical"

            # Check staleness — no successful fetch in 48h
            last_success = s.get("last_successful_fetch_at")
            if last_success:
                hours_since = (datetime.now(timezone.utc) - last_success).total_seconds() / 3600
                if hours_since > 48 and new_status == "healthy":
                    new_status = "degraded"

            # Calculate quality score from recent articles
            quality_score = await _calc_source_quality(conn, s["organization_id"], seven_days_ago)

            # Only update if something changed
            if new_status != s.get("health_status") or True:
                await conn.execute(
                    """UPDATE news.feed_source SET
                       health_status = $2,
                       quality_score = $3,
                       updated_at = NOW()
                       WHERE id = $1""",
                    s["id"],
                    new_status,
                    quality_score,
                )
                updated += 1

    print(f"[HEALTH] Updated {updated}/{len(sources)} source health statuses")


async def _calc_source_quality(conn, organization_id, since: datetime) -> float:
    """Calculate source quality score from recent articles."""
    stats = await conn.fetchrow(
        """SELECT
             COUNT(*) AS article_count,
             AVG(quality_score) AS avg_quality,
             AVG(engagement_score) AS avg_engagement
           FROM news.news_article
           WHERE publisher_organization_id = $1
             AND datepublished >= $2
             AND status = 'published'""",
        organization_id,
        since,
    )

    if not stats or stats["article_count"] == 0:
        return 0.0

    # 60% quality + 30% engagement + 10% volume
    quality = (stats["avg_quality"] or 0) / 100.0  # Normalize to 0-1
    engagement = min(1.0, (stats["avg_engagement"] or 0) / 50.0)  # Cap at 1.0
    volume = min(1.0, stats["article_count"] / 50.0)  # 50 articles/week = 1.0

    score = quality * 0.6 + engagement * 0.3 + volume * 0.1
    return round(score * 100, 2)

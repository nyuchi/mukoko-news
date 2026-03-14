"""APScheduler job configuration.

All scheduled jobs for the Fly.io worker:
- RSS feed collection (every 15 min) — includes inline AI processing
- Engagement score recalculation (every 5 min)
- Trending topics refresh (every 30 min)
- Source health check (every 6 hours)
- Stale data cleanup (daily at 3:00 UTC)
- Database sync to D1 (every 10 min)
"""

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger


def create_scheduler() -> AsyncIOScheduler:
    """Create and configure the job scheduler."""
    scheduler = AsyncIOScheduler(timezone="UTC")

    # Import jobs lazily to avoid circular imports
    from src.jobs.rss_collector import collect_feeds
    from src.jobs.engagement import recalc_engagement_scores
    from src.jobs.trending import refresh_trending
    from src.jobs.health_checker import check_source_health
    from src.jobs.cleanup import cleanup_stale_data
    from src.jobs.sync import sync_to_d1

    # RSS collection + inline AI processing: every 15 minutes
    scheduler.add_job(
        collect_feeds,
        IntervalTrigger(minutes=15),
        id="rss_collector",
        name="RSS Feed Collection",
        max_instances=1,
    )

    # Engagement score recalculation: every 5 minutes
    scheduler.add_job(
        recalc_engagement_scores,
        IntervalTrigger(minutes=5),
        id="engagement",
        name="Engagement Score Recalc",
        max_instances=1,
    )

    # Trending topics: every 30 minutes
    scheduler.add_job(
        refresh_trending,
        IntervalTrigger(minutes=30),
        id="trending",
        name="Trending Topics Refresh",
        max_instances=1,
    )

    # Source health: every 6 hours
    scheduler.add_job(
        check_source_health,
        CronTrigger(hour="*/6"),
        id="health_checker",
        name="Source Health Check",
        max_instances=1,
    )

    # Cleanup: daily at 3:00 UTC
    scheduler.add_job(
        cleanup_stale_data,
        CronTrigger(hour=3, minute=0),
        id="cleanup",
        name="Stale Data Cleanup",
        max_instances=1,
    )

    # Sync to D1: every 10 minutes
    scheduler.add_job(
        sync_to_d1,
        IntervalTrigger(minutes=10),
        id="sync",
        name="Database Sync to D1",
        max_instances=1,
    )

    return scheduler

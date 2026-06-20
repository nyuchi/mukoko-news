"""APScheduler job configuration.

All scheduled jobs for the Fly.io pipeline:
- RSS feed collection (every 15 min) — includes inline AI processing
- Newsdata.io collection + source discovery (every 6 hours at :30)
- Engagement score recalculation (every 5 min)
- Trending topics refresh (every 30 min)
- Source health check (every 6 hours)
- Embedding backfill (every 10 min)
- Stale data cleanup (daily at 3:00 UTC)
- Organization bootstrap (daily at 4:00 UTC) — idempotent, fills missing org+entity docs
"""

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger


def create_scheduler() -> AsyncIOScheduler:
    """Create and configure the job scheduler."""
    scheduler = AsyncIOScheduler(timezone="UTC")

    from src.jobs.rss_collector import collect_feeds
    from src.jobs.newsdata_collector import collect_newsdata
    from src.jobs.engagement import recalc_engagement_scores
    from src.jobs.trending import refresh_trending
    from src.jobs.health_checker import check_source_health
    from src.jobs.cleanup import cleanup_stale_data
    from src.jobs.embedding_backfill import backfill_embeddings
    from src.jobs.organization_bootstrapper import bootstrap_organizations

    scheduler.add_job(
        collect_feeds,
        IntervalTrigger(minutes=15),
        id="rss_collector",
        name="RSS Feed Collection",
        max_instances=1,
    )

    scheduler.add_job(
        collect_newsdata,
        CronTrigger(hour="*/6", minute=30),
        id="newsdata_collector",
        name="Newsdata.io Collection + Source Discovery",
        max_instances=1,
    )

    scheduler.add_job(
        recalc_engagement_scores,
        IntervalTrigger(minutes=5),
        id="engagement",
        name="Engagement Score Recalc",
        max_instances=1,
    )

    scheduler.add_job(
        refresh_trending,
        IntervalTrigger(minutes=30),
        id="trending",
        name="Trending Topics Refresh",
        max_instances=1,
    )

    scheduler.add_job(
        check_source_health,
        CronTrigger(hour="*/6"),
        id="health_checker",
        name="Source Health Check",
        max_instances=1,
    )

    scheduler.add_job(
        backfill_embeddings,
        IntervalTrigger(minutes=10),
        id="embedding_backfill",
        name="Embedding Backfill (BGE-M3)",
        max_instances=1,
    )

    scheduler.add_job(
        cleanup_stale_data,
        CronTrigger(hour=3, minute=0),
        id="cleanup",
        name="Stale Data Cleanup",
        max_instances=1,
    )

    scheduler.add_job(
        bootstrap_organizations,
        CronTrigger(hour=4, minute=0),
        id="org_bootstrap",
        name="Organization Bootstrap",
        max_instances=1,
    )

    return scheduler

"""Engagement score recalculation job.

Polls for recently updated articles and recalculates engagement scores.
Replaces the Atlas trigger that fired on view/like/bookmark updates.
"""

import math
from datetime import datetime, timedelta, timezone

from src.db import get_pool


async def recalc_engagement_scores() -> None:
    """Recalculate engagement scores for recently updated articles."""
    pool = await get_pool()
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=6)

    async with pool.acquire() as conn:
        articles = await conn.fetch(
            """SELECT id, view_count, like_count, bookmark_count,
                      share_count, date_published, engagement_score
               FROM articles
               WHERE updated_at >= $1
                 AND status = 'published'
                 AND (view_count > 0 OR like_count > 0 OR bookmark_count > 0)""",
            cutoff,
        )

    if not articles:
        return

    updated = 0
    async with pool.acquire() as conn:
        for article in articles:
            new_score = _compute_score(dict(article))
            old_score = article["engagement_score"] or 0.0

            # Only update if score changed meaningfully
            if abs(new_score - old_score) > 0.01:
                await conn.execute(
                    """UPDATE articles SET
                       engagement_score = $2,
                       sync_status = 'pending'
                       WHERE id = $1""",
                    article["id"],
                    new_score,
                )
                updated += 1

    if updated:
        print(f"[ENGAGEMENT] Updated {updated}/{len(articles)} scores")


def _compute_score(article: dict) -> float:
    """Compute engagement score with time decay.

    Formula: raw_engagement * time_decay
    - raw = views*1 + likes*3 + bookmarks*5 + shares*2
    - decay = 1 / (1 + hours_since_published / 48)
    """
    views = article.get("view_count", 0) or 0
    likes = article.get("like_count", 0) or 0
    bookmarks = article.get("bookmark_count", 0) or 0
    shares = article.get("share_count", 0) or 0

    raw = views * 1 + likes * 3 + bookmarks * 5 + shares * 2

    # Time decay
    published = article.get("date_published")
    if published:
        if isinstance(published, str):
            published = datetime.fromisoformat(published)
        hours = (datetime.now(timezone.utc) - published).total_seconds() / 3600
        decay = 1.0 / (1.0 + hours / 48.0)
    else:
        decay = 0.5

    score = raw * decay

    # Log scale for very popular articles
    if score > 100:
        score = 100 + math.log10(score - 99) * 50

    return round(score, 2)

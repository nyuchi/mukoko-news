"""Engagement score recalculation job.

Polls for recently updated articles and recalculates engagement scores.
Runs every 5 minutes.
"""

import math
from datetime import datetime, timedelta, timezone

from src.services.mongodb import get_db


async def recalc_engagement_scores() -> None:
    """Recalculate engagement scores for recently updated articles."""
    db = get_db()
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=6)

    articles = await db["articles"].find({
        "updated_at": {"$gte": cutoff},
        "status": "published",
        "$or": [
            {"engagement.views": {"$gt": 0}},
            {"engagement.likes": {"$gt": 0}},
            {"engagement.bookmarks": {"$gt": 0}},
        ],
    }).to_list(None)

    if not articles:
        return

    updated = 0
    now = datetime.now(timezone.utc)

    for article in articles:
        new_score = _compute_score(article)
        old_score = (article.get("engagement") or {}).get("score", 0.0) or 0.0

        if abs(new_score - old_score) > 0.01:
            await db["articles"].update_one(
                {"_id": article["_id"]},
                {"$set": {
                    "engagement.score": new_score,
                    "sync_status": "pending_sync",
                    "updated_at": now,
                }},
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
    eng = article.get("engagement") or {}
    views = eng.get("views", 0) or 0
    likes = eng.get("likes", 0) or 0
    bookmarks = eng.get("bookmarks", 0) or 0
    shares = eng.get("shares", 0) or 0

    raw = views * 1 + likes * 3 + bookmarks * 5 + shares * 2

    published = article.get("date_published")
    if published:
        if isinstance(published, str):
            published = datetime.fromisoformat(published)
        hours = (datetime.now(timezone.utc) - published).total_seconds() / 3600
        decay = 1.0 / (1.0 + hours / 48.0)
    else:
        decay = 0.5

    score = raw * decay
    if score > 100:
        score = 100 + math.log10(score - 99) * 50

    return round(score, 2)

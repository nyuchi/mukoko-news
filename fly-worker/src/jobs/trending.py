"""Trending topics refresh job.

Aggregates article keywords from the last 24 hours, scores them by
frequency and engagement, writes to trending_cache.
"""

import math
from datetime import datetime, timedelta, timezone

from src.db import get_pool


async def refresh_trending() -> None:
    """Refresh trending topics cache. Runs every 30 minutes."""
    pool = await get_pool()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

    async with pool.acquire() as conn:
        # Aggregate keywords from recent articles
        rows = await conn.fetch(
            """SELECT
                 ak.term_id,
                 dt.name AS term_name,
                 COUNT(DISTINCT ak.article_id) AS article_count,
                 COALESCE(SUM(a.view_count), 0) AS total_views,
                 COALESCE(SUM(a.like_count), 0) AS total_likes,
                 COALESCE(SUM(a.bookmark_count), 0) AS total_bookmarks
               FROM news.article_keyword ak
               JOIN news.news_article a ON a.id = ak.article_id
               JOIN news.defined_term dt ON dt.id = ak.term_id
               WHERE a.datepublished >= $1
                 AND a.status = 'published'
               GROUP BY ak.term_id, dt.name
               HAVING COUNT(DISTINCT ak.article_id) >= 2
               ORDER BY COUNT(DISTINCT ak.article_id) DESC
               LIMIT 50""",
            cutoff,
        )

    if not rows:
        print("[TRENDING] No trending data found")
        return

    # Score and rank
    scored = []
    for row in rows:
        engagement = (
            row["total_views"]
            + row["total_likes"] * 3
            + row["total_bookmarks"] * 2
            + 1
        )
        score = row["article_count"] * (1 + math.log10(engagement))
        scored.append({
            "term_id": row["term_id"],
            "term_name": row["term_name"],
            "article_count": row["article_count"],
            "score": round(score, 2),
        })

    scored.sort(key=lambda x: x["score"], reverse=True)

    # Write global trending (top 20)
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Clear old global entries
            await conn.execute(
                "DELETE FROM news.trending_cache WHERE scope = 'global'"
            )

            for item in scored[:20]:
                await conn.execute(
                    """INSERT INTO news.trending_cache
                       (scope, term_id, term_name, article_count, score, computed_at, expires_at)
                       VALUES ('global', $1, $2, $3, $4, NOW(), NOW() + INTERVAL '1 hour')""",
                    item["term_id"],
                    item["term_name"],
                    item["article_count"],
                    item["score"],
                )

        # Per-country trending
        countries = await conn.fetch(
            "SELECT DISTINCT id FROM news.country WHERE enabled = TRUE"
        )

        for country in countries:
            country_id = country["id"]
            country_rows = await conn.fetch(
                """SELECT
                     ak.term_id,
                     dt.name AS term_name,
                     COUNT(DISTINCT ak.article_id) AS article_count,
                     COALESCE(SUM(a.view_count), 0) AS total_views,
                     COALESCE(SUM(a.like_count), 0) AS total_likes
                   FROM news.article_keyword ak
                   JOIN news.news_article a ON a.id = ak.article_id
                   JOIN news.defined_term dt ON dt.id = ak.term_id
                   WHERE a.datepublished >= $1
                     AND a.primary_location_country = $2
                     AND a.status = 'published'
                   GROUP BY ak.term_id, dt.name
                   HAVING COUNT(DISTINCT ak.article_id) >= 2
                   ORDER BY COUNT(DISTINCT ak.article_id) DESC
                   LIMIT 20""",
                cutoff,
                country_id,
            )

            if country_rows:
                async with conn.transaction():
                    await conn.execute(
                        "DELETE FROM news.trending_cache WHERE scope = 'country' AND scope_id = $1",
                        country_id,
                    )
                    for row in country_rows:
                        engagement = row["total_views"] + row["total_likes"] * 3 + 1
                        score = row["article_count"] * (1 + math.log10(engagement))
                        await conn.execute(
                            """INSERT INTO news.trending_cache
                               (scope, scope_id, term_id, term_name, article_count, score,
                                computed_at, expires_at)
                               VALUES ('country', $1, $2, $3, $4, $5, NOW(),
                                       NOW() + INTERVAL '1 hour')""",
                            country_id,
                            row["term_id"],
                            row["term_name"],
                            row["article_count"],
                            round(score, 2),
                        )

    print(f"[TRENDING] Refreshed {len(scored)} global + {len(countries)} country scopes")

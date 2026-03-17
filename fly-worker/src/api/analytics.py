"""Public analytics endpoints — /api/analytics/*.

Mukoko is an open data platform. All non-PII analytics are public.
Anyone can query article performance, source trends, and readership patterns.
Business intelligence is for the people, not locked behind admin.

Only PII-related data (individual user behavior) stays behind admin auth.
"""

import time
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from src.db import get_pool
from src.services.doris import get_doris
from src.services.analytics import get_analytics

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

# Simple in-memory cache: {key: (data, expires_at)}
_cache: dict[str, tuple[dict, float]] = {}
CACHE_TTL = 300  # 5 minutes


def _cache_get(key: str) -> dict | None:
    entry = _cache.get(key)
    if entry and entry[1] > time.time():
        return entry[0]
    return None


def _cache_set(key: str, data: dict) -> None:
    _cache[key] = (data, time.time() + CACHE_TTL)


def _period_to_interval(period: str) -> str:
    """Convert period param to SQL interval string."""
    mapping = {"24h": "1 day", "7d": "7 days", "30d": "30 days", "90d": "90 days"}
    return mapping.get(period, "7 days")


@router.get("/overview")
async def analytics_overview(
    period: str = Query("7d", regex="^(24h|7d|30d|90d)$"),
):
    """Platform-wide open stats. No auth required."""
    cache_key = f"overview:{period}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    pool = await get_pool()
    interval = _period_to_interval(period)

    async with pool.acquire() as conn:
        total_articles = await conn.fetchval(
            "SELECT COUNT(*) FROM news.news_article WHERE status = 'published'"
        )
        period_articles = await conn.fetchval(
            f"SELECT COUNT(*) FROM news.news_article WHERE status = 'published' AND datepublished >= NOW() - INTERVAL '{interval}'"
        )
        active_sources = await conn.fetchval(
            "SELECT COUNT(*) FROM news.feed_source WHERE is_active = TRUE"
        )
        countries = await conn.fetchval(
            "SELECT COUNT(DISTINCT primary_location_country) FROM news.news_article WHERE status = 'published'"
        )
        total_views = await conn.fetchval(
            "SELECT COALESCE(SUM(view_count), 0) FROM news.news_article WHERE status = 'published'"
        )
        total_likes = await conn.fetchval(
            "SELECT COALESCE(SUM(like_count), 0) FROM news.news_article WHERE status = 'published'"
        )

    result = {
        "data": {
            "total_articles": total_articles or 0,
            "period_articles": period_articles or 0,
            "active_sources": active_sources or 0,
            "countries_covered": countries or 0,
            "total_views": total_views or 0,
            "total_likes": total_likes or 0,
        },
        "period": period,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    _cache_set(cache_key, result)
    get_analytics().track_open_data_access("/api/analytics/overview")
    return result


@router.get("/articles/top")
async def top_articles(
    period: str = Query("7d", regex="^(24h|7d|30d|90d)$"),
    country: str | None = Query(None),
    category: str | None = Query(None),
    limit: int = Query(10, ge=1, le=50),
):
    """Top articles by engagement. Open data — no auth."""
    cache_key = f"top:{period}:{country}:{category}:{limit}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    pool = await get_pool()
    interval = _period_to_interval(period)

    conditions = [
        "a.status = 'published'",
        f"a.datepublished >= NOW() - INTERVAL '{interval}'",
    ]
    params: list = []
    idx = 1

    if country:
        conditions.append(f"a.primary_location_country = ${idx}")
        params.append(country)
        idx += 1
    if category and category != "all":
        conditions.append(f"a.articlesection = ${idx}")
        params.append(category)
        idx += 1

    where = " AND ".join(conditions)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""SELECT a.id::text, a.headline, a.slug,
                       a.articlesection AS category,
                       a.primary_location_country AS country,
                       a.view_count, a.like_count, a.bookmark_count,
                       a.share_count, a.engagement_score, a.quality_score,
                       a.datepublished,
                       org.name AS publisher_name
                FROM news.news_article a
                LEFT JOIN news.news_media_organization org
                    ON a.publisher_organization_id = org.id
                WHERE {where}
                ORDER BY a.engagement_score DESC
                LIMIT ${idx}""",
            *params,
            limit,
        )

    result = {
        "data": [dict(r) for r in rows],
        "period": period,
        "filters": {"country": country, "category": category},
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    _cache_set(cache_key, result)
    get_analytics().track_open_data_access("/api/analytics/articles/top")
    return result


@router.get("/articles/{article_id}/performance")
async def article_performance(
    article_id: str,
    period: str = Query("7d", regex="^(24h|7d|30d|90d)$"),
):
    """Single article engagement over time. Open data — no auth."""
    cache_key = f"article_perf:{article_id}:{period}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    # Try Doris first for time-series data
    doris = get_doris()
    time_series = []

    try:
        if await doris.ping():
            safe_id = article_id.replace("'", "\\'")
            rows = await doris.query(f"""
                SELECT event_date, SUM(views) AS views, SUM(likes) AS likes,
                       SUM(bookmarks) AS bookmarks, SUM(shares) AS shares
                FROM mukoko_analytics.article_metrics
                WHERE article_id = '{safe_id}'
                GROUP BY event_date
                ORDER BY event_date DESC
                LIMIT 90
            """)
            time_series = rows
    except Exception:
        pass

    # Always get current totals from Postgres
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT a.id::text, a.headline, a.view_count, a.like_count,
                      a.bookmark_count, a.share_count, a.engagement_score,
                      a.quality_score, a.datepublished,
                      org.name AS publisher_name
               FROM news.news_article a
               LEFT JOIN news.news_media_organization org
                   ON a.publisher_organization_id = org.id
               WHERE a.id = $1::uuid""",
            article_id,
        )

    if not row:
        return {"error": "Article not found"}, 404

    result = {
        "data": {
            "article": dict(row),
            "time_series": time_series,
        },
        "period": period,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    _cache_set(cache_key, result)
    get_analytics().track_open_data_access("/api/analytics/articles/performance")
    return result


@router.get("/sources")
async def source_analytics(
    period: str = Query("7d", regex="^(24h|7d|30d|90d)$"),
):
    """Source reliability and performance. Open data — no auth."""
    cache_key = f"sources:{period}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    pool = await get_pool()
    interval = _period_to_interval(period)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""SELECT org.id::text AS source_id, org.name,
                       fs.health_status, fs.consecutive_failures,
                       fs.total_fetch_count, fs.total_error_count,
                       COUNT(a.id) AS period_articles,
                       COALESCE(AVG(a.quality_score), 0) AS avg_quality,
                       COALESCE(SUM(a.view_count), 0) AS total_views,
                       COALESCE(SUM(a.like_count), 0) AS total_likes
                FROM news.feed_source fs
                JOIN news.news_media_organization org ON fs.organization_id = org.id
                LEFT JOIN news.news_article a
                    ON a.publisher_organization_id = org.id
                    AND a.status = 'published'
                    AND a.datepublished >= NOW() - INTERVAL '{interval}'
                WHERE fs.is_active = TRUE
                GROUP BY org.id, org.name, fs.health_status,
                         fs.consecutive_failures, fs.total_fetch_count, fs.total_error_count
                ORDER BY total_views DESC"""
        )

    result = {
        "data": [dict(r) for r in rows],
        "period": period,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    _cache_set(cache_key, result)
    get_analytics().track_open_data_access("/api/analytics/sources")
    return result


@router.get("/sources/{source_id}/performance")
async def source_performance(
    source_id: str,
    period: str = Query("30d", regex="^(24h|7d|30d|90d)$"),
):
    """Single source performance history. Open data — no auth."""
    cache_key = f"source_perf:{source_id}:{period}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    pool = await get_pool()
    interval = _period_to_interval(period)

    async with pool.acquire() as conn:
        source = await conn.fetchrow(
            """SELECT org.id::text, org.name, org.url,
                      fs.health_status, fs.total_fetch_count, fs.total_error_count
               FROM news.feed_source fs
               JOIN news.news_media_organization org ON fs.organization_id = org.id
               WHERE org.id::text = $1 OR fs.id::text = $1""",
            source_id,
        )
        if not source:
            return {"error": "Source not found"}, 404

        daily_stats = await conn.fetch(
            f"""SELECT DATE(a.datepublished) AS date,
                       COUNT(*) AS articles,
                       COALESCE(AVG(a.quality_score), 0) AS avg_quality,
                       COALESCE(SUM(a.view_count), 0) AS views,
                       COALESCE(SUM(a.like_count), 0) AS likes
                FROM news.news_article a
                WHERE a.publisher_organization_id::text = $1
                  AND a.status = 'published'
                  AND a.datepublished >= NOW() - INTERVAL '{interval}'
                GROUP BY DATE(a.datepublished)
                ORDER BY date DESC""",
            source_id,
        )

    result = {
        "data": {
            "source": dict(source),
            "daily": [dict(r) for r in daily_stats],
        },
        "period": period,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    _cache_set(cache_key, result)
    get_analytics().track_open_data_access("/api/analytics/sources/performance")
    return result


@router.get("/geo")
async def geo_analytics(
    period: str = Query("7d", regex="^(24h|7d|30d|90d)$"),
):
    """Geographic readership distribution. Open data — no auth."""
    cache_key = f"geo:{period}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    pool = await get_pool()
    interval = _period_to_interval(period)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""SELECT a.primary_location_country AS country,
                       c.name AS country_name,
                       c.flag_emoji,
                       COUNT(a.id) AS article_count,
                       COALESCE(SUM(a.view_count), 0) AS total_views,
                       COALESCE(SUM(a.like_count), 0) AS total_likes,
                       COALESCE(AVG(a.engagement_score), 0) AS avg_engagement
                FROM news.news_article a
                LEFT JOIN news.country c ON c.id = a.primary_location_country
                WHERE a.status = 'published'
                  AND a.datepublished >= NOW() - INTERVAL '{interval}'
                GROUP BY a.primary_location_country, c.name, c.flag_emoji
                ORDER BY article_count DESC"""
        )

    result = {
        "data": [dict(r) for r in rows],
        "period": period,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    _cache_set(cache_key, result)
    get_analytics().track_open_data_access("/api/analytics/geo")
    return result


@router.get("/categories")
async def category_analytics(
    period: str = Query("7d", regex="^(24h|7d|30d|90d)$"),
):
    """Category performance. Open data — no auth."""
    cache_key = f"categories:{period}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    pool = await get_pool()
    interval = _period_to_interval(period)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""SELECT ic.name AS category, ic.slug, ic.emoji,
                       COUNT(a.id) AS article_count,
                       COALESCE(SUM(a.view_count), 0) AS total_views,
                       COALESCE(SUM(a.like_count), 0) AS total_likes,
                       COALESCE(AVG(a.engagement_score), 0) AS avg_engagement,
                       COALESCE(AVG(a.quality_score), 0) AS avg_quality
                FROM news.news_article a
                JOIN engagement.interest_category ic ON a.primary_interest_category_id = ic.id
                WHERE a.status = 'published'
                  AND a.datepublished >= NOW() - INTERVAL '{interval}'
                GROUP BY ic.name, ic.slug, ic.emoji
                ORDER BY article_count DESC"""
        )

    result = {
        "data": [dict(r) for r in rows],
        "period": period,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    _cache_set(cache_key, result)
    get_analytics().track_open_data_access("/api/analytics/categories")
    return result


@router.get("/trending")
async def trending_analytics(
    period: str = Query("24h", regex="^(24h|7d|30d|90d)$"),
    country: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
):
    """Trending topics with scores. Open data — no auth."""
    cache_key = f"trending:{period}:{country}:{limit}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    pool = await get_pool()

    async with pool.acquire() as conn:
        scope = "global"
        params: list = [limit]
        country_filter = ""

        if country:
            scope = country
            country_filter = "AND scope = $2"
            params.append(country)

        rows = await conn.fetch(
            f"""SELECT term_id AS id, term_name AS name, score,
                       article_count, scope AS country
                FROM news.trending_cache
                WHERE scope = '{scope}'
                  AND expires_at > NOW()
                  {country_filter}
                ORDER BY score DESC
                LIMIT $1""",
            *params,
        )

    result = {
        "data": [dict(r) for r in rows],
        "period": period,
        "filters": {"country": country},
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    _cache_set(cache_key, result)
    get_analytics().track_open_data_access("/api/analytics/trending")
    return result

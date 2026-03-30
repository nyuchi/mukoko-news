"""Source endpoints — /api/sources, /api/countries."""

from fastapi import APIRouter, Depends, Query

from src.db import get_pool
from src.api.auth import require_auth, AuthUser

router = APIRouter(prefix="/api", tags=["sources"])


@router.get("/sources")
async def get_sources(
    _user: AuthUser = Depends(require_auth),
):
    """Get all enabled news sources with article counts."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT org.id::text, org.name, org.url,
                      fs.feed_url AS rss_feed_url, fs.area_served,
                      fs.article_section_id, fs.health_status, fs.priority,
                      fs.last_fetched_at, fs.total_fetch_count, fs.total_error_count,
                      fs.last_fetch_error,
                      COUNT(a.id) AS article_count,
                      MAX(a.datepublished) AS latest_article_at
               FROM news.feed_source fs
               JOIN news.news_media_organization org ON fs.organization_id = org.id
               LEFT JOIN news.news_article a ON a.publisher_organization_id = org.id AND a.status = 'published'
               WHERE fs.is_active = TRUE
               GROUP BY org.id, org.name, org.url,
                        fs.feed_url, fs.area_served, fs.article_section_id,
                        fs.health_status, fs.priority, fs.last_fetched_at,
                        fs.total_fetch_count, fs.total_error_count, fs.last_fetch_error
               ORDER BY fs.priority DESC, org.name"""
        )

    sources = []
    for r in rows:
        sources.append({
            "id": r["id"],
            "name": r["name"],
            "url": r.get("url"),
            "rss_feed_url": r.get("rss_feed_url"),
            "area_served": r.get("area_served"),
            "article_section_id": r.get("article_section_id"),
            "health_status": r.get("health_status", "unknown"),
            "priority": r.get("priority", 0),
            "last_fetched_at": r["last_fetched_at"].isoformat() if r.get("last_fetched_at") else None,
            "total_fetch_count": r.get("total_fetch_count", 0),
            "total_error_count": r.get("total_error_count", 0),
            "last_error": r.get("last_fetch_error"),
            "article_count": r["article_count"],
            "latest_article_at": r["latest_article_at"].isoformat() if r.get("latest_article_at") else None,
        })

    return {"sources": sources, "total": len(sources)}


@router.get("/countries")
async def get_countries(
    _user: AuthUser = Depends(require_auth),
):
    """Get all enabled countries."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, name, flag_emoji, color, region, in_language, timezone, priority
               FROM news.country
               WHERE enabled = TRUE
               ORDER BY priority DESC, name"""
        )

    countries = [
        {
            "id": r["id"],
            "code": r["id"],
            "name": r["name"],
            "flag_emoji": r.get("flag_emoji"),
            "color": r.get("color"),
            "region": r.get("region"),
            "in_language": r.get("in_language"),
            "timezone": r.get("timezone"),
        }
        for r in rows
    ]

    return {"countries": countries}


@router.get("/countries/{country_id}")
async def get_country(
    country_id: str,
    _user: AuthUser = Depends(require_auth),
):
    """Get a single country."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM news.country WHERE id = $1", country_id
        )

    if not row:
        return {"error": "Country not found"}, 404

    return {
        "country": {
            "id": row["id"],
            "code": row["id"],
            "name": row["name"],
            "flag_emoji": row.get("flag_emoji"),
        }
    }


@router.get("/countries/stats/articles")
async def get_country_article_stats(
    _user: AuthUser = Depends(require_auth),
):
    """Get article counts per country."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT primary_location_country AS country_id, COUNT(*) AS article_count
               FROM news.news_article
               WHERE status = 'published'
               GROUP BY primary_location_country
               ORDER BY article_count DESC"""
        )

    return {"stats": [dict(r) for r in rows]}

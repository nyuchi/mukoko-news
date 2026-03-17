"""Admin API endpoints — /api/admin/*.

Protected by admin auth (session token or admin API key).
"""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Body, Header

from src.db import get_pool
from src.config import settings

router = APIRouter(prefix="/api/admin", tags=["admin"])


async def require_admin(authorization: str = Header(default="")) -> str:
    """Validate admin access via session token or admin secret."""
    admin_secret = settings.admin_session_secret
    if not admin_secret:
        raise HTTPException(status_code=500, detail="Admin auth not configured")

    token = ""
    if authorization:
        parts = authorization.split(" ", 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1]

    if not token or token != admin_secret:
        raise HTTPException(status_code=401, detail="Admin access required")

    return token


@router.get("/stats")
async def admin_stats(_admin: str = Depends(require_admin)):
    """Get admin dashboard statistics."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        total_articles = await conn.fetchval("SELECT COUNT(*) FROM news.news_article")
        published = await conn.fetchval("SELECT COUNT(*) FROM news.news_article WHERE status = 'published'")
        sources = await conn.fetchval("SELECT COUNT(*) FROM news.feed_source")
        enabled_sources = await conn.fetchval("SELECT COUNT(*) FROM news.feed_source WHERE is_active = TRUE")
        categories = await conn.fetchval("SELECT COUNT(*) FROM engagement.interest_category WHERE is_active = TRUE")
        today = await conn.fetchval(
            "SELECT COUNT(*) FROM news.news_article WHERE ingested_at >= CURRENT_DATE"
        )

    return {
        "stats": {
            "total_articles": total_articles or 0,
            "published_articles": published or 0,
            "total_sources": sources or 0,
            "enabled_sources": enabled_sources or 0,
            "categories": categories or 0,
            "today_articles": today or 0,
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/sources")
async def admin_sources(
    _admin: str = Depends(require_admin),
):
    """Get all sources with health info for admin."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT fs.id::text AS feed_source_id,
                      org.id::text AS id, org.name, org.url,
                      fs.feed_url, fs.area_served, fs.article_section_id,
                      fs.is_active, fs.priority, fs.health_status,
                      fs.consecutive_failures, fs.last_fetch_error, fs.last_error_at,
                      fs.last_fetched_at, fs.total_fetch_count, fs.total_error_count,
                      COUNT(a.id) AS article_count,
                      MAX(a.datepublished) AS latest_article_at
               FROM news.feed_source fs
               JOIN news.news_media_organization org ON fs.organization_id = org.id
               LEFT JOIN news.news_article a ON a.publisher_organization_id = org.id
               GROUP BY fs.id, org.id, org.name, org.url,
                        fs.feed_url, fs.area_served, fs.article_section_id,
                        fs.is_active, fs.priority, fs.health_status,
                        fs.consecutive_failures, fs.last_fetch_error, fs.last_error_at,
                        fs.last_fetched_at, fs.total_fetch_count, fs.total_error_count
               ORDER BY fs.priority DESC, org.name"""
        )

    return {"sources": [dict(r) for r in rows]}


@router.get("/sources/{source_id}")
async def admin_source_detail(
    source_id: str = Path(...),
    _admin: str = Depends(require_admin),
):
    """Get detailed source info."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT fs.id::text AS feed_source_id,
                      org.id::text AS id, org.name, org.url,
                      fs.feed_url, fs.area_served, fs.article_section_id,
                      fs.is_active, fs.priority, fs.health_status,
                      fs.consecutive_failures, fs.last_fetch_error, fs.last_error_at,
                      fs.last_fetched_at, fs.total_fetch_count, fs.total_error_count
               FROM news.feed_source fs
               JOIN news.news_media_organization org ON fs.organization_id = org.id
               WHERE org.id::text = $1 OR fs.id::text = $1""",
            source_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Source not found")

        article_count = await conn.fetchval(
            "SELECT COUNT(*) FROM news.news_article WHERE publisher_organization_id::text = $1",
            source_id,
        )

    source = dict(row)
    source["article_count"] = article_count

    return {"source": source}


@router.put("/rss-source/{source_id}")
async def update_rss_source(
    source_id: str = Path(...),
    body: dict = Body(...),
    _admin: str = Depends(require_admin),
):
    """Update an RSS source configuration."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT fs.id FROM news.feed_source fs WHERE fs.id::text = $1", source_id
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Source not found")

        # Fields on feed_source
        fs_updates = []
        fs_params = []
        idx = 1

        for field in ["feed_url", "area_served", "article_section_id",
                       "is_active", "priority"]:
            if field in body:
                fs_updates.append(f"{field} = ${idx}")
                fs_params.append(body[field])
                idx += 1

        if fs_updates:
            fs_updates.append("updated_at = NOW()")
            fs_params.append(source_id)
            await conn.execute(
                f"UPDATE news.feed_source SET {', '.join(fs_updates)} WHERE id::text = ${idx}",
                *fs_params,
            )

        # Fields on organization (via feed_source join)
        org_updates = []
        org_params = []
        org_idx = 1

        for field in ["name", "url", "description"]:
            if field in body:
                org_updates.append(f"{field} = ${org_idx}")
                org_params.append(body[field])
                org_idx += 1

        if org_updates:
            org_updates.append("updated_at = NOW()")
            org_params.append(source_id)
            await conn.execute(
                f"""UPDATE news.news_media_organization SET {', '.join(org_updates)}
                    WHERE id = (SELECT organization_id FROM news.feed_source WHERE id::text = ${org_idx})""",
                *org_params,
            )

    return {"success": True, "message": "Source updated"}


@router.get("/sources/health")
async def admin_sources_health(_admin: str = Depends(require_admin)):
    """Get source health summary."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT health_status, COUNT(*) AS count
               FROM news.feed_source
               WHERE is_active = TRUE
               GROUP BY health_status"""
        )

        failing = await conn.fetch(
            """SELECT fs.id::text AS feed_source_id,
                      org.id::text AS id, org.name,
                      fs.health_status, fs.consecutive_failures,
                      fs.last_fetch_error, fs.last_error_at
               FROM news.feed_source fs
               JOIN news.news_media_organization org ON fs.organization_id = org.id
               WHERE fs.is_active = TRUE AND fs.consecutive_failures > 3
               ORDER BY fs.consecutive_failures DESC"""
        )

    return {
        "summary": {r["health_status"]: r["count"] for r in rows},
        "alerts": [dict(r) for r in failing],
    }


@router.get("/cron-logs")
async def admin_cron_logs(
    limit: int = Query(20, ge=1, le=100),
    _admin: str = Depends(require_admin),
):
    """Get recent cron execution logs."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT * FROM system.collection_log
               ORDER BY created_at DESC
               LIMIT $1""",
            limit,
        )

    return {"logs": [dict(r) for r in rows]}


@router.post("/feed/collect")
async def trigger_collection(_admin: str = Depends(require_admin)):
    """Manually trigger RSS feed collection."""
    from src.jobs.rss_collector import collect_feeds

    try:
        await collect_feeds()
        return {"success": True, "message": "Feed collection triggered"}
    except Exception as e:
        print(f"[ADMIN] Feed collection error: {e}")
        return {"success": False, "error": "Feed collection failed"}

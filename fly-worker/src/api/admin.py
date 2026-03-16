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
        total_articles = await conn.fetchval("SELECT COUNT(*) FROM articles")
        published = await conn.fetchval("SELECT COUNT(*) FROM articles WHERE status = 'published'")
        sources = await conn.fetchval("SELECT COUNT(*) FROM organizations")
        enabled_sources = await conn.fetchval("SELECT COUNT(*) FROM organizations WHERE enabled = TRUE")
        categories = await conn.fetchval("SELECT COUNT(*) FROM article_sections WHERE enabled = TRUE")
        today = await conn.fetchval(
            "SELECT COUNT(*) FROM articles WHERE date_created >= CURRENT_DATE"
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
            """SELECT o.*,
                      COUNT(a.id) AS article_count,
                      MAX(a.date_published) AS latest_article_at
               FROM organizations o
               LEFT JOIN articles a ON a.publisher_id = o.id
               GROUP BY o.id
               ORDER BY o.priority DESC, o.name"""
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
            "SELECT * FROM organizations WHERE id = $1", source_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Source not found")

        article_count = await conn.fetchval(
            "SELECT COUNT(*) FROM articles WHERE publisher_id = $1", source_id
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
            "SELECT id FROM organizations WHERE id = $1", source_id
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Source not found")

        updates = []
        params = []
        idx = 1

        for field in ["name", "url", "rss_feed_url", "area_served", "article_section_id",
                       "enabled", "priority", "description"]:
            if field in body:
                updates.append(f"{field} = ${idx}")
                params.append(body[field])
                idx += 1

        if not updates:
            return {"success": True, "message": "No changes"}

        updates.append("updated_at = NOW()")
        params.append(source_id)

        await conn.execute(
            f"UPDATE organizations SET {', '.join(updates)} WHERE id = ${idx}",
            *params,
        )

    return {"success": True, "message": "Source updated"}


@router.get("/sources/health")
async def admin_sources_health(_admin: str = Depends(require_admin)):
    """Get source health summary."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT health_status, COUNT(*) AS count
               FROM organizations
               WHERE enabled = TRUE
               GROUP BY health_status"""
        )

        failing = await conn.fetch(
            """SELECT id, name, health_status, consecutive_failures, last_error, last_error_at
               FROM organizations
               WHERE enabled = TRUE AND consecutive_failures > 3
               ORDER BY consecutive_failures DESC"""
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
            """SELECT * FROM collection_log
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
        return {"success": False, "error": str(e)}

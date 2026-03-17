"""Stats and health endpoints — /api/health, /api/stats."""

import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from src.db import get_pool
from src.api.auth import require_api_key

router = APIRouter(prefix="/api", tags=["stats"])


@router.get("/health")
async def health_check():
    """Public health check — no auth required."""
    pool = await get_pool()
    db_ok = False
    try:
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
            db_ok = True
    except Exception:
        pass

    return {
        "status": "healthy" if db_ok else "degraded",
        "database": "connected" if db_ok else "disconnected",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/stats")
async def get_stats(
    _token: str | None = Depends(require_api_key),
):
    """Get database statistics for dashboard."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        total_articles = await conn.fetchval(
            "SELECT COUNT(*) FROM news.news_article WHERE status = 'published'"
        )
        active_sources = await conn.fetchval(
            "SELECT COUNT(*) FROM news.feed_source WHERE enabled = TRUE"
        )
        categories = await conn.fetchval(
            "SELECT COUNT(*) FROM engagement.interest_category WHERE is_active = TRUE"
        )
        today_articles = await conn.fetchval(
            "SELECT COUNT(*) FROM news.news_article WHERE status = 'published' AND datepublished >= CURRENT_DATE"
        )

    return {
        "database": {
            "total_articles": total_articles or 0,
            "active_sources": active_sources or 0,
            "categories": categories or 0,
            "today_articles": today_articles or 0,
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

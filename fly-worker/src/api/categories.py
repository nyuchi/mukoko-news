"""Category endpoints — /api/categories, /api/trending-categories."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query

from src.db import get_pool
from src.api.auth import optional_auth, AuthUser

router = APIRouter(prefix="/api", tags=["categories"])


@router.get("/categories")
async def get_categories(
    _user: AuthUser | None = Depends(optional_auth),
):
    """Get all enabled categories (interest categories) with article counts."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT ic.id, ic.name, ic.description, ic.emoji, ic.color_hex AS color,
                      ic.sort_order,
                      COUNT(a.id) AS article_count
               FROM engagement.interest_category ic
               LEFT JOIN news.news_article a ON a.primary_interest_category_id = ic.id AND a.creativeworkstatus = 'published'
               WHERE ic.is_active = TRUE
               GROUP BY ic.id, ic.name, ic.description, ic.emoji, ic.color_hex, ic.sort_order
               ORDER BY ic.sort_order, ic.name"""
        )

    categories = [
        {
            "id": r["id"],
            "name": r["name"],
            "slug": r["id"],
            "description": r.get("description"),
            "emoji": r.get("emoji"),
            "color": r.get("color"),
            "article_count": r["article_count"],
        }
        for r in rows
    ]

    return {"categories": categories}


@router.get("/trending-categories")
async def get_trending_categories(
    limit: int = Query(8, ge=1, le=50),
    _user: AuthUser | None = Depends(optional_auth),
):
    """Get trending categories ranked by recent article volume and growth."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT ic.id, ic.name, ic.id AS slug,
                      COUNT(a.id) FILTER (WHERE a.datepublished >= NOW() - INTERVAL '7 days') AS article_count,
                      COUNT(a.id) FILTER (WHERE a.datepublished >= NOW() - INTERVAL '7 days') AS recent_count,
                      COUNT(a.id) FILTER (WHERE a.datepublished >= NOW() - INTERVAL '14 days'
                                            AND a.datepublished < NOW() - INTERVAL '7 days') AS prev_count
               FROM engagement.interest_category ic
               LEFT JOIN news.news_article a ON a.primary_interest_category_id = ic.id AND a.creativeworkstatus = 'published'
               WHERE ic.is_active = TRUE
               GROUP BY ic.id, ic.name
               HAVING COUNT(a.id) FILTER (WHERE a.datepublished >= NOW() - INTERVAL '7 days') > 0
               ORDER BY COUNT(a.id) FILTER (WHERE a.datepublished >= NOW() - INTERVAL '7 days') DESC
               LIMIT $1""",
            limit,
        )

    trending = []
    for r in rows:
        recent = r["recent_count"] or 0
        prev = r["prev_count"] or 0
        growth_rate = ((recent - prev) / max(prev, 1)) * 100 if prev > 0 else (100.0 if recent > 0 else 0.0)
        trending.append({
            "id": r["id"],
            "name": r["name"],
            "slug": r["slug"],
            "article_count": r["article_count"],
            "growth_rate": round(growth_rate, 1),
        })

    return {
        "success": True,
        "trending": trending,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

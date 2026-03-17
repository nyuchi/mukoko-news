"""Category endpoints — /api/categories."""

from fastapi import APIRouter, Depends

from src.db import get_pool
from src.api.auth import require_api_key

router = APIRouter(prefix="/api", tags=["categories"])


@router.get("/categories")
async def get_categories(
    _token: str | None = Depends(require_api_key),
):
    """Get all enabled categories (interest categories) with article counts."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT ic.id, ic.name, ic.description, ic.emoji, ic.color_hex AS color,
                      ic.sort_order,
                      COUNT(a.id) AS article_count
               FROM engagement.interest_category ic
               LEFT JOIN news.news_article a ON a.primary_interest_category_id = ic.id AND a.status = 'published'
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

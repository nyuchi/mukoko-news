"""Category endpoints — /api/categories."""

from fastapi import APIRouter, Depends

from src.db import get_pool
from src.api.auth import require_api_key

router = APIRouter(prefix="/api", tags=["categories"])


@router.get("/categories")
async def get_categories(
    _token: str | None = Depends(require_api_key),
):
    """Get all enabled categories (article sections) with article counts."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT s.id, s.name, s.description, s.emoji, s.color,
                      s.sort_order,
                      COUNT(a.id) AS article_count
               FROM article_sections s
               LEFT JOIN articles a ON a.article_section_id = s.id AND a.status = 'published'
               WHERE s.enabled = TRUE
               GROUP BY s.id, s.name, s.description, s.emoji, s.color, s.sort_order
               ORDER BY s.sort_order, s.name"""
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

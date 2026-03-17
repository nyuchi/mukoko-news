"""User engagement endpoints — like, save, view, comments."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Body

from src.db import get_pool
from src.api.auth import require_api_key
from src.services.analytics import get_analytics

router = APIRouter(prefix="/api", tags=["engagement"])


@router.post("/articles/{article_id}/like")
async def like_article(
    article_id: str = Path(...),
    _token: str | None = Depends(require_api_key),
):
    """Toggle like on an article. Increments/decrements like_count."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        # Check article exists
        exists = await conn.fetchval(
            "SELECT 1 FROM news.news_article WHERE id = $1::uuid", article_id
        )
        if not exists:
            raise HTTPException(status_code=404, detail="Article not found")

        # For anonymous users, just increment (no toggle)
        await conn.execute(
            "UPDATE news.news_article SET like_count = like_count + 1, updated_at = NOW() WHERE id = $1::uuid",
            article_id,
        )
        new_count = await conn.fetchval(
            "SELECT like_count FROM news.news_article WHERE id = $1::uuid", article_id
        )

    get_analytics().track_like(article_id)
    return {"success": True, "liked": True, "message": "Article liked", "likes": new_count}


@router.post("/articles/{article_id}/save")
async def save_article(
    article_id: str = Path(...),
    _token: str | None = Depends(require_api_key),
):
    """Toggle save/bookmark on an article."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        exists = await conn.fetchval(
            "SELECT 1 FROM news.news_article WHERE id = $1::uuid", article_id
        )
        if not exists:
            raise HTTPException(status_code=404, detail="Article not found")

        await conn.execute(
            "UPDATE news.news_article SET bookmark_count = bookmark_count + 1, updated_at = NOW() WHERE id = $1::uuid",
            article_id,
        )
        new_count = await conn.fetchval(
            "SELECT bookmark_count FROM news.news_article WHERE id = $1::uuid", article_id
        )

    get_analytics().track_save(article_id)
    return {"success": True, "saved": True, "message": "Article saved", "saves": new_count}


@router.post("/articles/{article_id}/view")
async def track_view(
    article_id: str = Path(...),
    body: dict = Body(default={}),
    _token: str | None = Depends(require_api_key),
):
    """Track article view with optional reading metrics."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE news.news_article SET view_count = view_count + 1, updated_at = NOW() WHERE id = $1::uuid",
            article_id,
        )
        views = await conn.fetchval(
            "SELECT view_count FROM news.news_article WHERE id = $1::uuid", article_id
        )

    get_analytics().track_view(article_id)
    return {"success": True, "views": views or 0}


@router.get("/articles/{article_id}/engagement")
async def get_engagement(
    article_id: str = Path(...),
    _token: str | None = Depends(require_api_key),
):
    """Get engagement counts for an article."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT like_count, bookmark_count, share_count, view_count
               FROM news.news_article WHERE id = $1::uuid""",
            article_id,
        )

    if not row:
        raise HTTPException(status_code=404, detail="Article not found")

    return {
        "likes": row["like_count"] or 0,
        "saves": row["bookmark_count"] or 0,
        "shares": row["share_count"] or 0,
        "views": row["view_count"] or 0,
    }

"""Author endpoints — /api/authors, /api/author/:slug."""

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from src.db import get_pool
from src.api.auth import require_api_key
from src.api.feeds import _row_to_article

router = APIRouter(prefix="/api", tags=["authors"])


@router.get("/authors")
async def get_authors(
    limit: int = Query(20, ge=1, le=100),
    _token: str | None = Depends(require_api_key),
):
    """Get authors sorted by article count."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, name, slug, description, job_title, works_for, image,
                      article_count, total_views, verification_status
               FROM persons
               WHERE article_count > 0
               ORDER BY article_count DESC
               LIMIT $1""",
            limit,
        )

    return {"authors": [dict(r) for r in rows]}


@router.get("/author/{slug}")
async def get_author(
    slug: str = Path(...),
    _token: str | None = Depends(require_api_key),
):
    """Get author profile and their articles."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        author = await conn.fetchrow(
            """SELECT id, name, slug, description, job_title, works_for, image,
                      article_count, total_views, verification_status
               FROM persons WHERE slug = $1 OR normalized_name = $1""",
            slug,
        )

        if not author:
            raise HTTPException(status_code=404, detail="Author not found")

        articles = await conn.fetch(
            """SELECT a.*, s.name AS section_name, s.emoji AS section_emoji, s.color AS section_color
               FROM articles a
               LEFT JOIN article_sections s ON a.article_section_id = s.id
               JOIN article_authors aa ON aa.article_id = a.id
               WHERE aa.person_id = $1
                 AND a.status = 'published'
               ORDER BY a.date_published DESC
               LIMIT 20""",
            author["id"],
        )

    return {
        "author": dict(author),
        "articles": [_row_to_article(r) for r in articles],
    }


@router.get("/search/authors")
async def search_authors(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=100),
    _token: str | None = Depends(require_api_key),
):
    """Search authors by name."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, name, slug, article_count
               FROM persons
               WHERE name ILIKE $1
               ORDER BY article_count DESC
               LIMIT $2""",
            f"%{q}%",
            limit,
        )

    return {"authors": [dict(r) for r in rows]}

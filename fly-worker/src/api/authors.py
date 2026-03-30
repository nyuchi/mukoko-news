"""Author endpoints — /api/authors, /api/author/:slug, /api/trending-authors, /api/featured-authors."""

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from src.db import get_pool
from src.api.auth import require_auth, AuthUser
from src.api.feeds import _row_to_article, ARTICLE_SELECT, ARTICLE_FROM

router = APIRouter(prefix="/api", tags=["authors"])


@router.get("/authors")
async def get_authors(
    limit: int = Query(20, ge=1, le=100),
    _user: AuthUser = Depends(require_auth),
):
    """Get authors sorted by article count."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, name, slug, description, job_title, works_for, image,
                      article_count, total_views, verification_status
               FROM identity.person
               WHERE article_count > 0
               ORDER BY article_count DESC
               LIMIT $1""",
            limit,
        )

    return {"authors": [dict(r) for r in rows]}


@router.get("/author/{slug}")
async def get_author(
    slug: str = Path(...),
    _user: AuthUser = Depends(require_auth),
):
    """Get author profile and their articles."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        author = await conn.fetchrow(
            """SELECT id, name, slug, description, job_title, works_for, image,
                      article_count, total_views, verification_status
               FROM identity.person WHERE slug = $1 OR normalized_name = $1""",
            slug,
        )

        if not author:
            raise HTTPException(status_code=404, detail="Author not found")

        articles = await conn.fetch(
            f"""SELECT {ARTICLE_SELECT}
               {ARTICLE_FROM}
               JOIN news.article_authorship aa ON aa.article_id = a.id
               WHERE aa.person_id = $1
                 AND a.status = 'published'
               ORDER BY a.datepublished DESC
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
    _user: AuthUser = Depends(require_auth),
):
    """Search authors by name."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, name, slug, article_count
               FROM identity.person
               WHERE name ILIKE $1
               ORDER BY article_count DESC
               LIMIT $2""",
            f"%{q}%",
            limit,
        )

    return {"authors": [dict(r) for r in rows]}


@router.get("/trending-authors")
async def get_trending_authors(
    limit: int = Query(5, ge=1, le=50),
    _user: AuthUser = Depends(require_auth),
):
    """Get trending authors by recent article output (last 7 days)."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT p.id::text, p.name,
                      COUNT(a.id) AS article_count
               FROM identity.person p
               JOIN news.article_authorship aa ON aa.person_id = p.id
               JOIN news.news_article a ON a.id = aa.article_id
               WHERE a.status = 'published'
                 AND a.datepublished >= NOW() - INTERVAL '7 days'
               GROUP BY p.id, p.name
               ORDER BY COUNT(a.id) DESC
               LIMIT $1""",
            limit,
        )

    return {
        "trending_authors": [dict(r) for r in rows],
        "timeframe": "7d",
    }


@router.get("/featured-authors")
async def get_featured_authors(
    limit: int = Query(5, ge=1, le=50),
    _user: AuthUser = Depends(require_auth),
):
    """Get featured/top authors by total article count."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id::text, name, description AS bio, article_count
               FROM identity.person
               WHERE article_count > 0
               ORDER BY article_count DESC
               LIMIT $1""",
            limit,
        )

    return {"authors": [dict(r) for r in rows]}

"""Search endpoints — /api/search, /api/keywords."""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query

from src.db import get_pool
from src.api.auth import require_api_key
from src.api.feeds import _row_to_article

router = APIRouter(prefix="/api", tags=["search"])


@router.get("/search")
async def search_articles(
    q: str = Query(..., min_length=1),
    limit: int = Query(24, ge=1, le=100),
    category: str | None = Query(None),
    _token: str | None = Depends(require_api_key),
):
    """Search articles by keyword."""
    pool = await get_pool()
    search_term = f"%{q}%"

    async with pool.acquire() as conn:
        conditions = [
            "a.status = 'published'",
            "(a.headline ILIKE $1 OR a.description ILIKE $1)",
        ]
        params: list = [search_term]
        idx = 2

        if category and category != "all":
            conditions.append(f"a.article_section_id = ${idx}")
            params.append(category)
            idx += 1

        where = " AND ".join(conditions)

        rows = await conn.fetch(
            f"""SELECT a.*, s.name AS section_name, s.emoji AS section_emoji, s.color AS section_color
                FROM articles a
                LEFT JOIN article_sections s ON a.article_section_id = s.id
                WHERE {where}
                ORDER BY a.date_published DESC
                LIMIT ${idx}""",
            *params,
            limit,
        )

        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM articles a WHERE {where}",
            *params,
        )

    articles = [_row_to_article(r) for r in rows]

    return {
        "results": articles,
        "articles": articles,
        "query": q,
        "count": total or 0,
        "category": category or "all",
        "searchMethod": "keyword",
        "pagination": {
            "page": 1,
            "limit": limit,
            "total": total or 0,
        },
    }


@router.get("/search/by-keyword/{keyword}")
async def search_by_keyword(
    keyword: str,
    limit: int = Query(24, ge=1, le=100),
    _token: str | None = Depends(require_api_key),
):
    """Get articles tagged with a specific keyword/term."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT a.*, s.name AS section_name, s.emoji AS section_emoji, s.color AS section_color
               FROM articles a
               LEFT JOIN article_sections s ON a.article_section_id = s.id
               JOIN article_keywords ak ON ak.article_id = a.id
               WHERE ak.term_id = $1
                 AND a.status = 'published'
               ORDER BY a.date_published DESC
               LIMIT $2""",
            keyword,
            limit,
        )

    return {"articles": [_row_to_article(r) for r in rows], "keyword": keyword}


@router.get("/keywords")
async def get_keywords(
    limit: int = Query(32, ge=1, le=100),
    _token: str | None = Depends(require_api_key),
):
    """Get trending keywords/topics for tag cloud."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        # Try trending cache first
        rows = await conn.fetch(
            """SELECT term_id AS id, term_name AS name, term_id AS slug,
                      'keyword' AS type, article_count
               FROM trending_cache
               WHERE scope = 'global'
                 AND expires_at > NOW()
               ORDER BY score DESC
               LIMIT $1""",
            limit,
        )

        if not rows:
            # Fallback: direct keyword count
            rows = await conn.fetch(
                """SELECT dt.id, dt.name, dt.term_code AS slug,
                          dt.term_type AS type, dt.article_count
                   FROM defined_terms dt
                   WHERE dt.enabled = TRUE
                     AND dt.article_count > 0
                   ORDER BY dt.article_count DESC
                   LIMIT $1""",
                limit,
            )

        total = await conn.fetchval(
            "SELECT COUNT(*) FROM defined_terms WHERE enabled = TRUE AND article_count > 0"
        )

    return {
        "keywords": [dict(r) for r in rows],
        "total": total or 0,
    }

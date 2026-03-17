"""Search endpoints — /api/search, /api/keywords.

Search is a funnel: Doris narrows millions of articles to ~10 candidates,
Postgres hydrates the metadata. No over-ranking — Doris's approximate
ranking is good enough. Falls back to Postgres ILIKE when Doris is unavailable.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query

from src.db import get_pool
from src.api.auth import require_api_key
from src.api.feeds import _row_to_article, ARTICLE_SELECT, ARTICLE_FROM
from src.services.doris import get_doris
from src.services.analytics import get_analytics

router = APIRouter(prefix="/api", tags=["search"])


@router.get("/search")
async def search_articles(
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=50),
    category: str | None = Query(None),
    _token: str | None = Depends(require_api_key),
):
    """Search articles by keyword. Funnel: Doris narrows → Postgres hydrates."""
    pool = await get_pool()
    articles = []
    search_method = "keyword"
    total = 0

    # Try Doris funnel first
    doris_ids = await _doris_search(q, limit, category)
    if doris_ids is not None:
        search_method = "doris_funnel"
        articles, total = await _hydrate_from_postgres(pool, doris_ids, len(doris_ids))
    else:
        # Fallback: Postgres ILIKE
        articles, total = await _postgres_search(pool, q, limit, category)

    # Track search in analytics
    get_analytics().track_search(q, total, category=category or "")

    return {
        "results": articles,
        "articles": articles,
        "query": q,
        "count": total,
        "category": category or "all",
        "searchMethod": search_method,
        "pagination": {
            "page": 1,
            "limit": limit,
            "total": total,
        },
    }


async def _doris_search(query: str, limit: int, category: str | None) -> list[str] | None:
    """Query Doris inverted index. Returns article IDs or None if unavailable."""
    doris = get_doris()
    try:
        if not await doris.ping():
            return None

        # Escape single quotes for SQL safety
        safe_q = query.replace("'", "\\'")

        # Build WHERE clause
        conditions = [f"MATCH_ANY(headline, '{safe_q}') OR MATCH_ANY(description, '{safe_q}') OR MATCH_ANY(keywords, '{safe_q}')"]
        if category and category != "all":
            safe_cat = category.replace("'", "\\'")
            conditions.append(f"category = '{safe_cat}'")

        where = " AND ".join(f"({c})" for c in conditions)

        sql = f"""
            SELECT article_id
            FROM mukoko_analytics.article_search
            WHERE {where}
            ORDER BY engagement_score DESC, datepublished DESC
            LIMIT {int(limit)}
        """

        rows = await doris.query(sql)
        if rows:
            return [r["article_id"] for r in rows]
        return []

    except Exception as e:
        print(f"[SEARCH] Doris search error: {e}")
        return None


async def _hydrate_from_postgres(pool, article_ids: list[str], limit: int) -> tuple[list[dict], int]:
    """Fetch full article metadata from Postgres for the given IDs, preserving order."""
    if not article_ids:
        return [], 0

    async with pool.acquire() as conn:
        # Build placeholders: $1, $2, $3...
        placeholders = ", ".join(f"${i+1}::uuid" for i in range(len(article_ids)))
        rows = await conn.fetch(
            f"""SELECT {ARTICLE_SELECT}
                {ARTICLE_FROM}
                WHERE a.id IN ({placeholders})
                AND a.status = 'published'""",
            *article_ids,
        )

    # Preserve Doris ranking order
    row_map = {str(r["id"]): r for r in rows}
    ordered = [row_map[aid] for aid in article_ids if aid in row_map]

    return [_row_to_article(r) for r in ordered], len(ordered)


async def _postgres_search(pool, query: str, limit: int, category: str | None) -> tuple[list[dict], int]:
    """Fallback: Postgres ILIKE search."""
    search_term = f"%{query}%"

    async with pool.acquire() as conn:
        conditions = [
            "a.status = 'published'",
            "(a.headline ILIKE $1 OR a.description ILIKE $1)",
        ]
        params: list = [search_term]
        idx = 2

        if category and category != "all":
            conditions.append(f"a.articlesection = ${idx}")
            params.append(category)
            idx += 1

        where = " AND ".join(conditions)

        rows = await conn.fetch(
            f"""SELECT {ARTICLE_SELECT}
                {ARTICLE_FROM}
                WHERE {where}
                ORDER BY a.datepublished DESC
                LIMIT ${idx}""",
            *params,
            limit,
        )

        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM news.news_article a WHERE {where}",
            *params,
        )

    return [_row_to_article(r) for r in rows], total or 0


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
            f"""SELECT {ARTICLE_SELECT}
               {ARTICLE_FROM}
               JOIN news.article_keyword ak ON ak.article_id = a.id
               WHERE ak.term_id = $1
                 AND a.status = 'published'
               ORDER BY a.datepublished DESC
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
               FROM news.trending_cache
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
                   FROM news.defined_term dt
                   WHERE dt.enabled = TRUE
                     AND dt.article_count > 0
                   ORDER BY dt.article_count DESC
                   LIMIT $1""",
                limit,
            )

        total = await conn.fetchval(
            "SELECT COUNT(*) FROM news.defined_term WHERE enabled = TRUE AND article_count > 0"
        )

    return {
        "keywords": [dict(r) for r in rows],
        "total": total or 0,
    }

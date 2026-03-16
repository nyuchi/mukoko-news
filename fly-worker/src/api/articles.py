"""Article endpoints — /api/article/:id, /api/article/:id/related."""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from src.db import get_pool
from src.api.auth import require_api_key
from src.api.feeds import _row_to_article

router = APIRouter(prefix="/api", tags=["articles"])


@router.get("/article/{article_id}")
async def get_article(
    article_id: str = Path(...),
    _token: str | None = Depends(require_api_key),
):
    """Get a single article by ID or slug."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        # Try by numeric ID first, then slug
        row = None
        if article_id.isdigit():
            row = await conn.fetchrow(
                """SELECT a.*, s.name AS section_name, s.emoji AS section_emoji, s.color AS section_color
                   FROM articles a
                   LEFT JOIN article_sections s ON a.article_section_id = s.id
                   WHERE a.id = $1""",
                int(article_id),
            )
        if not row:
            row = await conn.fetchrow(
                """SELECT a.*, s.name AS section_name, s.emoji AS section_emoji, s.color AS section_color
                   FROM articles a
                   LEFT JOIN article_sections s ON a.article_section_id = s.id
                   WHERE a.slug = $1""",
                article_id,
            )

        if not row:
            raise HTTPException(status_code=404, detail="Article not found")

        article = _row_to_article(row)

        # Include full body in single-article view
        article["article_body"] = dict(row).get("article_body_processed") or dict(row).get("article_body", "")

        # Get keywords with full info
        article_db_id = row["id"]
        kw_rows = await conn.fetch(
            """SELECT dt.id, dt.name, dt.term_code AS slug
               FROM article_keywords ak
               JOIN defined_terms dt ON dt.id = ak.term_id
               WHERE ak.article_id = $1
               ORDER BY ak.relevance_score DESC
               LIMIT 15""",
            article_db_id,
        )
        if kw_rows:
            article["keywords"] = [dict(r) for r in kw_rows]

        # Increment view count
        await conn.execute(
            "UPDATE articles SET view_count = view_count + 1, updated_at = NOW() WHERE id = $1",
            article_db_id,
        )

    return {"article": article}


@router.get("/article/{article_id}/related")
async def get_related_articles(
    article_id: str = Path(...),
    limit: int = Query(5, ge=1, le=20),
    _token: str | None = Depends(require_api_key),
):
    """Get articles related to the given article."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        # Get the source article
        source = await conn.fetchrow(
            """SELECT id, article_section_id, about_country_id, publisher_id, keywords, headline
               FROM articles WHERE id = $1 OR slug = $1""",
            int(article_id) if article_id.isdigit() else 0,
        )
        if not source and not article_id.isdigit():
            source = await conn.fetchrow(
                "SELECT id, article_section_id, about_country_id, publisher_id, keywords, headline FROM articles WHERE slug = $1",
                article_id,
            )

        if not source:
            raise HTTPException(status_code=404, detail="Article not found")

        source_id = source["id"]

        # Strategy 1: Same keywords
        kw_rows = await conn.fetch(
            """SELECT DISTINCT a.*, s.name AS section_name, s.emoji AS section_emoji, s.color AS section_color
               FROM articles a
               LEFT JOIN article_sections s ON a.article_section_id = s.id
               JOIN article_keywords ak ON ak.article_id = a.id
               WHERE ak.term_id IN (
                   SELECT term_id FROM article_keywords WHERE article_id = $1
               )
               AND a.id != $1
               AND a.status = 'published'
               ORDER BY a.date_published DESC
               LIMIT $2""",
            source_id,
            limit,
        )

        if len(kw_rows) < limit:
            # Strategy 2: Same section and country
            extra = await conn.fetch(
                """SELECT a.*, s.name AS section_name, s.emoji AS section_emoji, s.color AS section_color
                   FROM articles a
                   LEFT JOIN article_sections s ON a.article_section_id = s.id
                   WHERE a.article_section_id = $1
                     AND a.about_country_id = $2
                     AND a.id != $3
                     AND a.status = 'published'
                   ORDER BY a.date_published DESC
                   LIMIT $4""",
                source["article_section_id"],
                source["about_country_id"],
                source_id,
                limit - len(kw_rows),
            )
            # Deduplicate
            seen = {r["id"] for r in kw_rows}
            for r in extra:
                if r["id"] not in seen:
                    kw_rows.append(r)
                    seen.add(r["id"])

    return {"related": [_row_to_article(r) for r in kw_rows[:limit]]}


@router.get("/article/by-source-slug")
async def get_article_by_source_slug(
    source: str = Query(...),
    slug: str = Query(...),
    _token: str | None = Depends(require_api_key),
):
    """Get article by source ID and slug combo."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT a.*, s.name AS section_name, s.emoji AS section_emoji, s.color AS section_color
               FROM articles a
               LEFT JOIN article_sections s ON a.article_section_id = s.id
               WHERE a.publisher_id = $1 AND a.slug = $2 AND a.status = 'published'
               LIMIT 1""",
            source,
            slug,
        )

    if not row:
        raise HTTPException(status_code=404, detail="Article not found")

    article = _row_to_article(row)
    article["article_body"] = dict(row).get("article_body_processed") or dict(row).get("article_body", "")

    return {"article": article}

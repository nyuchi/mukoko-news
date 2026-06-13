"""Article endpoints — /api/article/:id, /api/article/:id/related."""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from src.db import get_pool
from src.api.auth import optional_auth, AuthUser
from src.api.feeds import _row_to_article, ARTICLE_SELECT, ARTICLE_FROM
from src.services.couchdb import get_couchdb
from src.services.analytics import get_analytics

router = APIRouter(prefix="/api", tags=["articles"])


@router.get("/article/{article_id}")
async def get_article(
    article_id: str = Path(...),
    _user: AuthUser | None = Depends(optional_auth),
):
    """Get a single article by ID or slug."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        # Try by UUID first, then slug
        row = None
        # UUID format check (simple heuristic)
        if _is_uuid(article_id):
            row = await conn.fetchrow(
                f"""SELECT {ARTICLE_SELECT},
                           a.articlebody AS article_body,
                           a.article_body_processed,
                           a.couchdb_doc_id
                   {ARTICLE_FROM}
                   WHERE a.id = $1::uuid""",
                article_id,
            )
        if not row:
            row = await conn.fetchrow(
                f"""SELECT {ARTICLE_SELECT},
                           a.articlebody AS article_body,
                           a.article_body_processed,
                           a.couchdb_doc_id
                   {ARTICLE_FROM}
                   WHERE a.slug = $1""",
                article_id,
            )

        if not row:
            raise HTTPException(status_code=404, detail="Article not found")

        article = _row_to_article(row)

        # Include full body — prefer CouchDB, fallback to Postgres
        d = dict(row)
        body = None
        couchdb_id = d.get("couchdb_doc_id")
        if couchdb_id:
            try:
                couch_doc = await get_couchdb().get_doc(couchdb_id)
                if couch_doc:
                    body = couch_doc.get("article_body_processed") or couch_doc.get("articlebody")
            except Exception:
                pass  # Fall through to Postgres
        if not body:
            body = d.get("article_body_processed") or d.get("article_body", "")
        article["article_body"] = body

        # Get keywords with full info
        article_db_id = row["id"]
        kw_rows = await conn.fetch(
            """SELECT dt.id::text, dt.name, dt.term_code AS slug
               FROM news.article_keyword ak
               JOIN news.defined_term dt ON dt.id = ak.term_id
               WHERE ak.article_id = $1::uuid
               ORDER BY ak.relevance_score DESC
               LIMIT 15""",
            article_db_id,
        )
        if kw_rows:
            article["keywords"] = [dict(r) for r in kw_rows]

        # Increment view count (Postgres + Doris)
        await conn.execute(
            "UPDATE news.news_article SET view_count = view_count + 1, updated_at = NOW() WHERE id = $1::uuid",
            article_db_id,
        )
        get_analytics().track_view(str(article_db_id))

    return {"article": article}


@router.get("/article/{article_id}/related")
async def get_related_articles(
    article_id: str = Path(...),
    limit: int = Query(5, ge=1, le=20),
    _user: AuthUser | None = Depends(optional_auth),
):
    """Get articles related to the given article."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        # Get the source article
        source = None
        if _is_uuid(article_id):
            source = await conn.fetchrow(
                """SELECT id, primary_interest_category_id, primary_location_country,
                          publisher_organization_id, keywords, headline
                   FROM news.news_article WHERE id = $1::uuid""",
                article_id,
            )
        if not source:
            source = await conn.fetchrow(
                """SELECT id, primary_interest_category_id, primary_location_country,
                          publisher_organization_id, keywords, headline
                   FROM news.news_article WHERE slug = $1""",
                article_id,
            )

        if not source:
            raise HTTPException(status_code=404, detail="Article not found")

        source_id = source["id"]

        # Strategy 1: Same keywords
        kw_rows = await conn.fetch(
            f"""SELECT DISTINCT {ARTICLE_SELECT}
               {ARTICLE_FROM}
               JOIN news.article_keyword ak ON ak.article_id = a.id
               WHERE ak.term_id IN (
                   SELECT term_id FROM news.article_keyword WHERE article_id = $1
               )
               AND a.id != $1
               AND a.creativeworkstatus = 'published'
               ORDER BY a.datepublished DESC
               LIMIT $2""",
            source_id,
            limit,
        )

        if len(kw_rows) < limit:
            # Strategy 2: Same section and country
            extra = await conn.fetch(
                f"""SELECT {ARTICLE_SELECT}
                   {ARTICLE_FROM}
                   WHERE a.primary_interest_category_id = $1
                     AND a.primary_location_country = $2
                     AND a.id != $3
                     AND a.creativeworkstatus = 'published'
                   ORDER BY a.datepublished DESC
                   LIMIT $4""",
                source["primary_interest_category_id"],
                source["primary_location_country"],
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
    _user: AuthUser | None = Depends(optional_auth),
):
    """Get article by source ID and slug combo."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""SELECT {ARTICLE_SELECT},
                       a.articlebody AS article_body,
                       a.article_body_processed
               {ARTICLE_FROM}
               WHERE a.publisher_organization_id::text = $1 AND a.slug = $2 AND a.creativeworkstatus = 'published'
               LIMIT 1""",
            source,
            slug,
        )

    if not row:
        raise HTTPException(status_code=404, detail="Article not found")

    article = _row_to_article(row)
    d = dict(row)
    article["article_body"] = d.get("article_body_processed") or d.get("article_body", "")

    return {"article": article}


def _is_uuid(value: str) -> bool:
    """Check if a string looks like a UUID."""
    import re
    return bool(re.match(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$', value))

"""Story clustering and trending endpoints."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Path, Query

from src.db import get_pool
from src.api.auth import require_api_key
from src.api.feeds import _row_to_article, _cluster_articles

router = APIRouter(prefix="/api", tags=["stories"])


@router.get("/stories/trending")
async def get_trending_stories(
    limit: int = Query(10, ge=1, le=50),
    _token: str | None = Depends(require_api_key),
):
    """Get trending story clusters from the last 48h."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT a.*, s.name AS section_name, s.emoji AS section_emoji, s.color AS section_color
               FROM articles a
               LEFT JOIN article_sections s ON a.article_section_id = s.id
               WHERE a.status = 'published'
                 AND a.date_published >= NOW() - INTERVAL '48 hours'
               ORDER BY a.engagement_score DESC, a.date_published DESC
               LIMIT $1""",
            limit * 3,  # Fetch extra for clustering
        )

    articles = [_row_to_article(r) for r in rows]
    clusters = _cluster_articles(articles)

    stories = []
    for cluster in clusters[:limit]:
        stories.append({
            "id": cluster["id"],
            "headline": cluster["primaryArticle"]["headline"],
            "article_count": cluster["articleCount"],
            "latest_article": cluster["primaryArticle"],
        })

    return {"stories": stories}


@router.get("/stories/cluster/{article_id}")
async def get_story_cluster(
    article_id: int = Path(...),
    _token: str | None = Depends(require_api_key),
):
    """Get all articles in the same story cluster as the given article."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        # Get the source article
        source = await conn.fetchrow(
            "SELECT id, headline, article_section_id FROM articles WHERE id = $1",
            article_id,
        )
        if not source:
            return {"cluster": None}

        # Find similar articles by shared keywords
        rows = await conn.fetch(
            """SELECT a.*, s.name AS section_name, s.emoji AS section_emoji, s.color AS section_color
               FROM articles a
               LEFT JOIN article_sections s ON a.article_section_id = s.id
               WHERE a.status = 'published'
                 AND a.article_section_id = $1
                 AND a.date_published >= NOW() - INTERVAL '72 hours'
               ORDER BY a.date_published DESC
               LIMIT 30""",
            source["article_section_id"],
        )

    articles = [_row_to_article(r) for r in rows]
    clusters = _cluster_articles(articles)

    # Find the cluster containing our article
    target_id = str(article_id)
    for cluster in clusters:
        if cluster["primaryArticle"]["id"] == target_id:
            return {"cluster": cluster}
        for related in cluster["relatedArticles"]:
            if related["id"] == target_id:
                return {"cluster": cluster}

    return {"cluster": None}

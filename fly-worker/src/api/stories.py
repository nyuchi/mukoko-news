"""Story clustering and trending endpoints."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Path, Query

from src.db import get_pool
from src.api.auth import require_auth, AuthUser
from src.api.feeds import _row_to_article, _cluster_articles, ARTICLE_SELECT, ARTICLE_FROM

router = APIRouter(prefix="/api", tags=["stories"])


@router.get("/stories/trending")
async def get_trending_stories(
    limit: int = Query(10, ge=1, le=50),
    _user: AuthUser = Depends(require_auth),
):
    """Get trending story clusters from the last 48h."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""SELECT {ARTICLE_SELECT}
               {ARTICLE_FROM}
               WHERE a.status = 'published'
                 AND a.datepublished >= NOW() - INTERVAL '48 hours'
               ORDER BY a.engagement_score DESC, a.datepublished DESC
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
    article_id: str = Path(...),
    _user: AuthUser = Depends(require_auth),
):
    """Get all articles in the same story cluster as the given article."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        # Get the source article
        source = await conn.fetchrow(
            "SELECT id, headline, primary_interest_category_id FROM news.news_article WHERE id = $1::uuid",
            article_id,
        )
        if not source:
            return {"cluster": None}

        # Find similar articles by shared keywords
        rows = await conn.fetch(
            f"""SELECT {ARTICLE_SELECT}
               {ARTICLE_FROM}
               WHERE a.status = 'published'
                 AND a.primary_interest_category_id = $1
                 AND a.datepublished >= NOW() - INTERVAL '72 hours'
               ORDER BY a.datepublished DESC
               LIMIT 30""",
            source["primary_interest_category_id"],
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

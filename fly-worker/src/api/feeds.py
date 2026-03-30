"""Feed endpoints — /api/feeds, /api/feeds/sectioned, /api/news-bytes.

These are the most critical endpoints: they power the homepage and all feed views.
"""

import json
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query

from src.db import get_pool
from src.api.auth import optional_auth, AuthUser

router = APIRouter(prefix="/api", tags=["feeds"])

# Common SELECT columns for article queries with aliases for backward compatibility
ARTICLE_SELECT = """
    a.id::text,
    a.headline,
    a.description,
    a.slug,
    a.mainentityofpage AS main_entity_of_page,
    a.image->>'url' AS image,
    a.author->>'name' AS author_name,
    a.publisher_organization_id::text AS publisher_id,
    a.publisher->>'name' AS publisher_name,
    a.articlesection AS article_section_id,
    a.primary_location_country AS about_country_id,
    a.datepublished AS date_published,
    a.datemodified AS date_modified,
    a.wordcount AS word_count,
    a.reading_time_minutes,
    a.inlanguage AS in_language,
    a.keywords,
    a.view_count, a.like_count, a.bookmark_count,
    a.comment_count, a.share_count,
    a.quality_score, a.engagement_score,
    a.content_type,
    CASE WHEN a.is_breaking THEN 'breaking'
         WHEN a.is_featured THEN 'urgent'
         ELSE 'standard' END AS urgency,
    a.status,
    ic.name AS section_name,
    ic.emoji AS section_emoji,
    ic.color_hex AS section_color
"""

ARTICLE_FROM = """
    FROM news.news_article a
    LEFT JOIN engagement.interest_category ic ON a.primary_interest_category_id = ic.id
"""


@router.get("/feeds")
async def get_feeds(
    limit: int = Query(24, ge=1, le=100),
    page: int = Query(1, ge=1),
    category: str | None = Query(None),
    countries: str | None = Query(None),
    sort: str = Query("latest"),
    _user: AuthUser | None = Depends(optional_auth),
):
    """Get articles feed with filtering and pagination."""
    pool = await get_pool()
    offset = (page - 1) * limit

    async with pool.acquire() as conn:
        # Build query
        conditions = ["a.status = 'published'"]
        params: list = []
        idx = 1

        if category and category != "all":
            conditions.append(f"a.articlesection = ${idx}")
            params.append(category)
            idx += 1

        if countries:
            country_list = [c.strip() for c in countries.split(",") if c.strip()]
            if country_list:
                placeholders = ", ".join(f"${idx + i}" for i in range(len(country_list)))
                conditions.append(f"a.primary_location_country IN ({placeholders})")
                params.extend(country_list)
                idx += len(country_list)

        where = " AND ".join(conditions)

        # Sort order
        order_by = {
            "latest": "a.datepublished DESC",
            "trending": "a.trending_score DESC, a.datepublished DESC",
            "popular": "a.engagement_score DESC, a.datepublished DESC",
        }.get(sort, "a.datepublished DESC")

        # Count total
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM news.news_article a WHERE {where}", *params
        )

        # Fetch articles
        rows = await conn.fetch(
            f"""SELECT {ARTICLE_SELECT}
                {ARTICLE_FROM}
                WHERE {where}
                ORDER BY {order_by}
                LIMIT ${idx} OFFSET ${idx + 1}""",
            *params,
            limit,
            offset,
        )

    articles = [_row_to_article(row) for row in rows]

    return {
        "articles": articles,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total or 0,
        },
    }


@router.get("/feeds/sectioned")
async def get_sectioned_feed(
    countries: str | None = Query(None),
    categories: str | None = Query(None),
    _user: AuthUser | None = Depends(optional_auth),
):
    """Sectioned feed: top stories, your news, by category, latest."""
    pool = await get_pool()

    country_list = (
        [c.strip() for c in countries.split(",") if c.strip()] if countries else []
    )
    category_list = (
        [c.strip() for c in categories.split(",") if c.strip()] if categories else []
    )

    async with pool.acquire() as conn:
        # Top stories: highest engagement in last 48h
        if country_list:
            top_rows = await conn.fetch(
                f"""SELECT {ARTICLE_SELECT}
                   {ARTICLE_FROM}
                   WHERE a.status = 'published'
                     AND a.datepublished >= NOW() - INTERVAL '48 hours'
                     AND a.primary_location_country = ANY($1::text[])
                   ORDER BY a.engagement_score DESC, a.datepublished DESC
                   LIMIT 20""",
                country_list,
            )
        else:
            top_rows = await conn.fetch(
                f"""SELECT {ARTICLE_SELECT}
                   {ARTICLE_FROM}
                   WHERE a.status = 'published'
                     AND a.datepublished >= NOW() - INTERVAL '48 hours'
                   ORDER BY a.engagement_score DESC, a.datepublished DESC
                   LIMIT 20"""
            )

        top_stories = _cluster_articles([_row_to_article(r) for r in top_rows])

        # Latest articles
        if country_list:
            latest_rows = await conn.fetch(
                f"""SELECT {ARTICLE_SELECT}
                   {ARTICLE_FROM}
                   WHERE a.status = 'published'
                     AND a.primary_location_country = ANY($1::text[])
                   ORDER BY a.datepublished DESC
                   LIMIT 24""",
                country_list,
            )
        else:
            latest_rows = await conn.fetch(
                f"""SELECT {ARTICLE_SELECT}
                   {ARTICLE_FROM}
                   WHERE a.status = 'published'
                   ORDER BY a.datepublished DESC
                   LIMIT 24"""
            )
        latest = [_row_to_article(r) for r in latest_rows]

        # By category
        by_category = []
        sections = await conn.fetch(
            "SELECT id, name FROM engagement.interest_category WHERE is_active = TRUE ORDER BY sort_order"
        )
        for section in sections:
            section_id = section["id"]
            if category_list and section_id not in category_list:
                continue

            if country_list:
                cat_rows = await conn.fetch(
                    f"""SELECT {ARTICLE_SELECT}
                       {ARTICLE_FROM}
                       WHERE a.status = 'published'
                         AND a.primary_interest_category_id = $1
                         AND a.primary_location_country = ANY($2::text[])
                       ORDER BY a.datepublished DESC
                       LIMIT 6""",
                    section_id,
                    country_list,
                )
            else:
                cat_rows = await conn.fetch(
                    f"""SELECT {ARTICLE_SELECT}
                       {ARTICLE_FROM}
                       WHERE a.status = 'published'
                         AND a.primary_interest_category_id = $1
                       ORDER BY a.datepublished DESC
                       LIMIT 6""",
                    section_id,
                )

            if cat_rows:
                by_category.append({
                    "id": section_id,
                    "name": section["name"],
                    "articles": [_row_to_article(r) for r in cat_rows],
                })

    return {
        "topStories": top_stories,
        "yourNews": latest[:12] if country_list else [],
        "byCategory": by_category,
        "latest": latest,
        "countries": country_list,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/news-bytes")
async def get_news_bytes(
    limit: int = Query(20, ge=1, le=50),
    _user: AuthUser | None = Depends(optional_auth),
):
    """NewsBytes: short-form articles for TikTok-style feed."""
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""SELECT {ARTICLE_SELECT}
               {ARTICLE_FROM}
               WHERE a.status = 'published'
                 AND a.content_type = 'news-byte'
               ORDER BY a.datepublished DESC
               LIMIT $1""",
            limit,
        )

        # Fallback: short articles if no explicit news-bytes
        if not rows:
            rows = await conn.fetch(
                f"""SELECT {ARTICLE_SELECT}
                   {ARTICLE_FROM}
                   WHERE a.status = 'published'
                     AND a.wordcount <= 200
                     AND a.image IS NOT NULL
                   ORDER BY a.datepublished DESC
                   LIMIT $1""",
                limit,
            )

    return {"articles": [_row_to_article(r) for r in rows]}


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────


def _row_to_article(row) -> dict:
    """Convert a database row to the Article response dict."""
    d = dict(row)

    # keywords is now TEXT[] from asyncpg — comes as a Python list directly
    keywords = d.get("keywords")
    if isinstance(keywords, str):
        try:
            keywords = json.loads(keywords)
        except (json.JSONDecodeError, TypeError):
            keywords = []
    elif keywords is None:
        keywords = []

    # Format keywords as objects for frontend
    if keywords and isinstance(keywords, list):
        if keywords and isinstance(keywords[0], str):
            keywords = [
                {"id": _slugify(k), "name": k, "slug": _slugify(k)}
                for k in keywords
            ]

    # Build response
    article = {
        "id": str(d["id"]),
        "headline": d.get("headline", ""),
        "description": d.get("description", ""),
        "slug": d.get("slug", ""),
        "main_entity_of_page": d.get("main_entity_of_page", ""),
        "image": d.get("image"),
        "author_name": d.get("author_name"),
        "publisher_id": d.get("publisher_id"),
        "publisher_name": d.get("publisher_name"),
        "article_section_id": d.get("article_section_id"),
        "about_country_id": d.get("about_country_id"),
        "date_published": _isoformat(d.get("date_published")),
        "date_modified": _isoformat(d.get("date_modified")),
        "word_count": d.get("word_count", 0),
        "reading_time_minutes": d.get("reading_time_minutes", 0),
        "in_language": d.get("in_language", "en"),
        "keywords": keywords,
        "view_count": d.get("view_count", 0),
        "like_count": d.get("like_count", 0),
        "bookmark_count": d.get("bookmark_count", 0),
        "comment_count": d.get("comment_count", 0),
        "quality_score": d.get("quality_score", 0),
        "engagement_score": d.get("engagement_score", 0),
        "content_type": d.get("content_type", "article"),
        "urgency": d.get("urgency", "standard"),
        "status": d.get("status", "published"),
    }

    # Include section info if available
    if d.get("section_name"):
        article["section_name"] = d["section_name"]
        article["section_emoji"] = d.get("section_emoji")
        article["section_color"] = d.get("section_color")

    return article


def _isoformat(dt) -> str | None:
    """Safely convert datetime to ISO string."""
    if dt is None:
        return None
    if isinstance(dt, datetime):
        return dt.isoformat()
    return str(dt)


def _slugify(text: str) -> str:
    """Generate URL-safe slug."""
    slug = text.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    return slug[:100].strip("-")


def _cluster_articles(articles: list[dict], threshold: float = 0.4) -> list[dict]:
    """Simple title-based clustering using Jaccard similarity."""
    if not articles:
        return []

    clusters: list[dict] = []
    used = set()

    for i, article in enumerate(articles):
        if i in used:
            continue

        cluster = {
            "id": article["id"],
            "primaryArticle": article,
            "relatedArticles": [],
            "articleCount": 1,
        }

        words_i = _title_words(article.get("headline", ""))

        for j in range(i + 1, len(articles)):
            if j in used:
                continue
            words_j = _title_words(articles[j].get("headline", ""))
            if _jaccard(words_i, words_j) >= threshold:
                cluster["relatedArticles"].append(articles[j])
                cluster["articleCount"] += 1
                used.add(j)

        used.add(i)
        clusters.append(cluster)

    return clusters[:10]


_STOP_WORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "has", "have",
    "had", "be", "been", "being", "will", "would", "could", "should", "may",
    "might", "shall", "can", "do", "does", "did", "not", "no", "its", "it",
    "this", "that", "these", "those", "as", "if", "than", "then", "so",
    "up", "out", "about", "into", "over", "after", "before",
}


def _title_words(title: str) -> set[str]:
    """Normalize title to a set of meaningful words."""
    words = re.sub(r"[^\w\s]", "", title.lower()).split()
    return {w for w in words if w not in _STOP_WORDS and len(w) > 2}


def _jaccard(a: set, b: set) -> float:
    """Jaccard similarity between two sets."""
    if not a or not b:
        return 0.0
    intersection = len(a & b)
    union = len(a | b)
    return intersection / union if union > 0 else 0.0

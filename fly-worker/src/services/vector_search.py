"""MongoDB Atlas Vector Search and Full-Text Search service.

Provides $vectorSearch (semantic) and $search (Atlas text) queries
against the news.articles collection. Both indexes must exist:
  - articles_vector_search  (vectorSearch, 1024-dim BGE-M3 cosine)
  - articles_text_search    (search, lucene.english on headline/description/body)
"""

from datetime import datetime
from typing import Any

from src.services.mongodb import get_db

_APPROVED_STATUSES = ["approved", "published"]

# Fields to project for article results (excludes large embedding array)
_ARTICLE_PROJECTION = {
    "embedding": 0,
    "articleBody": 0,
}


async def vector_search(
    query_vector: list[float],
    *,
    limit: int = 10,
    num_candidates: int = 150,
    country_code: str | None = None,
    feed_source_id: str | None = None,
    exclude_id: str | None = None,
) -> list[dict[str, Any]]:
    """Semantic similarity search using the articles_vector_search index.

    Args:
        query_vector: 1024-dimensional BGE-M3 embedding.
        limit: Maximum results to return.
        num_candidates: Atlas pre-filter candidate pool (>= limit, higher = better recall).
        country_code: Optional ISO country filter (must be indexed as filter type).
        feed_source_id: Optional source filter.
        exclude_id: Article _id to exclude (e.g. the query article itself).

    Returns:
        List of article dicts with a ``vectorSearchScore`` field (0–1).
    """
    db = get_db()

    pre_filter: dict[str, Any] = {"status": {"$in": _APPROVED_STATUSES}}
    if country_code:
        pre_filter["countryCode"] = country_code
    if feed_source_id:
        pre_filter["feedSourceId"] = feed_source_id

    pipeline: list[dict] = [
        {
            "$vectorSearch": {
                "index": "articles_vector_search",
                "path": "embedding",
                "queryVector": query_vector,
                "numCandidates": max(num_candidates, limit * 10),
                "limit": limit + (1 if exclude_id else 0),
                "filter": pre_filter,
            }
        },
        {"$addFields": {"vectorSearchScore": {"$meta": "vectorSearchScore"}}},
        {"$project": _ARTICLE_PROJECTION},
    ]

    if exclude_id:
        pipeline.append({"$match": {"_id": {"$ne": exclude_id}}})
        pipeline.append({"$limit": limit})

    return await db["articles"].aggregate(pipeline).to_list(limit)


async def text_search(
    query: str,
    *,
    limit: int = 20,
    country_code: str | None = None,
    article_section: str | None = None,
) -> list[dict[str, Any]]:
    """Full-text search using the articles_text_search Atlas Search index.

    Searches headline, description, and articleBodyProcessed with English
    stemming and fuzzy matching. Returns results ranked by relevance score.

    Args:
        query: Search query string.
        limit: Maximum results to return.
        country_code: Optional ISO country filter via feedSource lookup.
        article_section: Optional category/section filter.

    Returns:
        List of article dicts with a ``searchScore`` field.
    """
    db = get_db()

    must: list[dict] = [
        {
            "text": {
                "query": query,
                "path": ["headline", "description", "articleBodyProcessed"],
                "fuzzy": {"maxEdits": 1, "prefixLength": 3},
            }
        }
    ]

    filters: list[dict] = [
        {
            "in": {
                "path": "status",
                "value": _APPROVED_STATUSES,
            }
        }
    ]
    if article_section:
        filters.append({"equals": {"path": "articleSection", "value": article_section}})

    pipeline: list[dict] = [
        {
            "$search": {
                "index": "articles_text_search",
                "compound": {
                    "must": must,
                    "filter": filters,
                },
            }
        },
        {"$addFields": {"searchScore": {"$meta": "searchScore"}}},
        {"$project": _ARTICLE_PROJECTION},
        {"$limit": limit},
    ]

    results = await db["articles"].aggregate(pipeline).to_list(limit)

    # Post-filter by country via feedSource if requested (not indexed as filter in text index)
    if country_code and results:
        source_ids = list({r["feedSourceId"] for r in results if r.get("feedSourceId")})
        sources = await db["feedSources"].find(
            {"_id": {"$in": source_ids}, "countryCode": country_code},
            {"_id": 1},
        ).to_list(None)
        allowed = {s["_id"] for s in sources}
        results = [r for r in results if r.get("feedSourceId") in allowed]

    return results


async def find_similar(
    article_id: str,
    *,
    limit: int = 5,
    same_country: bool = False,
) -> list[dict[str, Any]]:
    """Find articles semantically similar to a given article.

    Falls back to same-section date-sorted query if the article has no embedding.

    Args:
        article_id: The _id of the reference article.
        limit: Number of similar articles to return.
        same_country: If True, restrict results to the same country as the source.

    Returns:
        List of similar article dicts.
    """
    db = get_db()
    article = await db["articles"].find_one({"_id": article_id})
    if not article:
        return []

    embedding = article.get("embedding")
    if embedding:
        country_code: str | None = None
        if same_country:
            source = await db["feedSources"].find_one(
                {"_id": article.get("feedSourceId")}, {"countryCode": 1}
            )
            country_code = (source or {}).get("countryCode")

        return await vector_search(
            embedding,
            limit=limit,
            num_candidates=limit * 15,
            country_code=country_code,
            exclude_id=article_id,
        )

    # Fallback: same section, recent articles
    filter_: dict = {
        "_id": {"$ne": article_id},
        "status": {"$in": _APPROVED_STATUSES},
    }
    if article.get("articleSection"):
        filter_["articleSection"] = article["articleSection"]

    return (
        await db["articles"]
        .find(filter_, _ARTICLE_PROJECTION)
        .sort("datePublished", -1)
        .limit(limit)
        .to_list(limit)
    )


async def cluster_by_vector(
    article_ids: list[str],
    *,
    similarity_threshold: float = 0.85,
) -> list[list[str]]:
    """Group a list of articles into clusters based on vector similarity.

    Used by the trending job to identify story clusters (same event, different sources).

    Args:
        article_ids: List of article _ids to cluster.
        similarity_threshold: Cosine similarity threshold for same-cluster assignment.

    Returns:
        List of clusters, each cluster is a list of article _ids.
    """
    db = get_db()
    docs = await db["articles"].find(
        {"_id": {"$in": article_ids}, "embedding": {"$exists": True}},
        {"_id": 1, "embedding": 1},
    ).to_list(None)

    if not docs:
        return [[aid] for aid in article_ids]

    emb_map = {d["_id"]: d["embedding"] for d in docs}

    def cosine_sim(a: list[float], b: list[float]) -> float:
        dot = sum(x * y for x, y in zip(a, b))
        mag_a = sum(x * x for x in a) ** 0.5
        mag_b = sum(x * x for x in b) ** 0.5
        if mag_a == 0 or mag_b == 0:
            return 0.0
        return dot / (mag_a * mag_b)

    clusters: list[list[str]] = []
    assigned: set[str] = set()

    for aid in article_ids:
        if aid in assigned:
            continue
        emb = emb_map.get(aid)
        if not emb:
            clusters.append([aid])
            assigned.add(aid)
            continue

        cluster = [aid]
        assigned.add(aid)
        for other_id in article_ids:
            if other_id in assigned:
                continue
            other_emb = emb_map.get(other_id)
            if other_emb and cosine_sim(emb, other_emb) >= similarity_threshold:
                cluster.append(other_id)
                assigned.add(other_id)

        clusters.append(cluster)

    # Include articles without embeddings as singletons
    for aid in article_ids:
        if aid not in assigned:
            clusters.append([aid])

    return clusters

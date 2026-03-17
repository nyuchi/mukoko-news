"""
Semantic search processor — MongoDB-backed article fetch + trending.

Uses Vectorize for vector search, MongoDB for article data retrieval
and trending topics (delegated to trending.py). D1 as fallback for
keyword search when Vectorize is unavailable.
"""

from services.ai_client import AnthropicClient, get_embedding
from services.mongodb import MongoDBClient


async def semantic_search(query: str, options: dict | None = None, env=None) -> dict:
    """
    Perform semantic search using Vectorize + D1.

    Args:
        query: Search query string
        options: {
            "limit": int,
            "category": str,
            "source": str,
            "date_from": str,
            "date_to": str,
            "include_insights": bool,
        }
        env: Cloudflare bindings (AI, VECTORIZE_INDEX, EDGE_CACHE_DB)

    Returns:
        {
            "results": [{"id", "title", "description", "source", "category", "score", ...}],
            "insights": [{"type", "content", "confidence"}] | None,
            "method": "semantic" | "keyword",
        }
    """
    opts = options or {}
    limit = opts.get("limit", 20)
    category = opts.get("category")
    source = opts.get("source")
    date_from = opts.get("date_from", opts.get("dateFrom"))
    date_to = opts.get("date_to", opts.get("dateTo"))
    include_insights = opts.get("include_insights", opts.get("includeInsights", False))

    if not query or not env:
        return {"results": [], "insights": None, "method": "none"}

    # ---------------------------------------------------------------
    # Step 1: Generate query embedding
    # ---------------------------------------------------------------
    embedding = await get_embedding(query, env)

    if embedding:
        # ---------------------------------------------------------------
        # Step 2: Search Vectorize index
        # ---------------------------------------------------------------
        try:
            vector_results = await env.VECTORIZE_INDEX.query(embedding, {
                "topK": limit * 2,
                "returnMetadata": True,
            })

            matches = vector_results.matches if hasattr(vector_results, "matches") else []
            if isinstance(vector_results, dict):
                matches = vector_results.get("matches", [])

            if matches:
                # Get article IDs and scores
                article_ids = [m.id if hasattr(m, "id") else m.get("id") for m in matches]
                score_map = {
                    (m.id if hasattr(m, "id") else m.get("id")):
                    (m.score if hasattr(m, "score") else m.get("score", 0))
                    for m in matches
                }

                # Fetch full articles from D1 edge cache with filters
                results = await _fetch_articles(
                    article_ids, score_map, category, source, date_from, date_to, limit, env
                )

                # Optional AI insights
                insights = None
                if include_insights and results:
                    insights = await _generate_insights(query, results, env)

                return {"results": results, "insights": insights, "method": "semantic"}

        except Exception as e:
            print(f"[SEARCH] Vector search failed, falling back to keyword: {e}")

    # ---------------------------------------------------------------
    # Fallback: keyword search via D1 LIKE queries
    # ---------------------------------------------------------------
    results = await _keyword_search(query, category, source, date_from, date_to, limit, env)
    return {"results": results, "insights": None, "method": "keyword"}


async def get_trending_topics(env=None, country_id: str | None = None) -> dict:
    """
    Get trending topics — delegates to trending.py service.

    Uses MongoDB aggregation with engagement weighting,
    not Claude AI calls (pure data analysis).
    """
    from services.trending import get_trending
    return await get_trending(env, country_id=country_id)


async def _fetch_articles(
    article_ids: list,
    score_map: dict,
    category: str | None,
    source: str | None,
    date_from: str | None,
    date_to: str | None,
    limit: int,
    env,
) -> list[dict]:
    """Fetch articles by IDs — MongoDB first, D1 edge cache fallback."""
    if not article_ids:
        return []

    # Try MongoDB first
    try:
        db = MongoDBClient(env)
        mongo_filter: dict = {"_id": {"$in": [str(aid) for aid in article_ids]}}
        if category:
            mongo_filter["category_id"] = category
        if source:
            mongo_filter["source"] = source
        if date_from or date_to:
            date_filter: dict = {}
            if date_from:
                date_filter["$gte"] = date_from
            if date_to:
                date_filter["$lte"] = date_to
            mongo_filter["published_at"] = date_filter

        rows = await db.find(
            "articles",
            mongo_filter,
            projection={
                "title": 1, "slug": 1, "description": 1, "source": 1,
                "category_id": 1, "country_id": 1, "published_at": 1,
            },
            limit=limit,
        )

        if rows:
            return _attach_scores(rows, score_map, limit)
    except Exception as e:
        print(f"[SEARCH] MongoDB fetch failed, trying D1: {e}")

    # Fallback: D1 edge cache
    try:
        placeholders = ",".join("?" for _ in article_ids)
        sql = f"""
            SELECT id, slug, title, description, source, category, published_at
            FROM articles
            WHERE id IN ({placeholders})
        """
        params = list(article_ids)

        if category:
            sql += " AND category = ?"
            params.append(category)
        if source:
            sql += " AND source = ?"
            params.append(source)
        if date_from:
            sql += " AND published_at >= ?"
            params.append(date_from)
        if date_to:
            sql += " AND published_at <= ?"
            params.append(date_to)

        sql += f" LIMIT {int(limit)}"

        result = await env.EDGE_CACHE_DB.prepare(sql).bind(*params).all()
        rows = result.results if hasattr(result, "results") else []
        return _attach_scores(list(rows), score_map, limit)

    except Exception as e:
        print(f"[SEARCH] D1 edge cache query also failed: {e}")
        return []


def _attach_scores(rows: list, score_map: dict, limit: int) -> list[dict]:
    """Attach vector scores to articles and sort by score descending."""
    articles = []
    for row in rows:
        row_dict = dict(row) if not isinstance(row, dict) else row
        article_id = row_dict.get("_id") or row_dict.get("id")
        row_dict["score"] = score_map.get(f"article_{article_id}", score_map.get(str(article_id), 0))
        articles.append(row_dict)
    articles.sort(key=lambda a: a.get("score", 0), reverse=True)
    return articles[:limit]


async def _keyword_search(
    query: str,
    category: str | None,
    source: str | None,
    date_from: str | None,
    date_to: str | None,
    limit: int,
    env,
) -> list[dict]:
    """Fallback keyword search using D1 edge cache SQL LIKE."""
    try:
        sql = """
            SELECT id, slug, title, description, source, category, published_at
            FROM articles
            WHERE (title LIKE ? OR description LIKE ?)
        """
        like_param = f"%{query}%"
        params = [like_param, like_param]

        if category:
            sql += " AND category = ?"
            params.append(category)
        if source:
            sql += " AND source = ?"
            params.append(source)
        if date_from:
            sql += " AND published_at >= ?"
            params.append(date_from)
        if date_to:
            sql += " AND published_at <= ?"
            params.append(date_to)

        sql += f" ORDER BY published_at DESC LIMIT {int(limit)}"

        result = await env.EDGE_CACHE_DB.prepare(sql).bind(*params).all()
        rows = result.results if hasattr(result, "results") else []

        return [
            {**(dict(r) if not isinstance(r, dict) else r), "score": 1.0}
            for r in rows
        ]

    except Exception as e:
        print(f"[SEARCH] Keyword search failed: {e}")
        return []


async def _generate_insights(query: str, results: list[dict], env) -> list[dict]:
    """Generate AI insights about search results using Claude."""
    try:
        client = AnthropicClient(env)
        titles = [r.get("title", "") for r in results[:5]]

        prompt = f"""Based on these search results for "{query}", provide a brief insight.

Results:
{chr(10).join(f'- {t}' for t in titles)}

Return JSON: {{"type": "summary", "content": "brief insight text", "confidence": 0.8}}"""

        parsed = await client.extract_json(prompt, max_tokens=200)
        if parsed:
            return [parsed]
        return []

    except Exception as e:
        print(f"[SEARCH] Insight generation failed: {e}")
        return []

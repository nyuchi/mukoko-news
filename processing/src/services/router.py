"""
Request router — maps Service Binding fetch calls to service handlers.

The main TS Worker calls us like:
  env.DATA_PROCESSOR.fetch("http://news-api/rss/parse", { method: "POST", body: ... })

We parse the path and dispatch to the right service.
"""

import json
from workers import Response


async def handle_request(request, env):
    """Route incoming Service Binding requests to the appropriate service."""

    url = request.url
    # Extract path from full URL (e.g. "http://processing/rss/parse" -> "/rss/parse")
    path = "/" + url.split("/", 3)[-1] if "/" in url else "/"
    method = request.method

    try:
        # ---------------------------------------------------------------
        # Health
        # ---------------------------------------------------------------
        if path == "/health":
            return _json({"status": "ok", "service": "mukoko-news-api"})

        # ---------------------------------------------------------------
        # RSS parsing
        # ---------------------------------------------------------------
        if path == "/rss/parse" and method == "POST":
            from services.rss_parser import parse_rss_feed
            body = await _body(request)
            result = await parse_rss_feed(
                xml_content=body.get("xml", ""),
                source=body.get("source", {}),
                env=env,
            )
            return _json(result)

        # ---------------------------------------------------------------
        # Content cleaning
        # ---------------------------------------------------------------
        if path == "/content/clean" and method == "POST":
            from services.content_cleaner import clean_html_content
            body = await _body(request)
            result = clean_html_content(
                raw_html=body.get("html", ""),
                options=body.get("options", {}),
            )
            return _json(result)

        # ---------------------------------------------------------------
        # Full article AI processing pipeline
        # ---------------------------------------------------------------
        if path == "/content/process" and method == "POST":
            from services.article_ai import process_article
            body = await _body(request)
            result = await process_article(body, env)
            return _json(result)

        # ---------------------------------------------------------------
        # Keyword extraction
        # ---------------------------------------------------------------
        if path == "/keywords/extract" and method == "POST":
            from services.keyword_extractor import extract_keywords
            body = await _body(request)
            result = await extract_keywords(
                title=body.get("title", ""),
                content=body.get("content", ""),
                existing_category=body.get("category"),
                country_id=body.get("country_id"),
                env=env,
            )
            return _json(result)

        # ---------------------------------------------------------------
        # Quality scoring
        # ---------------------------------------------------------------
        if path == "/quality/score" and method == "POST":
            from services.quality_scorer import score_quality
            body = await _body(request)
            result = score_quality(
                content=body.get("content", ""),
                title=body.get("title", ""),
            )
            return _json(result)

        # ---------------------------------------------------------------
        # Article clustering
        # ---------------------------------------------------------------
        if path == "/clustering/cluster" and method == "POST":
            from services.clustering import cluster_articles
            body = await _body(request)
            result = await cluster_articles(
                articles=body.get("articles", []),
                config=body.get("config", {}),
                env=env,
            )
            return _json(result)

        # ---------------------------------------------------------------
        # Semantic search
        # ---------------------------------------------------------------
        if path == "/search/query" and method == "POST":
            from services.search_processor import semantic_search
            body = await _body(request)
            result = await semantic_search(
                query=body.get("query", ""),
                options=body.get("options", {}),
                env=env,
            )
            return _json(result)

        if path == "/search/trending" and method == "GET":
            from services.search_processor import get_trending_topics
            result = await get_trending_topics(env=env)
            return _json(result)

        # ---------------------------------------------------------------
        # Feed ranking
        # ---------------------------------------------------------------
        if path == "/feed/rank" and method == "POST":
            from services.feed_ranker import rank_feed
            body = await _body(request)
            result = await rank_feed(
                articles=body.get("articles", []),
                preferences=body.get("preferences", {}),
            )
            return _json(result)

        # ---------------------------------------------------------------
        # Content scraping (web page extraction)
        # ---------------------------------------------------------------
        if path == "/content/scrape" and method == "POST":
            from services.content_extractor import scrape_article
            body = await _body(request)
            result = await scrape_article(
                url=body.get("url", ""),
                env=env,
            )
            return _json(result)

        # ---------------------------------------------------------------
        # Feed collection (manual trigger for RSS batch pipeline)
        # ---------------------------------------------------------------
        if path == "/feed/collect" and method == "POST":
            from services.feed_collector import collect_feeds
            result = await collect_feeds(env)
            return _json(result)

        # ---------------------------------------------------------------
        # Trending topics
        # ---------------------------------------------------------------
        if path == "/trending" and method == "GET":
            from services.trending import get_trending
            result = await get_trending(env)
            return _json(result)

        if path.startswith("/trending/") and method == "GET":
            import re
            from services.trending import get_trending
            country = path.split("/")[-1].upper()
            if not re.fullmatch(r"[A-Z]{2}", country):
                return _json({"error": "Invalid country code"}, status=400)
            result = await get_trending(env, country_id=country)
            return _json(result)

        # ---------------------------------------------------------------
        # Analytics & insights (MongoDB aggregation)
        # ---------------------------------------------------------------
        if path == "/analytics/stats" and method == "GET":
            from services.analytics import get_enhanced_stats
            result = await get_enhanced_stats(env)
            return _json(result)

        if path == "/analytics/trending-categories" and method == "GET":
            from services.analytics import get_trending_categories
            result = await get_trending_categories(env)
            return _json(result)

        if path == "/analytics/insights" and method == "POST":
            from services.analytics import get_content_insights
            body = await _body(request)
            result = await get_content_insights(
                env,
                country_id=body.get("country_id"),
            )
            return _json(result)

        # ---------------------------------------------------------------
        # Source health
        # ---------------------------------------------------------------
        if path == "/sources/health" and method == "GET":
            from services.source_health import get_source_health_summary
            result = await get_source_health_summary(env)
            return _json(result)

        # ---------------------------------------------------------------
        # 404
        # ---------------------------------------------------------------
        return _json({"error": "Not found", "path": path}, status=404)

    except Exception as e:
        print(f"[NEWS-API] Error handling {method} {path}: {e}")
        return _json({"error": str(e)}, status=500)


async def _body(request) -> dict:
    """Parse JSON body from request."""
    try:
        text = await request.text()
        return json.loads(text) if text else {}
    except (json.JSONDecodeError, Exception):
        return {}


def _json(data: dict, status: int = 200) -> Response:
    """Return a JSON response."""
    return Response(
        json.dumps(data, default=str),
        headers={"Content-Type": "application/json"},
        status=status,
    )

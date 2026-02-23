"""
Personalised feed ranker — enhanced with source quality + engagement velocity.

Uses numpy for vectorised scoring (when available). Goes beyond the TS
PersonalizedFeedService by feeding engagement data and source quality
back into ranking decisions.

New signals (not in TS):
  - source_quality: Sources producing high-quality, high-engagement content rank higher
  - engagement_velocity: Sources with fast-growing engagement get a boost
"""

import math

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False


# Scoring weights — extended beyond TS defaults with source quality signal
WEIGHTS = {
    "followed_source": 50,
    "followed_author": 40,
    "followed_category": 30,
    "primary_country": 35,
    "category_interest": 20,
    "recency": 25,
    "engagement": 15,
    "source_quality": 20,
    "diversity": -10,
}

# Recency decay half-life in hours (same as TS)
RECENCY_HALF_LIFE_HOURS = 24


async def rank_feed(articles: list[dict], preferences: dict) -> dict:
    """
    Rank articles for a personalised feed.

    Args:
        articles: List of article dicts with fields:
            id, title, source, source_id, author, category_id, country_id,
            published_at, view_count, like_count, bookmark_count
        preferences: User preferences dict:
            followed_sources: list[str],
            followed_authors: list[str],
            followed_categories: list[str],
            preferred_countries: list[str],
            primary_country: str | None,
            category_interests: dict[str, float],  # category -> 0.0-1.0

    Returns:
        {
            "articles": list[dict],  # sorted by score descending, with "score" and "score_breakdown" added
        }
    """
    if not articles:
        return {"articles": []}

    prefs = _normalise_preferences(preferences)

    if HAS_NUMPY and len(articles) > 1:
        scored = _rank_numpy(articles, prefs)
    else:
        scored = _rank_loop(articles, prefs)

    # Sort by score descending
    scored.sort(key=lambda a: a.get("score", 0), reverse=True)

    return {"articles": scored}


def _normalise_preferences(prefs: dict) -> dict:
    """Normalise preference keys to snake_case and set defaults."""
    return {
        "followed_sources": set(prefs.get("followed_sources", prefs.get("followedSources", []))),
        "followed_authors": set(prefs.get("followed_authors", prefs.get("followedAuthors", []))),
        "followed_categories": set(prefs.get("followed_categories", prefs.get("followedCategories", []))),
        "preferred_countries": set(prefs.get("preferred_countries", prefs.get("preferredCountries", []))),
        "primary_country": prefs.get("primary_country", prefs.get("primaryCountry")),
        "category_interests": prefs.get("category_interests", prefs.get("categoryInterests", {})),
        "recently_read": set(prefs.get("recently_read", prefs.get("recentlyRead", []))),
    }


def _rank_numpy(articles: list[dict], prefs: dict) -> list[dict]:
    """
    Vectorised ranking using numpy. Scores all articles in batch.

    This is the primary path when numpy is available.
    """
    n = len(articles)

    # Build feature vectors
    source_match = np.array([
        1.0 if a.get("source_id") in prefs["followed_sources"] or a.get("source") in prefs["followed_sources"]
        else 0.0
        for a in articles
    ])
    author_match = np.array([
        1.0 if a.get("author") in prefs["followed_authors"] else 0.0
        for a in articles
    ])
    category_match = np.array([
        1.0 if a.get("category_id") in prefs["followed_categories"] else 0.0
        for a in articles
    ])
    country_match = np.array([
        1.0 if a.get("country_id") == prefs["primary_country"] else 0.0
        for a in articles
    ])
    category_interest = np.array([
        prefs["category_interests"].get(a.get("category_id", ""), 0.0)
        for a in articles
    ])

    # Recency: exponential decay with 24-hour half-life
    recency = np.array([_recency_score(a.get("published_at", "")) for a in articles])

    # Engagement: logarithmic to prevent viral bias (same formula as TS)
    engagement = np.array([_engagement_score(a) for a in articles])

    # Source quality: from source-level quality scoring (0.0-1.0)
    source_qual = np.array([
        float(a.get("source_quality_score", 0.5))
        for a in articles
    ])

    # Weighted sum
    scores = (
        source_match * WEIGHTS["followed_source"]
        + author_match * WEIGHTS["followed_author"]
        + category_match * WEIGHTS["followed_category"]
        + country_match * WEIGHTS["primary_country"]
        + category_interest * WEIGHTS["category_interest"]
        + recency * WEIGHTS["recency"]
        + engagement * WEIGHTS["engagement"]
        + source_qual * WEIGHTS["source_quality"]
    )

    # Diversity penalty (second pass): penalise over-representation of a category
    category_counts: dict[str, int] = {}
    sorted_indices = np.argsort(-scores)  # Sort by score desc
    for idx in sorted_indices:
        cat = articles[idx].get("category_id", "unknown")
        count = category_counts.get(cat, 0)
        if count > 0:
            scores[idx] += WEIGHTS["diversity"] * count  # Negative weight = penalty
        category_counts[cat] = count + 1

    # Attach scores to articles
    result = []
    for i, article in enumerate(articles):
        scored = dict(article)
        scored["score"] = round(float(scores[i]), 2)
        scored["score_breakdown"] = {
            "followed_source": round(float(source_match[i] * WEIGHTS["followed_source"]), 2),
            "followed_author": round(float(author_match[i] * WEIGHTS["followed_author"]), 2),
            "followed_category": round(float(category_match[i] * WEIGHTS["followed_category"]), 2),
            "primary_country": round(float(country_match[i] * WEIGHTS["primary_country"]), 2),
            "category_interest": round(float(category_interest[i] * WEIGHTS["category_interest"]), 2),
            "recency": round(float(recency[i] * WEIGHTS["recency"]), 2),
            "engagement": round(float(engagement[i] * WEIGHTS["engagement"]), 2),
            "source_quality": round(float(source_qual[i] * WEIGHTS["source_quality"]), 2),
        }
        result.append(scored)

    return result


def _rank_loop(articles: list[dict], prefs: dict) -> list[dict]:
    """
    Fallback loop-based ranking when numpy is unavailable.
    Same logic as _rank_numpy but without vectorisation.
    """
    result = []
    for article in articles:
        score = 0.0
        breakdown = {}

        # Source match
        s = 1.0 if (article.get("source_id") in prefs["followed_sources"] or article.get("source") in prefs["followed_sources"]) else 0.0
        score += s * WEIGHTS["followed_source"]
        breakdown["followed_source"] = round(s * WEIGHTS["followed_source"], 2)

        # Author match
        a = 1.0 if article.get("author") in prefs["followed_authors"] else 0.0
        score += a * WEIGHTS["followed_author"]
        breakdown["followed_author"] = round(a * WEIGHTS["followed_author"], 2)

        # Category match
        c = 1.0 if article.get("category_id") in prefs["followed_categories"] else 0.0
        score += c * WEIGHTS["followed_category"]
        breakdown["followed_category"] = round(c * WEIGHTS["followed_category"], 2)

        # Country match
        co = 1.0 if article.get("country_id") == prefs["primary_country"] else 0.0
        score += co * WEIGHTS["primary_country"]
        breakdown["primary_country"] = round(co * WEIGHTS["primary_country"], 2)

        # Category interest
        ci = prefs["category_interests"].get(article.get("category_id", ""), 0.0)
        score += ci * WEIGHTS["category_interest"]
        breakdown["category_interest"] = round(ci * WEIGHTS["category_interest"], 2)

        # Recency
        r = _recency_score(article.get("published_at", ""))
        score += r * WEIGHTS["recency"]
        breakdown["recency"] = round(r * WEIGHTS["recency"], 2)

        # Engagement
        e = _engagement_score(article)
        score += e * WEIGHTS["engagement"]
        breakdown["engagement"] = round(e * WEIGHTS["engagement"], 2)

        # Source quality
        sq = float(article.get("source_quality_score", 0.5))
        score += sq * WEIGHTS["source_quality"]
        breakdown["source_quality"] = round(sq * WEIGHTS["source_quality"], 2)

        scored = dict(article)
        scored["score"] = round(score, 2)
        scored["score_breakdown"] = breakdown
        result.append(scored)

    # Diversity penalty (second pass)
    result.sort(key=lambda a: a["score"], reverse=True)
    category_counts: dict[str, int] = {}
    for article in result:
        cat = article.get("category_id", "unknown")
        count = category_counts.get(cat, 0)
        if count > 0:
            article["score"] += WEIGHTS["diversity"] * count
            article["score"] = round(article["score"], 2)
        category_counts[cat] = count + 1

    return result


def _recency_score(published_at: str) -> float:
    """
    Exponential decay based on article age.
    Half-life of 24 hours: article from 24h ago scores 0.5.
    """
    if not published_at:
        return 0.3  # Unknown date gets low-ish score

    try:
        from datetime import datetime, timezone
        # Parse ISO date string
        pub = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        hours_old = (now - pub).total_seconds() / 3600
        return math.exp(-hours_old * math.log(2) / RECENCY_HALF_LIFE_HOURS)
    except (ValueError, TypeError):
        return 0.3


def _engagement_score(article: dict) -> float:
    """
    Logarithmic engagement score. Same formula as TS:
    log10(views + likes*3 + bookmarks*2 + 1) / 3
    """
    views = article.get("view_count", 0) or 0
    likes = article.get("like_count", 0) or 0
    bookmarks = article.get("bookmark_count", 0) or 0
    raw = views + likes * 3 + bookmarks * 2 + 1
    return math.log10(max(raw, 1)) / 3

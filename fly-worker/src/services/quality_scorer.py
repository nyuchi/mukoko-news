"""Deterministic article quality scoring using textstat.

No AI calls — purely algorithmic based on content characteristics.
"""

import textstat


def score_article(article: dict) -> dict:
    """Score article quality based on content characteristics.

    Returns dict with quality_score (0-100) and component scores.
    """
    text = article.get("article_body", "") or article.get("description", "") or ""
    headline = article.get("headline", "")

    scores = {
        "content_length": _score_content_length(text),
        "readability": _score_readability(text),
        "headline_quality": _score_headline(headline),
        "has_image": 10.0 if article.get("image") else 0.0,
        "has_author": 5.0 if article.get("author_name") else 0.0,
    }

    # Weighted sum (out of 100)
    weights = {
        "content_length": 0.30,
        "readability": 0.30,
        "headline_quality": 0.20,
        "has_image": 0.10,
        "has_author": 0.10,
    }

    quality_score = sum(scores[k] * weights[k] for k in weights)

    return {
        "quality_score": round(min(100.0, max(0.0, quality_score)), 2),
        "components": scores,
    }


def _score_content_length(text: str) -> float:
    """Score based on article length. Sweet spot: 300-2000 words."""
    if not text:
        return 0.0

    word_count = len(text.split())

    if word_count < 50:
        return 10.0
    elif word_count < 150:
        return 30.0
    elif word_count < 300:
        return 60.0
    elif word_count <= 2000:
        return 100.0
    elif word_count <= 5000:
        return 80.0
    else:
        return 60.0


def _score_readability(text: str) -> float:
    """Score readability using Flesch Reading Ease."""
    if not text or len(text.split()) < 20:
        return 50.0

    try:
        flesch = textstat.flesch_reading_ease(text)
        # Flesch: 0-30 = very hard, 60-70 = standard, 90-100 = very easy
        # For news, 50-70 is ideal
        if 50 <= flesch <= 70:
            return 100.0
        elif 30 <= flesch < 50:
            return 70.0
        elif 70 < flesch <= 90:
            return 80.0
        elif flesch > 90:
            return 60.0
        else:
            return 40.0
    except Exception:
        return 50.0


def _score_headline(headline: str) -> float:
    """Score headline quality based on length and characteristics."""
    if not headline:
        return 0.0

    word_count = len(headline.split())

    # Ideal headline: 6-15 words
    if word_count < 3:
        return 20.0
    elif word_count < 6:
        return 60.0
    elif word_count <= 15:
        return 100.0
    elif word_count <= 20:
        return 70.0
    else:
        return 40.0

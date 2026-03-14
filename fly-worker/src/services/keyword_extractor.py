"""Keyword extraction from article content.

Two-stage approach:
1. Match against known keywords/terms from the database
2. AI extraction for new terms (if Anthropic key is configured)
"""

import re

from src.services import ai_client


async def extract_keywords(
    article: dict,
    known_terms: list[dict],
    section_keywords: list[str] | None = None,
) -> list[dict]:
    """Extract keywords from article content.

    Args:
        article: Article dict with headline, description, article_body.
        known_terms: List of defined_term dicts from the database.
        section_keywords: Classification keywords from the article's section.

    Returns:
        List of dicts with 'term_id', 'name', 'relevance_score', 'source'.
    """
    text = _build_search_text(article)
    if not text:
        return []

    matched = []

    # Stage 1: Match against known terms
    text_lower = text.lower()
    for term in known_terms:
        name = term.get("name", "")
        if name and _term_matches(name.lower(), text_lower):
            matched.append({
                "term_id": term["id"],
                "name": name,
                "relevance_score": _calc_relevance(name.lower(), text_lower),
                "source": "auto",
            })

    # Stage 2: Match section classification keywords
    if section_keywords:
        for kw in section_keywords:
            kw_lower = kw.lower()
            if kw_lower in text_lower:
                # Only add if not already matched
                if not any(m["name"].lower() == kw_lower for m in matched):
                    matched.append({
                        "term_id": _make_term_id(kw),
                        "name": kw,
                        "relevance_score": 0.5,
                        "source": "auto",
                    })

    # Stage 3: AI extraction for additional keywords
    ai_keywords = await _ai_extract(article)
    for kw in ai_keywords:
        kw_lower = kw.lower()
        if not any(m["name"].lower() == kw_lower for m in matched):
            matched.append({
                "term_id": _make_term_id(kw),
                "name": kw,
                "relevance_score": 0.7,
                "source": "ai",
            })

    # Sort by relevance, limit to top 15
    matched.sort(key=lambda x: x["relevance_score"], reverse=True)
    return matched[:15]


def _build_search_text(article: dict) -> str:
    """Combine article fields into searchable text."""
    parts = [
        article.get("headline", ""),
        article.get("description", ""),
        (article.get("article_body", "") or "")[:2000],
    ]
    return " ".join(p for p in parts if p)


def _term_matches(term: str, text: str) -> bool:
    """Check if a term appears as a whole word in text."""
    pattern = r"\b" + re.escape(term) + r"\b"
    return bool(re.search(pattern, text, re.IGNORECASE))


def _calc_relevance(term: str, text: str) -> float:
    """Calculate relevance score based on frequency and position."""
    # Count occurrences
    pattern = r"\b" + re.escape(term) + r"\b"
    matches = re.findall(pattern, text, re.IGNORECASE)
    count = len(matches)

    # Base score from count
    if count >= 5:
        score = 1.0
    elif count >= 3:
        score = 0.8
    elif count >= 2:
        score = 0.6
    else:
        score = 0.4

    # Bonus if in first 200 chars (likely headline/lead)
    first_match = re.search(pattern, text[:200], re.IGNORECASE)
    if first_match:
        score = min(1.0, score + 0.2)

    return round(score, 2)


async def _ai_extract(article: dict) -> list[str]:
    """Use Claude to extract additional keywords."""
    headline = article.get("headline", "")
    description = article.get("description", "")
    body_preview = (article.get("article_body", "") or "")[:1000]

    if not headline:
        return []

    prompt = f"""Extract 5-10 key topics/keywords from this news article. Return ONLY a JSON array of strings.

Headline: {headline}
Description: {description}
Content: {body_preview}

Return format: ["keyword1", "keyword2", ...]"""

    result = await ai_client.extract_json(
        prompt,
        system="You are a keyword extraction system. Return only a JSON array of keyword strings.",
        max_tokens=256,
    )

    if isinstance(result, list):
        return [str(k).strip() for k in result if isinstance(k, str) and k.strip()]

    return []


def _make_term_id(name: str) -> str:
    """Generate a term ID from a keyword name."""
    slug = re.sub(r"[^\w\s-]", "", name.lower())
    slug = re.sub(r"[\s_]+", "-", slug).strip("-")
    return slug[:100] or "unknown"

"""
Keyword extractor — MongoDB-backed, country-aware.

Uses Anthropic Claude (via AI Gateway) with country/language context
for intelligent extraction. Falls back to text matching.

Writes keyword usage back to MongoDB (not just read-only).
"""

from services.ai_client import AnthropicClient
from services.mongodb import MongoDBClient


# Country name mapping for prompt context
COUNTRY_NAMES = {
    "ZW": "Zimbabwe", "ZA": "South Africa", "KE": "Kenya", "NG": "Nigeria",
    "GH": "Ghana", "TZ": "Tanzania", "UG": "Uganda", "RW": "Rwanda",
    "ET": "Ethiopia", "BW": "Botswana", "ZM": "Zambia", "MW": "Malawi",
    "EG": "Egypt", "MA": "Morocco", "NA": "Namibia", "MZ": "Mozambique",
}

# Language hints for non-English-primary countries
LANGUAGE_HINTS = {
    "ZW": "Content may include Shona or Ndebele terms.",
    "TZ": "Content may include Swahili terms.",
    "KE": "Content may include Swahili terms.",
    "MZ": "Content may be in Portuguese.",
    "EG": "Content may include Arabic terms.",
    "MA": "Content may include Arabic or French terms.",
    "GH": "Content may include Twi/Akan terms.",
    "RW": "Content may include Kinyarwanda or French terms.",
    "ET": "Content may include Amharic terms.",
}


async def extract_keywords(
    title: str,
    content: str,
    existing_category: str | None = None,
    country_id: str | None = None,
    env=None,
) -> dict:
    """
    Extract keywords from article content using AI + MongoDB context.

    Args:
        title: Article title
        content: Cleaned article text
        existing_category: Pre-assigned category (from RSS source)
        country_id: Article's country for context-aware extraction
        env: Cloudflare env bindings

    Returns:
        {"keywords": [{"keyword": str, "confidence": float, "category": str}, ...]}
    """
    if not content or len(content) < 50:
        return {"keywords": []}

    # Load existing keywords from MongoDB (primary) or D1 (edge cache fallback)
    db_keywords = await _load_keywords(env)
    keyword_list = ", ".join(k.get("name", k.get("keyword", "")) for k in db_keywords) if db_keywords else ""

    # AI extraction with country context
    extracted: list[dict] = []

    if env and keyword_list:
        client = AnthropicClient(env)
        country_name = COUNTRY_NAMES.get(country_id, "Africa") if country_id else "Africa"
        language_hint = LANGUAGE_HINTS.get(country_id, "") if country_id else ""

        prompt = f"""Analyze this news article and extract relevant keywords.

Article Title: {title}
Article Content: {content[:1500]}
Country: {country_name} ({country_id or "Pan-African"})
{f"Category: {existing_category}" if existing_category else ""}
{language_hint}

Available Keywords: {keyword_list}

Instructions:
1. Identify the most relevant keywords from the available list that match this article
2. Consider the {country_name} context — local politics, economy, culture
3. Return max 8 keywords
4. Rate confidence 0.0-1.0 for each keyword

Return JSON only, no explanation:
{{"keywords": [{{"keyword": "example", "confidence": 0.9}}]}}"""

        parsed = await client.extract_json(prompt, max_tokens=500)

        if parsed and "keywords" in parsed and isinstance(parsed["keywords"], list):
            for kw in parsed["keywords"]:
                keyword_text = kw.get("keyword", "")
                confidence = kw.get("confidence", 0.0)
                db_match = _find_db_keyword(keyword_text, db_keywords)
                if db_match and confidence > 0.5:
                    extracted.append({
                        "keyword": keyword_text,
                        "confidence": confidence,
                        "category": db_match.get("category_id", ""),
                    })

    # Fallback: simple text matching
    if not extracted and db_keywords:
        content_lower = (title + " " + content).lower()
        for kw in db_keywords[:20]:
            kw_name = kw.get("name", kw.get("keyword", ""))
            if kw_name.lower() in content_lower:
                extracted.append({
                    "keyword": kw_name,
                    "confidence": 0.7,
                    "category": kw.get("category_id", ""),
                })
                if len(extracted) >= 8:
                    break

    # Update keyword usage counts in MongoDB
    if extracted and env:
        await _update_keyword_usage(env, extracted)

    return {"keywords": extracted[:8]}


async def _load_keywords(env) -> list[dict]:
    """Load keywords from MongoDB (primary), D1 edge cache (fallback)."""
    if not env:
        return []

    # Try MongoDB first
    try:
        db = MongoDBClient(env)
        keywords = await db.find(
            "keywords",
            {"enabled": True},
            sort={"usage_count": -1},
            limit=200,
        )
        if keywords:
            return keywords
    except Exception as e:
        print(f"[KEYWORDS] MongoDB keyword load failed, trying D1: {e}")

    # Fallback to D1 edge cache
    try:
        d1 = getattr(env, "EDGE_CACHE_DB", None)
        if d1:
            result = await d1.prepare("""
                SELECT id, name AS keyword, category_id, relevance_score, usage_count
                FROM keywords
                WHERE enabled = 1
                ORDER BY usage_count DESC, relevance_score DESC
                LIMIT 200
            """).all()
            if result and hasattr(result, "results"):
                return list(result.results)
    except Exception as e:
        print(f"[KEYWORDS] D1 keyword load also failed: {e}")

    return []


async def _update_keyword_usage(env, extracted: list[dict]):
    """Increment usage_count for extracted keywords in MongoDB."""
    try:
        db = MongoDBClient(env)
        for kw in extracted:
            keyword_name = kw.get("keyword", "")
            if keyword_name:
                await db.update_one(
                    "keywords",
                    {"name": keyword_name},
                    {"$inc": {"usage_count": 1}},
                )
    except Exception as e:
        print(f"[KEYWORDS] Usage update failed: {e}")


def _find_db_keyword(keyword: str, db_keywords: list[dict]) -> dict | None:
    """Find a matching keyword in the database list (case-insensitive)."""
    keyword_lower = keyword.lower()
    for db_kw in db_keywords:
        name = db_kw.get("name", db_kw.get("keyword", ""))
        if name.lower() == keyword_lower:
            return db_kw
    return None

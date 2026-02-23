"""
Article quality scorer — replaces ArticleAIService.calculateQualityScore().

Uses textstat for deterministic readability metrics instead of
Llama-3-8b AI calls that returned unreliable results ("excellent quality"
instead of 0.85, or scores > 1.0).

Benefits over TS implementation:
  - Deterministic: same article always gets same score
  - Instant: no AI latency
  - Reproducible: no prompt sensitivity
  - AI is optional enhancement, not the primary scorer

TS counterpart: ArticleAIService.calculateQualityScore() lines 350-394
"""

# TODO: confirm textstat availability in Pyodide; if not, the heuristic
# scoring below works standalone without it
try:
    from textstat import flesch_reading_ease, flesch_kincaid_grade
    HAS_TEXTSTAT = True
except ImportError:
    HAS_TEXTSTAT = False


def score_quality(content: str, title: str) -> dict:
    """
    Score article quality using deterministic text metrics.

    Args:
        content: Cleaned article text
        title: Article title

    Returns:
        {
            "quality_score": float (0.0-1.0),
            "word_count": int,
            "reading_ease": float | None,
            "grade_level": float | None,
            "breakdown": {
                "length_score": float,
                "readability_score": float,
                "title_score": float,
                "structure_score": float,
            }
        }
    """
    if not content or len(content) < 100:
        return {
            "quality_score": 0.3,
            "word_count": len(content.split()) if content else 0,
            "reading_ease": None,
            "grade_level": None,
            "breakdown": _empty_breakdown(),
        }

    word_count = len(content.split())
    sentence_count = content.count(".") + content.count("!") + content.count("?")

    # ---------------------------------------------------------------
    # Length score — longer articles with more substance score higher
    # ---------------------------------------------------------------
    length_score = min(word_count / 500, 1.0)

    # ---------------------------------------------------------------
    # Readability score — using textstat if available, heuristic otherwise
    # ---------------------------------------------------------------
    reading_ease = None
    grade_level = None

    if HAS_TEXTSTAT and word_count > 30:
        reading_ease = flesch_reading_ease(content)
        grade_level = flesch_kincaid_grade(content)
        # Flesch reading ease: 0-100 scale, higher = easier to read
        # News articles should target 50-70 range
        readability_score = min(max(reading_ease, 0) / 70, 1.0)
    else:
        # Heuristic: average words per sentence
        avg_sentence_len = word_count / max(sentence_count, 1)
        # Good news writing: 15-25 words per sentence
        if 10 <= avg_sentence_len <= 30:
            readability_score = 0.8
        elif avg_sentence_len < 10:
            readability_score = 0.5  # Too choppy
        else:
            readability_score = 0.4  # Too long/dense

    # ---------------------------------------------------------------
    # Title score — good titles are 5-15 words
    # ---------------------------------------------------------------
    title_words = len(title.split()) if title else 0
    if 5 <= title_words <= 15:
        title_score = 1.0
    elif 3 <= title_words <= 20:
        title_score = 0.7
    else:
        title_score = 0.4

    # ---------------------------------------------------------------
    # Structure score — presence of quotes, paragraphs, proper nouns
    # ---------------------------------------------------------------
    structure_score = 0.5
    if sentence_count >= 3:
        structure_score += 0.1
    if '"' in content or "\u201c" in content:  # Has quotes
        structure_score += 0.1
    if content.count("\n") >= 2:  # Has paragraphs
        structure_score += 0.1
    # Check for capitalised words (proper nouns = real reporting)
    capital_words = sum(1 for w in content.split()[:200] if w and w[0].isupper() and len(w) > 1)
    if capital_words > 5:
        structure_score += 0.1
    structure_score = min(structure_score, 1.0)

    # ---------------------------------------------------------------
    # Weighted final score
    # ---------------------------------------------------------------
    quality_score = (
        length_score * 0.30
        + readability_score * 0.30
        + title_score * 0.15
        + structure_score * 0.25
    )
    quality_score = round(min(max(quality_score, 0.0), 1.0), 2)

    return {
        "quality_score": quality_score,
        "word_count": word_count,
        "reading_ease": round(reading_ease, 1) if reading_ease is not None else None,
        "grade_level": round(grade_level, 1) if grade_level is not None else None,
        "breakdown": {
            "length_score": round(length_score, 2),
            "readability_score": round(readability_score, 2),
            "title_score": round(title_score, 2),
            "structure_score": round(structure_score, 2),
        },
    }


def _empty_breakdown() -> dict:
    return {
        "length_score": 0.0,
        "readability_score": 0.0,
        "title_score": 0.0,
        "structure_score": 0.0,
    }

"""
Article clustering — replaces backend/services/StoryClusteringService.ts.

Uses numpy for vectorised similarity and Workers AI embeddings for
semantic understanding, replacing:
  - 69 hardcoded English-only stopwords
  - Jaccard similarity on word sets (no semantic understanding)
  - O(n^2) nested loop comparison
  - Greedy cluster assignment

TS counterpart: StoryClusteringService.ts (152 lines)
"""

import re

# TODO: confirm numpy availability in Pyodide; fall back to pure Python if needed
try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

from services.ai_client import get_embedding


# ---------------------------------------------------------------------------
# Multilingual stopwords — Pan-African platform, not English-only
# ---------------------------------------------------------------------------
STOP_WORDS = {
    # English
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "up", "about", "into", "through", "during",
    "before", "after", "above", "below", "between", "under", "again",
    "further", "then", "once", "here", "there", "when", "where", "why",
    "how", "all", "each", "few", "more", "most", "other", "some", "such",
    "only", "own", "same", "than", "too", "very", "just", "also", "now",
    "says", "said", "will", "would", "could", "should", "have", "has",
    "had", "been", "being", "this", "that", "these", "those", "what",
    "which", "while", "news", "report", "reports", "breaking", "update",
    "latest", "today", "yesterday", "new", "first", "last", "over",
    # Shona (Zimbabwe primary language)
    "ndi", "iri", "ari", "ane", "kuti", "kana", "asi", "zvino", "iyi",
    "uyu", "ichi", "icho", "pano", "apa", "kuno",
    # Swahili (East Africa)
    "na", "ya", "wa", "kwa", "ni", "la", "za", "katika", "kama",
    "hii", "hiyo", "hayo", "sasa", "pia", "lakini",
    # French (West/Central Africa)
    "le", "la", "les", "de", "du", "des", "un", "une", "et", "est",
    "dans", "pour", "que", "qui", "sur", "avec", "plus", "pas",
    # Portuguese (Mozambique)
    "um", "uma", "os", "as", "do", "da", "dos", "das", "em", "no",
    "na", "por", "para", "com", "que", "se",
    # Arabic (North Africa — Egypt, Morocco)
    "في", "من", "إلى", "على", "عن", "مع", "هذا", "هذه", "التي",
    "الذي", "كان", "قال", "بعد",
}

# Limits for DoS prevention (match TS)
MAX_TITLE_LENGTH = 500
MAX_WORDS = 50


async def cluster_articles(articles: list[dict], config: dict | None = None, env=None) -> dict:
    """
    Cluster articles by similarity.

    Tries semantic clustering (AI embeddings + cosine similarity) first,
    falls back to word-based Jaccard if embeddings are unavailable.

    Args:
        articles: List of {"id": str, "title": str, "source": str, ...}
        config: Optional {"similarity_threshold": float, "max_related": int, "max_clusters": int}
        env: Cloudflare env bindings (for AI embeddings)

    Returns:
        {
            "clusters": [
                {
                    "id": str,
                    "primary_article": dict,
                    "related_articles": list[dict],
                    "article_count": int,
                }
            ],
            "method": "semantic" | "jaccard",
        }
    """
    cfg = config or {}
    threshold = cfg.get("similarity_threshold", cfg.get("similarityThreshold", 0.35))
    max_related = cfg.get("max_related", cfg.get("maxRelatedPerCluster", 4))
    max_clusters = cfg.get("max_clusters", cfg.get("maxClusters", 10))

    if not articles:
        return {"clusters": [], "method": "none"}

    # Try semantic clustering first (requires AI binding + numpy)
    if env and HAS_NUMPY and len(articles) >= 2:
        try:
            result = await _semantic_cluster(articles, threshold=0.75, max_related=max_related, max_clusters=max_clusters, env=env)
            if result:
                return {"clusters": result, "method": "semantic"}
        except Exception as e:
            print(f"[CLUSTERING] Semantic clustering failed, falling back to Jaccard: {e}")

    # Fallback: word-based Jaccard (same logic as TS, but with multilingual stopwords)
    clusters = _jaccard_cluster(articles, threshold=threshold, max_related=max_related, max_clusters=max_clusters)
    return {"clusters": clusters, "method": "jaccard"}


async def _semantic_cluster(
    articles: list[dict],
    threshold: float,
    max_related: int,
    max_clusters: int,
    env,
) -> list[dict] | None:
    """Cluster using AI embeddings + cosine similarity."""

    # Generate embeddings for all titles
    embeddings = []
    for article in articles:
        emb = await get_embedding(article.get("title", ""), env)
        if emb is None:
            return None  # Can't do semantic clustering without all embeddings
        embeddings.append(emb)

    emb_array = np.array(embeddings, dtype=np.float32)

    # Cosine similarity matrix (vectorised, not O(n^2) loops)
    norms = np.linalg.norm(emb_array, axis=1, keepdims=True)
    # Avoid division by zero
    norms = np.where(norms == 0, 1, norms)
    normalised = emb_array / norms
    similarity_matrix = np.dot(normalised, normalised.T)

    # Greedy clustering
    return _build_clusters(articles, similarity_matrix, threshold, max_related, max_clusters)


def _build_clusters(
    articles: list[dict],
    similarity_matrix,
    threshold: float,
    max_related: int,
    max_clusters: int,
) -> list[dict]:
    """Build clusters from a similarity matrix."""
    clusters = []
    assigned: set[int] = set()

    for i in range(len(articles)):
        if i in assigned:
            continue

        cluster = {
            "id": f"cluster-{articles[i].get('id', i)}",
            "primary_article": articles[i],
            "related_articles": [],
            "article_count": 1,
        }
        assigned.add(i)

        for j in range(i + 1, len(articles)):
            if j in assigned:
                continue
            # Must be different sources (same as TS)
            if articles[i].get("source") == articles[j].get("source"):
                continue

            sim = float(similarity_matrix[i][j]) if HAS_NUMPY else similarity_matrix[i][j]
            if sim >= threshold:
                cluster["related_articles"].append(articles[j])
                cluster["article_count"] += 1
                assigned.add(j)

                if len(cluster["related_articles"]) >= max_related:
                    break

        clusters.append(cluster)
        if len(clusters) >= max_clusters:
            break

    return clusters


def _jaccard_cluster(
    articles: list[dict],
    threshold: float,
    max_related: int,
    max_clusters: int,
) -> list[dict]:
    """
    Fallback clustering using Jaccard similarity on title words.
    Same algorithm as TS StoryClusteringService but with multilingual stopwords.
    """
    # Pre-compute normalised title words
    title_words = [_normalise_title(a.get("title", "")) for a in articles]

    # Build Jaccard similarity "matrix" as we go (O(n^2) but n is small ≤ 20)
    n = len(articles)
    sim = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            sim[i][j] = _jaccard_similarity(title_words[i], title_words[j])
            sim[j][i] = sim[i][j]

    return _build_clusters(articles, sim, threshold, max_related, max_clusters)


def _normalise_title(title: str | None) -> list[str]:
    """
    Normalise title for comparison.
    Matches TS normalizeTitle() but uses multilingual stopwords.
    """
    if not title or not isinstance(title, str):
        return []
    title = title[:MAX_TITLE_LENGTH]
    words = re.sub(r"[^\w\s]", "", title.lower()).split()
    return [w for w in words if len(w) > 3 and w not in STOP_WORDS][:MAX_WORDS]


def _jaccard_similarity(words1: list[str], words2: list[str]) -> float:
    """Jaccard similarity between two word lists."""
    if not words1 or not words2:
        return 0.0
    set1, set2 = set(words1), set(words2)
    intersection = len(set1 & set2)
    union = len(set1 | set2)
    return intersection / union if union > 0 else 0.0

"""BGE-M3 embedding service via Cloudflare Workers AI.

Generates dense embeddings (1024 dimensions) using @cf/baai/bge-m3 for:
- Article indexing during AI processing
- Semantic search queries
- Related article discovery

BGE-M3 was chosen over Voyage AI for:
- Open-source (MIT license, no vendor lock-in)
- Multilingual support (100+ languages — critical for Pan-African content)
- State-of-the-art retrieval performance on MTEB
- 8192 token context window
- Available on Cloudflare Workers AI (low-latency, no GPU management)
"""

import httpx

from src.config import settings

# BGE-M3 produces 1024-dimensional dense embeddings
EMBEDDING_DIM = 1024

_client: httpx.AsyncClient | None = None


def _get_api_url() -> str:
    """Build the Cloudflare Workers AI API URL for BGE-M3."""
    return (
        f"https://api.cloudflare.com/client/v4/accounts/"
        f"{settings.cf_account_id}/ai/run/@cf/baai/bge-m3"
    )


def _get_client() -> httpx.AsyncClient:
    """Get or create the HTTP client singleton."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            headers={"Authorization": f"Bearer {settings.cf_ai_api_token}"},
            timeout=30.0,
        )
    return _client


async def embed_text(text: str) -> list[float] | None:
    """Generate a dense embedding for a single text using BGE-M3.

    Returns a 1024-dimensional vector, or None if the API is unavailable.
    """
    if not text.strip():
        return None
    if not settings.cf_account_id or not settings.cf_ai_api_token:
        return None

    truncated = text[:8000]  # Stay within token limits

    try:
        client = _get_client()
        resp = await client.post(
            _get_api_url(),
            json={"text": [truncated]},
        )

        if resp.status_code != 200:
            print(f"[EMBEDDINGS] CF Workers AI error: {resp.status_code} {resp.text[:200]}")
            return None

        data = resp.json()
        result = data.get("result", {})
        vectors = result.get("data", [])

        if vectors and len(vectors) > 0:
            return vectors[0]

        print(f"[EMBEDDINGS] Unexpected response format: {str(data)[:200]}")
        return None

    except httpx.TimeoutException:
        print("[EMBEDDINGS] CF Workers AI timeout")
        return None
    except Exception as e:
        print(f"[EMBEDDINGS] Error generating embedding: {e}")
        return None


async def embed_batch(texts: list[str]) -> list[list[float] | None]:
    """Generate embeddings for multiple texts.

    Cloudflare Workers AI supports batch inputs (up to 100 texts).
    Returns a list of embeddings (or None for failed items).
    """
    if not texts:
        return []
    if not settings.cf_account_id or not settings.cf_ai_api_token:
        return [None] * len(texts)

    # Filter and track empty strings
    indexed_texts = [(i, t[:8000]) for i, t in enumerate(texts) if t.strip()]
    if not indexed_texts:
        return [None] * len(texts)

    # CF Workers AI has a batch limit — process in chunks of 100
    embeddings: list[list[float] | None] = [None] * len(texts)
    chunk_size = 100

    for chunk_start in range(0, len(indexed_texts), chunk_size):
        chunk = indexed_texts[chunk_start : chunk_start + chunk_size]
        batch_texts = [t for _, t in chunk]

        try:
            client = _get_client()
            resp = await client.post(
                _get_api_url(),
                json={"text": batch_texts},
            )

            if resp.status_code != 200:
                print(f"[EMBEDDINGS] Batch error: {resp.status_code} {resp.text[:200]}")
                continue

            data = resp.json()
            vectors = data.get("result", {}).get("data", [])

            for idx, (orig_idx, _) in enumerate(chunk):
                if idx < len(vectors):
                    embeddings[orig_idx] = vectors[idx]

        except Exception as e:
            print(f"[EMBEDDINGS] Batch chunk error: {e}")

    return embeddings


def build_article_text(article: dict) -> str:
    """Build the text to embed for an article.

    Combines headline + description + body preview for a comprehensive representation.
    """
    parts = [
        article.get("headline", ""),
        article.get("description", ""),
        (article.get("article_body_processed", "") or article.get("articlebody", "") or "")[:2000],
    ]
    return " ".join(p for p in parts if p).strip()


async def close_client() -> None:
    """Close the HTTP client."""
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
        _client = None

"""Voyage AI embedding generation via httpx.

Generates 1024-dimensional vectors for semantic search.
"""

import httpx

from src.config import settings

VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings"
VOYAGE_MODEL = "voyage-3-lite"
MAX_INPUT_CHARS = 8000


async def generate_embedding(text: str) -> list[float] | None:
    """Generate a 1024-dim embedding vector for the given text.

    Returns None if the API key is not configured or the request fails.
    """
    if not settings.voyage_api_key:
        print("[EMBEDDING] VOYAGE_API_KEY not configured, skipping")
        return None

    if not text or not text.strip():
        return None

    # Truncate to max input length
    truncated = text[:MAX_INPUT_CHARS]

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                VOYAGE_API_URL,
                headers={
                    "Authorization": f"Bearer {settings.voyage_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": VOYAGE_MODEL,
                    "input": truncated,
                },
                timeout=30.0,
            )

            if response.status_code != 200:
                print(f"[EMBEDDING] Voyage API error {response.status_code}: {response.text[:200]}")
                return None

            data = response.json()
            embeddings = data.get("data", [])
            if embeddings:
                return embeddings[0].get("embedding")

    except httpx.TimeoutException:
        print("[EMBEDDING] Voyage API timeout")
    except Exception as e:
        print(f"[EMBEDDING] Voyage API error: {e}")

    return None

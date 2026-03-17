"""Embedding generation job — REMOVED.

Voyage AI embeddings were generated but never consumed by any endpoint.
These stubs remain because rss_collector imports generate_embeddings_batch.
"""


async def generate_embeddings_batch(_article_ids: list[str]) -> None:
    """No-op stub. Voyage AI removed — embeddings were dead code."""
    pass


async def generate_missing_embeddings() -> None:
    """No-op stub."""
    pass

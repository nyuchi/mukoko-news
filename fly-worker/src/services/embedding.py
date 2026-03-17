"""Embedding generation — REMOVED.

Voyage AI embeddings were generated but never consumed by any endpoint.
Search uses keyword matching, related articles use keyword/category matching.
This module is kept as a no-op stub since rss_collector imports it.
"""


async def generate_embedding(_text: str) -> list[float] | None:
    """No-op stub. Voyage AI removed — embeddings were never consumed."""
    return None

"""Notify the fundi-news-enrichment Cloudflare Worker after ingestion.

The fly-worker is ingestion-only. AI enrichment (Claude NLP, keyword extraction,
quality scoring, embeddings) runs in the fundi-news-enrichment Worker, which
receives a webhook after each ingestion batch.
"""

import httpx

from src.config import settings


async def notify_enrichment_worker(article_ids: list[str], source: str = "rss") -> None:
    """POST article IDs to fundi-news-enrichment for AI processing.

    Non-blocking — errors are logged but never propagate to the ingestion path.
    """
    if not article_ids or not settings.fundi_enrichment_url:
        return

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{settings.fundi_enrichment_url}/api/enrich",
                json={"articleIds": article_ids, "source": source},
                headers={"Authorization": f"Bearer {settings.fundi_enrichment_token}"},
            )
            if resp.status_code >= 400:
                print(f"[ENRICHMENT] fundi-news-enrichment returned {resp.status_code}: {resp.text[:200]}")
            else:
                print(f"[ENRICHMENT] Queued {len(article_ids)} articles for enrichment ({source})")
    except Exception as e:
        print(f"[ENRICHMENT] Failed to notify fundi-news-enrichment: {e}")

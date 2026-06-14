"""Embedding backfill job.

Generates BGE-M3 embeddings for articles that were processed by AI
but don't yet have an embedding. Runs every 10 minutes.
"""

from datetime import datetime, timezone

from src.services.mongodb import get_db
from src.services.embeddings import embed_text, build_article_text


async def backfill_embeddings() -> None:
    """Generate embeddings for articles that don't have them yet."""
    db = get_db()

    rows = await db["articles"].find(
        {"aiProcessed": True, "embedding": {"$exists": False}},
        {"_id": 1, "headline": 1, "description": 1, "articleBodyProcessed": 1},
    ).sort("datePublished", -1).limit(20).to_list(20)

    if not rows:
        return

    print(f"[EMBEDDINGS] Backfilling {len(rows)} articles...")
    success = 0
    now = datetime.now(timezone.utc)

    for row in rows:
        # Map to keys expected by build_article_text
        article_for_embed = {
            "headline": row.get("headline", ""),
            "description": row.get("description", ""),
            "article_body_processed": row.get("articleBodyProcessed", ""),
        }
        text = build_article_text(article_for_embed)
        if not text:
            continue

        embedding = await embed_text(text)
        if embedding is None:
            continue

        await db["articles"].update_one(
            {"_id": row["_id"]},
            {"$set": {
                "embedding": embedding,
                "embeddingModel": "bge-m3",
                "updatedAt": now,
            }},
        )
        success += 1

    print(f"[EMBEDDINGS] Backfilled {success}/{len(rows)} articles")

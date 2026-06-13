"""Embedding backfill job.

Generates BGE-M3 embeddings for articles that were processed before
the embedding pipeline was added. Runs every 10 minutes.
"""

from datetime import datetime, timezone

from src.services.mongodb import get_db
from src.services.embeddings import embed_text, build_article_text


async def backfill_embeddings() -> None:
    """Generate embeddings for articles that don't have them yet."""
    db = get_db()

    rows = await db["articles"].find(
        {"ai_processed": True, "embedding": None},
        {"_id": 1, "headline": 1, "description": 1, "article_body_processed": 1},
    ).sort("date_published", -1).limit(20).to_list(20)

    if not rows:
        return

    print(f"[EMBEDDINGS] Backfilling {len(rows)} articles...")
    success = 0
    now = datetime.now(timezone.utc)

    for row in rows:
        text = build_article_text(row)
        if not text:
            continue

        embedding = await embed_text(text)
        if embedding is None:
            continue

        await db["articles"].update_one(
            {"_id": row["_id"]},
            {"$set": {
                "embedding": embedding,
                "embedding_model": "bge-m3",
                "updated_at": now,
            }},
        )
        success += 1

    print(f"[EMBEDDINGS] Backfilled {success}/{len(rows)} articles")

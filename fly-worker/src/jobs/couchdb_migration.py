"""One-time migration: copy article bodies from Postgres to CouchDB.

Finds articles where couchdb_doc_id IS NULL, copies body to CouchDB,
then updates the couchdb_doc_id column. Rate-limited to avoid overload.
"""

import asyncio
from datetime import datetime, timezone

from src.db import get_pool
from src.services.couchdb import get_couchdb


async def migrate_articles_to_couchdb(batch_size: int = 50) -> None:
    """Migrate existing article bodies to CouchDB in batches."""
    pool = await get_pool()
    couchdb = get_couchdb()

    if not await couchdb.ping():
        print("[MIGRATION] CouchDB not reachable, aborting")
        return

    total_migrated = 0

    while True:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT id::text, headline, articlebody, article_body_processed,
                          publisher_organization_id::text AS source_id, ingested_at
                   FROM news.news_article
                   WHERE couchdb_doc_id IS NULL AND articlebody IS NOT NULL
                   ORDER BY ingested_at ASC
                   LIMIT $1""",
                batch_size,
            )

        if not rows:
            break

        docs = []
        for row in rows:
            docs.append({
                "_id": row["id"],
                "type": "article",
                "headline": row["headline"] or "",
                "articlebody": row["articlebody"] or "",
                "article_body_processed": row["article_body_processed"] or "",
                "ingested_at": row["ingested_at"].isoformat() if row["ingested_at"] else "",
                "source_id": row["source_id"] or "",
            })

        results = await couchdb.bulk_docs(docs)

        # Update Postgres with CouchDB doc IDs
        success_ids = [
            r["id"] for r in results
            if r.get("ok") or r.get("rev")
        ]
        if success_ids:
            async with pool.acquire() as conn:
                for article_id in success_ids:
                    await conn.execute(
                        "UPDATE news.news_article SET couchdb_doc_id = $1 WHERE id = $1::uuid",
                        article_id,
                    )

        total_migrated += len(success_ids)
        print(f"[MIGRATION] Migrated {len(success_ids)}/{len(rows)} articles (total: {total_migrated})")

        # Rate limit: 1 second between batches
        await asyncio.sleep(1)

    print(f"[MIGRATION] Complete: {total_migrated} articles migrated to CouchDB")

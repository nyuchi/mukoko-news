"""Database sync job — Fly.io Postgres → D1 (production).

Syncs new/updated articles, keywords, and organizations from the
worker's Postgres to the production D1 database via an HTTP endpoint.

This is the key resilience feature: if D1 is down, the worker keeps
collecting into Postgres. When D1 comes back, this job catches up.
"""

import json
import time

import httpx

from src.config import settings
from src.db import get_pool

# Max articles per sync batch
SYNC_BATCH_SIZE = 50


async def sync_to_d1() -> None:
    """Sync pending records from Postgres to D1."""
    if not settings.d1_sync_url:
        return  # Sync not configured yet

    pool = await get_pool()
    start = time.time()
    stats = {"articles": 0, "keywords": 0, "errors": 0}

    try:
        # Sync articles
        async with pool.acquire() as conn:
            pending = await conn.fetch(
                """SELECT id, headline, description, slug, main_entity_of_page,
                          rss_guid, image, author_name, byline,
                          publisher_id, publisher_name,
                          article_section_id, about_country_id,
                          date_published, date_modified, date_created,
                          word_count, reading_time_minutes, in_language,
                          view_count, like_count, bookmark_count,
                          comment_count, share_count,
                          keywords, content_type, urgency, status,
                          ai_processed, quality_score, engagement_score,
                          trending_score, content_hash
                   FROM articles
                   WHERE sync_status = 'pending'
                   ORDER BY date_created ASC
                   LIMIT $1""",
                SYNC_BATCH_SIZE,
            )

        if pending:
            articles_data = []
            for row in pending:
                article = dict(row)
                # Convert datetimes to ISO strings for JSON
                for key in ("date_published", "date_modified", "date_created"):
                    if article.get(key):
                        article[key] = article[key].isoformat()
                # keywords is already JSONB
                if isinstance(article.get("keywords"), str):
                    article["keywords"] = json.loads(article["keywords"])
                articles_data.append(article)

            success = await _send_sync(
                "articles", articles_data
            )

            if success:
                async with pool.acquire() as conn:
                    ids = [row["id"] for row in pending]
                    await conn.execute(
                        """UPDATE articles SET
                           sync_status = 'synced',
                           synced_at = NOW()
                           WHERE id = ANY($1)""",
                        ids,
                    )
                stats["articles"] = len(ids)
            else:
                stats["errors"] += len(pending)

        # Sync keywords
        async with pool.acquire() as conn:
            new_terms = await conn.fetch(
                """SELECT id, name, term_code, term_type, article_count
                   FROM defined_terms
                   WHERE updated_at > (NOW() - INTERVAL '15 minutes')
                   LIMIT 100"""
            )

        if new_terms:
            terms_data = [dict(t) for t in new_terms]
            success = await _send_sync("keywords", terms_data)
            if success:
                stats["keywords"] = len(terms_data)
            else:
                stats["errors"] += 1

        duration = int((time.time() - start) * 1000)
        total = stats["articles"] + stats["keywords"]
        if total > 0:
            print(f"[SYNC] Synced {stats['articles']} articles, {stats['keywords']} keywords ({duration}ms)")

    except Exception as e:
        print(f"[SYNC] Sync failed: {e}")


async def _send_sync(entity_type: str, data: list[dict]) -> bool:
    """Send sync payload to D1 sync endpoint."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{settings.d1_sync_url}/sync/{entity_type}",
                headers={
                    "Authorization": f"Bearer {settings.d1_sync_secret}",
                    "Content-Type": "application/json",
                },
                json={"records": data},
                timeout=30.0,
            )

            if response.status_code == 200:
                return True

            print(f"[SYNC] D1 sync error ({entity_type}): {response.status_code} {response.text[:200]}")
            return False

    except httpx.TimeoutException:
        print(f"[SYNC] D1 sync timeout ({entity_type})")
        return False
    except httpx.ConnectError:
        print(f"[SYNC] D1 sync connection failed ({entity_type}) — target may be down")
        return False
    except Exception as e:
        print(f"[SYNC] D1 sync error ({entity_type}): {e}")
        return False

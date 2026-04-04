"""RSS feed collection job.

Fetches RSS feeds from all enabled feed sources, parses articles,
deduplicates, inserts new articles, then runs AI processing inline.
"""

import json
import time
from datetime import datetime, timezone

import httpx

from src.config import settings
from src.db import get_pool
from src.services.rss_parser import parse_feed
from src.services.content_cleaner import clean_html, extract_text, count_words, estimate_reading_time
from src.jobs.ai_processor import process_articles_batch
from src.services.couchdb import get_couchdb
from src.services.doris import get_doris


async def collect_feeds() -> None:
    """Main RSS collection job. Runs every 15 minutes."""
    start = time.time()
    pool = await get_pool()
    stats = {"sources": 0, "fetched": 0, "inserted": 0, "errors": 0, "skipped": 0}

    try:
        # Load enabled sources sorted by priority (JOIN feed_source + organization)
        async with pool.acquire() as conn:
            sources = await conn.fetch("""
                SELECT fs.id, fs.organization_id, org.name AS org_name,
                       fs.feed_url, fs.country, fs.article_section_slug,
                       fs.language, fs.health_status, fs.consecutive_failures,
                       fs.last_fetched_at
                FROM news.feed_source fs
                JOIN news.news_media_organization org ON fs.organization_id = org.id
                WHERE fs.is_active = TRUE
                ORDER BY fs.priority DESC, fs.consecutive_failures ASC
            """)

        stats["sources"] = len(sources)
        print(f"[RSS] Starting collection for {len(sources)} sources")

        # Process in batches
        batch_size = settings.rss_batch_size
        new_article_ids = []

        for i in range(0, len(sources), batch_size):
            batch = sources[i : i + batch_size]
            batch_ids = await _process_batch(batch, pool, stats)
            new_article_ids.extend(batch_ids)

        # Inline AI processing for new articles
        if new_article_ids:
            print(f"[RSS] Processing {len(new_article_ids)} new articles with AI...")
            await process_articles_batch(new_article_ids)

        duration = int((time.time() - start) * 1000)
        print(
            f"[RSS] Complete: {stats['inserted']} new, "
            f"{stats['skipped']} dupes, {stats['errors']} errors "
            f"({duration}ms)"
        )

        # Log the run
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO system.collection_log
                   (job_type, status, articles_collected, articles_processed,
                    errors, duration_ms, metadata, started_at, completed_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
                "rss_collection",
                "success",
                stats["fetched"],
                stats["inserted"],
                stats["errors"],
                duration,
                json.dumps(stats),
                datetime.fromtimestamp(start, tz=timezone.utc),
                datetime.now(timezone.utc),
            )

    except Exception as e:
        print(f"[RSS] Collection failed: {e}")
        duration = int((time.time() - start) * 1000)
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO system.collection_log
                   (job_type, status, errors, duration_ms, error_message,
                    started_at, completed_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)""",
                "rss_collection",
                "failed",
                stats["errors"],
                duration,
                str(e),
                datetime.fromtimestamp(start, tz=timezone.utc),
                datetime.now(timezone.utc),
            )


async def _process_batch(
    sources: list, pool, stats: dict
) -> list[str]:
    """Fetch and process a batch of RSS sources. Returns new article IDs (UUID strings)."""
    new_ids = []

    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=settings.rss_fetch_timeout,
    ) as client:
        for source in sources:
            source_dict = dict(source)
            try:
                # Skip sources with too many failures
                if source_dict.get("consecutive_failures", 0) >= 8:
                    continue

                # Fetch the feed
                url = source_dict["feed_url"]
                response = await client.get(url)
                if response.status_code != 200:
                    await _record_failure(pool, source_dict, f"HTTP {response.status_code}")
                    stats["errors"] += 1
                    continue

                # Parse
                feed_data = parse_feed(response.text, source_dict)
                articles = feed_data["articles"]
                stats["fetched"] += len(articles)

                # Insert new articles
                ids = await _insert_articles(pool, articles, stats)
                new_ids.extend(ids)

                # Record success
                await _record_success(pool, source_dict, len(articles))

            except httpx.TimeoutException:
                await _record_failure(pool, source_dict, "Timeout")
                stats["errors"] += 1
            except Exception as e:
                await _record_failure(pool, source_dict, str(e)[:500])
                stats["errors"] += 1

    return new_ids


async def _insert_articles(pool, articles: list[dict], stats: dict) -> list[str]:
    """Insert new articles, skipping duplicates. Returns list of new article ID strings."""
    new_ids = []

    async with pool.acquire() as conn:
        for article in articles:
            # Check for duplicate by source_feed_id or mainentityofpage
            existing = await conn.fetchval(
                """SELECT id FROM news.news_article
                   WHERE source_feed_id = $1 OR mainentityofpage = $2
                   LIMIT 1""",
                article["source_feed_id"],
                article["mainentityofpage"],
            )

            if existing:
                stats["skipped"] += 1
                continue

            # Clean content
            raw_body = article.get("article_body", "")
            cleaned_body = clean_html(raw_body) if raw_body else ""
            plain_text = extract_text(raw_body) if raw_body else ""
            word_count = count_words(plain_text)
            reading_time = estimate_reading_time(word_count)

            # Ensure unique slug
            slug = article["slug"]
            slug_exists = await conn.fetchval(
                "SELECT 1 FROM news.news_article WHERE slug = $1", slug
            )
            if slug_exists:
                slug = f"{slug}-{article['source_fingerprint'][:8]}"

            # Look up interest_category UUID from slug
            category_slug = article.get("articlesection", "general")
            category_id = await conn.fetchval(
                "SELECT id FROM engagement.interest_category WHERE slug = $1",
                category_slug,
            )

            # Insert
            article_id = await conn.fetchval(
                """INSERT INTO news.news_article
                   (headline, description, articlebody, article_body_processed,
                    slug, mainentityofpage, source_feed_id, image,
                    author, publisher_organization_id, publisher,
                    articlesection, primary_interest_category_id, primary_location_country,
                    datepublished, source_fingerprint, inlanguage,
                    wordcount, reading_time_minutes, creativeworkstatus, ingestion_method)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,'published','rss_feed')
                   RETURNING id::text""",
                article["headline"],
                article.get("description", ""),
                raw_body,
                cleaned_body,
                slug,
                article["mainentityofpage"],
                article["source_feed_id"],
                article.get("image"),
                article.get("author"),
                article["publisher_organization_id"],
                article.get("publisher"),
                category_slug,
                category_id,
                article.get("primary_location_country", "ZW"),
                article["datepublished"],
                article["source_fingerprint"],
                article.get("inlanguage", "en"),
                word_count,
                reading_time,
            )

            if article_id:
                new_ids.append(article_id)
                stats["inserted"] += 1

                # Store body in CouchDB (non-blocking — failure doesn't break ingestion)
                try:
                    couchdb = get_couchdb()
                    if couchdb:
                        doc = {
                            "_id": article_id,
                            "type": "article",
                            "headline": article["headline"],
                            "articlebody": raw_body,
                            "article_body_processed": cleaned_body,
                            "ingested_at": datetime.now(timezone.utc).isoformat(),
                            "source_id": str(article.get("publisher_organization_id", "")),
                        }
                        rev = await couchdb.put_doc(article_id, doc)
                        if rev:
                            await conn.execute(
                                "UPDATE news.news_article SET couchdb_doc_id = $2 WHERE id = $1::uuid",
                                article_id,
                                article_id,
                            )
                except Exception as e:
                    print(f"[RSS] CouchDB write failed for {article_id}: {e}")

                # Index in Doris for search (non-blocking)
                try:
                    doris = get_doris()
                    await doris.stream_load("article_search", [{
                        "article_id": article_id,
                        "headline": article["headline"] or "",
                        "description": article.get("description", "") or "",
                        "keywords": "",  # filled after AI processing
                        "category": category_slug,
                        "country": article.get("primary_location_country", "ZW"),
                        "source_id": str(article.get("publisher_organization_id", "")),
                        "datepublished": article["datepublished"].isoformat() if article.get("datepublished") else "",
                        "engagement_score": 0.0,
                    }])
                except Exception as e:
                    print(f"[RSS] Doris index failed for {article_id}: {e}")

    return new_ids


async def _record_success(pool, source: dict, articles_count: int) -> None:
    """Update feed source on successful fetch."""
    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE news.feed_source SET
               last_fetched_at = NOW(),
               last_successful_fetch_at = NOW(),
               consecutive_failures = 0,
               total_fetch_count = total_fetch_count + 1,
               updated_at = NOW()
               WHERE id = $1""",
            source["id"],
        )


async def _record_failure(pool, source: dict, error: str) -> None:
    """Update feed source on failed fetch."""
    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE news.feed_source SET
               last_fetched_at = NOW(),
               consecutive_failures = consecutive_failures + 1,
               total_error_count = total_error_count + 1,
               last_fetch_error = $2,
               updated_at = NOW()
               WHERE id = $1""",
            source["id"],
            error,
        )

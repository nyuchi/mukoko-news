"""RSS feed collection job.

Fetches RSS feeds from all enabled organizations, parses articles,
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
from src.jobs.embedding_gen import generate_embeddings_batch


async def collect_feeds() -> None:
    """Main RSS collection job. Runs every 15 minutes."""
    start = time.time()
    pool = await get_pool()
    stats = {"sources": 0, "fetched": 0, "inserted": 0, "errors": 0, "skipped": 0}

    try:
        # Load enabled sources sorted by priority
        async with pool.acquire() as conn:
            sources = await conn.fetch("""
                SELECT id, name, url, rss_feed_url, area_served, article_section_id,
                       in_language, health_status, consecutive_failures,
                       last_fetched_at
                FROM organizations
                WHERE enabled = TRUE
                ORDER BY priority DESC, consecutive_failures ASC
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
            await generate_embeddings_batch(new_article_ids)

        duration = int((time.time() - start) * 1000)
        print(
            f"[RSS] Complete: {stats['inserted']} new, "
            f"{stats['skipped']} dupes, {stats['errors']} errors "
            f"({duration}ms)"
        )

        # Log the run
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO collection_log
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
                """INSERT INTO collection_log
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
) -> list[int]:
    """Fetch and process a batch of RSS sources. Returns new article IDs."""
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
                url = source_dict["rss_feed_url"]
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


async def _insert_articles(pool, articles: list[dict], stats: dict) -> list[int]:
    """Insert new articles, skipping duplicates. Returns list of new article IDs."""
    new_ids = []

    async with pool.acquire() as conn:
        for article in articles:
            # Check for duplicate by rss_guid or main_entity_of_page
            existing = await conn.fetchval(
                """SELECT id FROM articles
                   WHERE rss_guid = $1 OR main_entity_of_page = $2
                   LIMIT 1""",
                article["rss_guid"],
                article["main_entity_of_page"],
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
                "SELECT 1 FROM articles WHERE slug = $1", slug
            )
            if slug_exists:
                slug = f"{slug}-{article['content_hash'][:8]}"

            # Insert
            article_id = await conn.fetchval(
                """INSERT INTO articles
                   (headline, description, article_body, article_body_processed,
                    slug, main_entity_of_page, rss_guid, image,
                    author_name, publisher_id, publisher_name,
                    article_section_id, about_country_id,
                    date_published, content_hash, in_language,
                    word_count, reading_time_minutes)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
                   RETURNING id""",
                article["headline"],
                article.get("description", ""),
                raw_body,
                cleaned_body,
                slug,
                article["main_entity_of_page"],
                article["rss_guid"],
                article.get("image"),
                article.get("author_name"),
                article["publisher_id"],
                article["publisher_name"],
                article.get("article_section_id"),
                article.get("about_country_id", "ZW"),
                article["date_published"],
                article["content_hash"],
                article.get("in_language", "en"),
                word_count,
                reading_time,
            )

            if article_id:
                new_ids.append(article_id)
                stats["inserted"] += 1

    return new_ids


async def _record_success(pool, source: dict, articles_count: int) -> None:
    """Update source on successful fetch."""
    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE organizations SET
               last_fetched_at = NOW(),
               last_successful_fetch_at = NOW(),
               consecutive_failures = 0,
               total_fetch_count = total_fetch_count + 1,
               updated_at = NOW()
               WHERE id = $1""",
            source["id"],
        )


async def _record_failure(pool, source: dict, error: str) -> None:
    """Update source on failed fetch."""
    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE organizations SET
               last_fetched_at = NOW(),
               consecutive_failures = consecutive_failures + 1,
               total_error_count = total_error_count + 1,
               last_error = $2,
               last_error_at = NOW(),
               updated_at = NOW()
               WHERE id = $1""",
            source["id"],
            error,
        )

"""Newsdata.io article ingestion and source discovery job.

Pulls news from newsdata.io for African countries every 6 hours, inserts
articles into MongoDB, and probes newly-discovered sources for RSS feeds so
the RSS collector can take over on subsequent runs.
"""

import hashlib
import re
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from src.config import settings
from src.jobs.ai_processor import process_articles_batch
from src.services.content_cleaner import clean_html, count_words, estimate_reading_time
from src.services.mongodb import get_db, get_entity_db
from src.services.newsdata_client import NewsdataClient, map_country, map_language
from src.services.organization_resolver import resolve_or_create_org

# Country batches split by primary language to stay within request limits.
# newsdata.io free tier: 200 credits/day → 2 requests per 6h run.
_LANGUAGE_BATCHES: list[tuple[str, list[str]]] = [
    ("en", ["zw", "za", "ke", "ng", "gh", "et", "eg", "ma", "tz", "ug", "zm", "rw"]),
    ("fr", ["sn", "ci", "cm"]),
]

# Common RSS paths probed on newly discovered source domains
_RSS_PROBE_PATHS = [
    "/feed/",
    "/feed",
    "/rss",
    "/rss.xml",
    "/rss2.xml",
    "/atom.xml",
    "/feed.xml",
    "/index.xml",
    "/feeds/posts/default",
]


async def collect_newsdata() -> None:
    """Main newsdata.io collection job. Runs every 6 hours."""
    if not settings.newsdata_api_key:
        print("[NEWSDATA] NEWSDATA_API_KEY not set — skipping")
        return

    start = time.time()
    db = get_db()
    entity_db = get_entity_db()
    client = NewsdataClient(settings.newsdata_api_key)
    stats: dict[str, int] = {
        "fetched": 0,
        "inserted": 0,
        "skipped": 0,
        "errors": 0,
        "new_sources": 0,
    }

    # Cache source resolutions for this run: newsdata source_id → (feed_source_id, org_id)
    source_cache: dict[str, tuple[str, str]] = {}

    try:
        new_article_ids: list[str] = []

        for language, countries in _LANGUAGE_BATCHES:
            try:
                response = await client.get_latest_news(countries=countries, language=language)
                if response.get("status") != "success":
                    print(f"[NEWSDATA] API error ({language}): {response.get('message', 'unknown')}")
                    stats["errors"] += 1
                    continue

                articles = response.get("results") or []
                stats["fetched"] += len(articles)

                ids = await _ingest_articles(db, entity_db, articles, source_cache, stats)
                new_article_ids.extend(ids)

            except httpx.HTTPStatusError as e:
                print(f"[NEWSDATA] HTTP {e.response.status_code} ({language}): {e}")
                stats["errors"] += 1
            except Exception as e:
                print(f"[NEWSDATA] Fetch failed ({language}): {e}")
                stats["errors"] += 1

        if new_article_ids:
            print(f"[NEWSDATA] Running AI on {len(new_article_ids)} new articles...")
            await process_articles_batch(new_article_ids)

        duration = int((time.time() - start) * 1000)
        print(
            f"[NEWSDATA] Complete: {stats['inserted']} new, {stats['skipped']} dupes, "
            f"{stats['new_sources']} sources discovered, {stats['errors']} errors ({duration}ms)"
        )
        await db["pipelineLogs"].insert_one({
            "jobType": "newsdata_collection",
            "status": "success",
            "articlesCollected": stats["fetched"],
            "articlesProcessed": stats["inserted"],
            "newSourcesDiscovered": stats["new_sources"],
            "errors": stats["errors"],
            "durationMs": duration,
            "metadata": stats,
            "startedAt": datetime.fromtimestamp(start, tz=timezone.utc),
            "completedAt": datetime.now(timezone.utc),
        })

    except Exception as e:
        print(f"[NEWSDATA] Collection failed: {e}")
        duration = int((time.time() - start) * 1000)
        await db["pipelineLogs"].insert_one({
            "jobType": "newsdata_collection",
            "status": "failed",
            "errors": stats["errors"],
            "durationMs": duration,
            "errorMessage": str(e),
            "startedAt": datetime.fromtimestamp(start, tz=timezone.utc),
            "completedAt": datetime.now(timezone.utc),
        })


async def _ingest_articles(
    db,
    entity_db,
    articles: list[dict],
    source_cache: dict[str, tuple[str, str]],
    stats: dict[str, int],
) -> list[str]:
    """Normalize and insert newsdata.io articles. Returns IDs of newly inserted articles."""
    new_ids: list[str] = []

    for raw in articles:
        try:
            if raw.get("duplicate"):
                stats["skipped"] += 1
                continue

            url = raw.get("link", "")
            if not url:
                continue

            if await db["articles"].find_one({"externalUrl": url}, {"_id": 1}):
                stats["skipped"] += 1
                continue

            country_iso = map_country(raw.get("country") or [])
            language_iso = map_language(raw.get("language") or "en")

            feed_source_id, org_id = await _resolve_source(
                db, entity_db, raw, country_iso, language_iso, source_cache, stats
            )

            article_id = await _insert_article(
                db, raw, url, feed_source_id, org_id, country_iso, language_iso
            )
            if article_id:
                new_ids.append(article_id)
                stats["inserted"] += 1

        except Exception as e:
            print(f"[NEWSDATA] Article error ({raw.get('link', '?')}): {e}")
            stats["errors"] += 1

    return new_ids


async def _resolve_source(
    db,
    entity_db,
    raw: dict,
    country_iso: str,
    language_iso: str,
    source_cache: dict[str, tuple[str, str]],
    stats: dict[str, int],
) -> tuple[str, str]:
    """Return (feedSourceId, mediaOrganizationId) for a newsdata.io article.

    Checks the in-run cache, then the DB. On first encounter of a source,
    probes for an RSS feed and either creates a live feedSource (if found)
    or an inactive placeholder so every article has a valid feedSourceId.
    """
    newsdata_source_id = raw.get("source_id", "")
    if newsdata_source_id in source_cache:
        return source_cache[newsdata_source_id]

    virtual_id = f"newsdata-{newsdata_source_id}"

    existing = await db["feedSources"].find_one(
        {"$or": [{"_id": virtual_id}, {"newsdataSourceId": newsdata_source_id}]},
        {"_id": 1, "mediaOrganizationId": 1},
    )
    if existing:
        cached_org_id: str = existing.get("mediaOrganizationId") or ""
        result: tuple[str, str] = (existing["_id"], cached_org_id)
        source_cache[newsdata_source_id] = result
        return result

    source_url = raw.get("source_url", "")
    source_name = raw.get("source_name") or newsdata_source_id

    # Resolve or create org + entity records (guaranteed non-None org_id)
    org_id, entity_id = await resolve_or_create_org(
        db, entity_db, source_name, source_url or None, country_iso, newsdata_source_id
    )

    # Probe for RSS feed and create the feedSource
    now = datetime.now(timezone.utc)
    rss_url = await _probe_rss(source_url) if source_url else None
    await _create_feed_source(
        db, virtual_id, source_name, rss_url, source_url,
        newsdata_source_id, country_iso, language_iso, org_id, now,
    )

    # Record in discovery candidates for admin visibility
    await db["sourceDiscoveryCandidates"].insert_one({
        "_id": virtual_id,
        "newsdataSourceId": newsdata_source_id,
        "sourceName": source_name,
        "sourceUrl": source_url,
        "countryCode": country_iso,
        "language": language_iso,
        "mediaOrganizationId": org_id,
        "entityId": entity_id,
        "articleCount": 1,
        "rssProbeStatus": "found" if rss_url else "not_found",
        "rssFeedUrl": rss_url,
        "feedSourceCreated": True,
        "firstSeenAt": now,
        "updatedAt": now,
    })
    stats["new_sources"] += 1

    new_result: tuple[str, str] = (virtual_id, org_id)
    source_cache[newsdata_source_id] = new_result
    return new_result


async def _probe_rss(source_url: str) -> str | None:
    """Probe common RSS paths on a source URL. Returns the first working feed URL or None."""
    base = source_url.rstrip("/")
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=10.0,
        headers={"User-Agent": "MukokoNews/2.0 (+https://news.mukoko.com)"},
    ) as client:
        for path in _RSS_PROBE_PATHS:
            url = f"{base}{path}"
            try:
                resp = await client.get(url)
                if resp.status_code == 200 and _is_feed(resp.text, resp.headers.get("content-type", "")):
                    return url
            except Exception:
                continue
    return None


def _is_feed(body: str, content_type: str) -> bool:
    """Heuristic: does this HTTP response look like an RSS/Atom feed?"""
    ct = content_type.lower()
    if any(t in ct for t in ("rss", "atom", "xml")):
        return True
    return bool(re.search(r"<(rss|feed|rdf:RDF)", body.lstrip()[:300], re.IGNORECASE))


async def _create_feed_source(
    db,
    virtual_id: str,
    name: str,
    rss_url: str | None,
    source_url: str,
    newsdata_source_id: str,
    country_iso: str,
    language_iso: str,
    org_id: str,
    now: datetime,
) -> None:
    """Upsert a feedSource record for a newsdata.io-discovered source.

    When an RSS feed is found the source is active and will be picked up by
    the RSS collector on its next run. Without RSS it is inactive (articles
    continue to arrive via the newsdata job only).
    """
    has_rss = rss_url is not None
    await db["feedSources"].insert_one({
        "_id": virtual_id,
        "_schemaVersion": "v3.1",
        "name": name,
        "feedUrl": rss_url,
        "feedType": "rss" if has_rss else "newsdata_api",
        "countryCode": country_iso,
        "language": language_iso,
        "mediaOrganizationId": org_id,
        "isActive": has_rss,
        "autoApprove": True,
        "articleCount": 0,
        "fetchIntervalMins": 30,
        "trustScore": None,
        "defaultInterestCategoryId": None,
        "publisherApiKeyId": None,
        "lastFetchedAt": None,
        "lastFetchStatus": None,
        "lastFetchError": None,
        "newsdataSourceId": newsdata_source_id,
        "sourceUrl": source_url,
        "bundu": {"trustSignals": {}},
        "createdAt": now,
        "updatedAt": now,
    })
    if has_rss:
        print(f"[NEWSDATA] RSS discovered for '{name}': {rss_url}")
    else:
        print(f"[NEWSDATA] New source (no RSS): '{name}' ({source_url})")


async def _insert_article(
    db,
    raw: dict,
    url: str,
    feed_source_id: str,
    org_id: str,
    country_iso: str,
    language_iso: str,
) -> str | None:
    """Normalize a newsdata.io article and insert it. Returns the new article ID or None."""
    headline = (raw.get("title") or "").strip()[:500]
    if not headline:
        return None

    description = (raw.get("description") or "").strip()[:500]
    content = raw.get("content") or raw.get("description") or ""
    plain_text = _strip_html(content)
    word_count = count_words(plain_text)

    date_published = _parse_newsdata_date(raw.get("pubDate"))

    image_url = raw.get("image_url")
    image = [{"@type": "ImageObject", "url": image_url}] if image_url else []

    creators = raw.get("creator") or []
    author_name = creators[0] if creators else None

    categories = raw.get("category") or []
    article_section = categories[0] if categories else "general"

    content_for_hash = f"{headline}{url}"
    fingerprint = hashlib.sha256(content_for_hash.encode()).hexdigest()[:16]
    slug = _slugify(headline)

    if await db["articles"].find_one({"slug": slug}, {"_id": 1}):
        slug = f"{slug}-{fingerprint}"

    article_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    doc: dict = {
        "_id": article_id,
        "_schemaVersion": "v3.1",
        "feedSourceId": feed_source_id,
        "mediaOrganizationId": org_id,
        "externalUrl": url,
        "headline": headline,
        "slug": slug,
        "inLanguage": language_iso,
        "status": "approved",
        "moderationStatus": "active",
        "isApproved": True,
        "scrapedAt": now,
        "createdAt": now,
        "updatedAt": now,
        "description": description,
        "articleBody": content,
        "articleSection": article_section,
        "datePublished": date_published,
        "image": image,
        "wordCount": word_count,
        "categoryIds": [],
        "tagIds": [],
        "journalistIds": [],
        "bundu": {"trustSignals": {}, "ubuntuScoreSnapshot": None},
        "sourceGuid": raw.get("article_id") or url,
        "sourceFingerprint": fingerprint,
        "articleBodyProcessed": clean_html(content) if content else "",
        "readingTimeMinutes": estimate_reading_time(word_count),
        "aiProcessed": False,
        "aiProcessedAt": None,
        "qualityScore": 0.0,
        "embeddingModel": None,
        "ingestionMethod": "newsdata_api",
        "newsdataKeywords": raw.get("keywords") or [],
    }
    if author_name:
        doc["author"] = {"@type": "Person", "name": author_name}

    try:
        await db["articles"].insert_one(doc)
        return article_id
    except Exception as e:
        print(f"[NEWSDATA] Insert failed for {url}: {e}")
        return None


def _parse_newsdata_date(date_str: str | None) -> datetime | None:
    """Parse newsdata.io pubDate format: '2026-06-14 10:00:00'."""
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def _extract_domain(url: str) -> str:
    return urlparse(url).netloc or url


def _strip_html(html: str) -> str:
    if not html:
        return ""
    return BeautifulSoup(html, "lxml").get_text(separator=" ")


def _slugify(text: str) -> str:
    slug = text.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug[:200].strip("-")

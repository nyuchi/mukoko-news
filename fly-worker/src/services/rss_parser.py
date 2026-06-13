"""RSS/Atom feed parser using feedparser.

Parses RSS/Atom XML into normalized article dicts aligned to schema.org NewsArticle.
"""

import hashlib
import json
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import feedparser
from bs4 import BeautifulSoup


def parse_feed(xml_content: str, source: dict) -> dict:
    """Parse RSS/Atom feed XML into normalized articles.

    Args:
        xml_content: Raw XML string from the feed.
        source: Joined feed_source + organization record from the database.
            Expected keys: id (feed_source UUID), organization_id, org_name,
            feed_url, country, article_section_slug, language.

    Returns:
        Dict with 'articles' list and 'feed_title'.
    """
    feed = feedparser.parse(xml_content)
    articles = []

    for entry in feed.entries[:20]:
        article = _parse_entry(entry, source, feed)
        if article:
            articles.append(article)

    return {
        "articles": articles,
        "feed_title": getattr(feed.feed, "title", ""),
        "item_count": len(feed.entries),
    }


def _parse_entry(entry, source: dict, feed) -> dict | None:
    """Parse a single feed entry into a schema.org-aligned article dict."""
    headline = _clean_text(getattr(entry, "title", ""))
    if not headline:
        return None

    main_entity_of_page = getattr(entry, "link", "")
    if not main_entity_of_page:
        return None

    # RSS guid for deduplication
    rss_guid = getattr(entry, "id", main_entity_of_page)

    # schema:datePublished
    date_published = _parse_date(entry)
    if not date_published:
        date_published = datetime.now(timezone.utc)

    # schema:description
    description = ""
    if hasattr(entry, "summary"):
        description = _strip_html(entry.summary)[:500]
    elif hasattr(entry, "description"):
        description = _strip_html(entry.description)[:500]

    # schema:articleBody (from content:encoded or full description)
    article_body = ""
    if hasattr(entry, "content") and entry.content:
        article_body = entry.content[0].get("value", "")
    elif hasattr(entry, "summary_detail"):
        article_body = entry.summary_detail.get("value", "")

    # schema:author — JSONB string for asyncpg
    author_raw = _extract_author(entry)
    author = json.dumps({"@type": "Person", "name": author_raw}) if author_raw else None

    # schema:image — JSONB string for asyncpg
    image_url = _extract_image(entry)
    image = json.dumps({"url": image_url}) if image_url else None

    # schema:articleSection from source default
    articlesection = source.get("article_section_slug", "general")

    # Generate slug from headline
    slug = _slugify(headline)

    # Content fingerprint for deduplication
    content_for_hash = f"{headline}{main_entity_of_page}"
    source_fingerprint = hashlib.sha256(content_for_hash.encode()).hexdigest()[:16]

    # Publisher as JSONB string for asyncpg
    org_name = source.get("org_name", "")
    publisher = json.dumps({"@type": "Organization", "name": org_name}) if org_name else None

    return {
        "headline": headline[:500],
        "description": description,
        "article_body": article_body,
        "slug": slug,
        "mainentityofpage": main_entity_of_page,
        "source_feed_id": rss_guid,
        "image": image,
        "author": author,
        "publisher_organization_id": source.get("organization_id"),
        "publisher": publisher,
        "articlesection": articlesection,
        "primary_location_country": source.get("country", "ZW"),
        "datepublished": date_published,
        "source_fingerprint": source_fingerprint,
        "inlanguage": source.get("language", "en"),
    }


def _parse_date(entry) -> datetime | None:
    """Extract and parse publication date from a feed entry."""
    for attr in ("published_parsed", "updated_parsed"):
        parsed = getattr(entry, attr, None)
        if parsed:
            try:
                from calendar import timegm
                ts = timegm(parsed)
                return datetime.fromtimestamp(ts, tz=timezone.utc)
            except (ValueError, OverflowError):
                continue

    for attr in ("published", "updated"):
        raw = getattr(entry, attr, None)
        if raw:
            try:
                return parsedate_to_datetime(raw).replace(tzinfo=timezone.utc)
            except (ValueError, TypeError):
                pass
            try:
                return datetime.fromisoformat(raw.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                pass

    return None


def _extract_author(entry) -> str:
    """Extract author name from feed entry."""
    if hasattr(entry, "author_detail"):
        return getattr(entry.author_detail, "name", "") or ""
    if hasattr(entry, "author"):
        return entry.author or ""
    if hasattr(entry, "dc_creator"):
        return entry.dc_creator or ""
    return ""


def _extract_image(entry) -> str | None:
    """Extract primary image URL from feed entry."""
    # media:content
    if hasattr(entry, "media_content") and entry.media_content:
        for media in entry.media_content:
            url = media.get("url", "")
            medium = media.get("medium", "")
            mime = media.get("type", "")
            if medium == "image" or mime.startswith("image/") or _looks_like_image(url):
                return url

    # media:thumbnail
    if hasattr(entry, "media_thumbnail") and entry.media_thumbnail:
        return entry.media_thumbnail[0].get("url")

    # enclosures
    if hasattr(entry, "enclosures") and entry.enclosures:
        for enc in entry.enclosures:
            if enc.get("type", "").startswith("image/"):
                return enc.get("href") or enc.get("url")

    # Try to find <img> in content/summary
    for attr in ("summary", "description"):
        html = getattr(entry, attr, "")
        if html:
            img = _extract_img_from_html(html)
            if img:
                return img

    return None


def _extract_img_from_html(html: str) -> str | None:
    """Extract first <img> src from HTML content."""
    soup = BeautifulSoup(html, "lxml")
    img = soup.find("img")
    if img and img.get("src"):
        src = img["src"]
        if isinstance(src, str) and src.startswith("http"):
            return src
    return None


def _looks_like_image(url: str) -> bool:
    """Check if a URL looks like an image based on extension."""
    return bool(re.search(r"\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$", url, re.IGNORECASE))


def _strip_html(html: str) -> str:
    """Remove HTML tags and normalize whitespace."""
    if not html:
        return ""
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text(separator=" ")
    return re.sub(r"\s+", " ", text).strip()


def _clean_text(text: str) -> str:
    """Clean and normalize text."""
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip()


def _slugify(text: str) -> str:
    """Generate URL-safe slug from text."""
    slug = text.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug[:200].strip("-")

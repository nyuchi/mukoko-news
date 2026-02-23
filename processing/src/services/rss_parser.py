"""
RSS feed parser — replaces backend/services/SimpleRSSService.ts parsing logic.

Uses lxml (available in Pyodide) for XML parsing and beautifulsoup4
for HTML cleaning, replacing:
  - fast-xml-parser + custom RSS/Atom detection
  - 8 regex patterns for image extraction
  - 3-pass loop-based HTML tag removal
  - Hardcoded HTML entity map

Note: feedparser is not available in Pyodide (depends on sgmllib3k which
has no wasm wheel), so we use lxml.etree directly for RSS/Atom parsing.

TS counterpart: SimpleRSSService.parseItem() + extractImage()
"""

import re
from lxml import etree  # type: ignore[attr-defined]
from bs4 import BeautifulSoup


# Common ad/tracking domains to filter — same list as SimpleRSSService.ts
AD_DOMAINS = frozenset([
    "doubleclick.net", "googlesyndication.com", "googleadservices.com",
    "facebook.com/tr", "amazon-adsystem.com", "adnxs.com", "outbrain.com",
    "taboola.com", "criteo.com", "adsrvr.org", "rubiconproject.com",
    "pubmatic.com", "advertising.com", "adroll.com", "mathtag.com",
    "bidswitch.net", "sharethis.com", "addthis.com",
])

# XML namespaces used in RSS feeds
NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "media": "http://search.yahoo.com/mrss/",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "dc": "http://purl.org/dc/elements/1.1/",
}


async def parse_rss_feed(xml_content: str, source: dict, env=None) -> dict:
    """
    Parse an RSS/Atom feed and return structured articles.

    Args:
        xml_content: Raw XML string of the feed
        source: Source metadata dict with keys: id, name, category, country_id
        env: Cloudflare env bindings (for future edge cache / MongoDB lookups)

    Returns:
        {"articles": [...], "feed_title": str, "item_count": int}
    """
    if not xml_content or not xml_content.strip():
        return {"articles": [], "feed_title": "", "item_count": 0, "error": "Empty feed content"}

    try:
        # Parse XML — lxml handles malformed XML better than stdlib
        raw = xml_content.encode("utf-8") if isinstance(xml_content, str) else xml_content
        root = etree.fromstring(raw)
    except etree.XMLSyntaxError as e:
        return {
            "articles": [],
            "feed_title": "",
            "item_count": 0,
            "error": f"Feed parse error: {e}",
        }

    # Detect feed type and parse accordingly
    tag = _local_name(root.tag)
    if tag == "feed":
        return _parse_atom(root, source)
    elif tag == "rss":
        return _parse_rss(root, source)
    elif tag == "RDF":
        return _parse_rdf(root, source)
    else:
        return {"articles": [], "feed_title": "", "item_count": 0, "error": f"Unknown feed format: {tag}"}


def _parse_rss(root, source: dict) -> dict:
    """Parse RSS 2.0 feed."""
    channel = root.find("channel")
    if channel is None:
        return {"articles": [], "feed_title": "", "item_count": 0, "error": "No channel element"}

    feed_title = _text(channel, "title")
    items = channel.findall("item")

    articles = []
    for item in items[:20]:
        article = _parse_rss_item(item, source)
        if article:
            articles.append(article)

    return {"articles": articles, "feed_title": feed_title, "item_count": len(items)}


def _parse_atom(root, source: dict) -> dict:
    """Parse Atom feed."""
    feed_title = _text(root, "atom:title", NS) or _text(root, "title")
    entries = root.findall("atom:entry", NS)
    if not entries:
        entries = root.findall("entry")

    articles = []
    for entry in entries[:20]:
        article = _parse_atom_entry(entry, source)
        if article:
            articles.append(article)

    return {"articles": articles, "feed_title": feed_title, "item_count": len(entries)}


def _parse_rdf(root, source: dict) -> dict:
    """Parse RDF/RSS 1.0 feed."""
    feed_title = _text(root, "channel/title") or ""
    items = root.findall("{http://purl.org/rss/1.0/}item")
    if not items:
        items = root.findall("item")

    articles = []
    for item in items[:20]:
        article = _parse_rss_item(item, source)
        if article:
            articles.append(article)

    return {"articles": articles, "feed_title": feed_title, "item_count": len(items)}


def _parse_rss_item(item, source: dict) -> dict | None:
    """Parse a single RSS item element."""
    title = _text(item, "title")
    if not title:
        return None

    link = _text(item, "link")
    if not link:
        link = _text(item, "guid")
    if not link:
        return None

    description = _clean_summary(_text(item, "description") or "")
    content = _text(item, "content:encoded", NS) or _text(item, "description") or ""
    author = _text(item, "dc:creator", NS) or _text(item, "author") or ""
    published = _text(item, "pubDate") or _text(item, "dc:date", NS) or ""
    image_url = _extract_image_rss(item)
    guid = _text(item, "guid") or link
    slug = _generate_slug(title)

    return {
        "title": _clean_text(title),
        "description": _clean_text(description[:500]) if description else None,
        "content": content,
        "author": _clean_text(author) if author else None,
        "source": source.get("name", ""),
        "source_id": source.get("id"),
        "category_id": source.get("category"),
        "country_id": source.get("country_id"),
        "published_at": published,
        "image_url": image_url,
        "original_url": link,
        "rss_guid": guid,
        "slug": slug,
    }


def _parse_atom_entry(entry, source: dict) -> dict | None:
    """Parse a single Atom entry element."""
    title = _text(entry, "atom:title", NS) or _text(entry, "title")
    if not title:
        return None

    # Atom uses <link href="..."/> attribute
    link = ""
    link_elements = entry.findall("atom:link", NS) or entry.findall("link")
    for link_el in link_elements:
        rel = link_el.get("rel", "alternate")
        if rel == "alternate" or not rel:
            link = link_el.get("href", "")
            break
    if not link and link_elements:
        link = link_elements[0].get("href", "") or (link_elements[0].text or "").strip()
    if not link:
        return None

    description = _clean_summary(_text(entry, "atom:summary", NS) or _text(entry, "summary") or "")
    content = _text(entry, "atom:content", NS) or _text(entry, "content") or ""
    author_el = entry.find("atom:author", NS) or entry.find("author")
    author = ""
    if author_el is not None:
        author = _text(author_el, "atom:name", NS) or _text(author_el, "name") or ""
    published = (
        _text(entry, "atom:published", NS)
        or _text(entry, "atom:updated", NS)
        or _text(entry, "published")
        or _text(entry, "updated")
        or ""
    )
    guid = _text(entry, "atom:id", NS) or _text(entry, "id") or link
    slug = _generate_slug(title)

    return {
        "title": _clean_text(title),
        "description": _clean_text(description[:500]) if description else None,
        "content": content,
        "author": _clean_text(author) if author else None,
        "source": source.get("name", ""),
        "source_id": source.get("id"),
        "category_id": source.get("category"),
        "country_id": source.get("country_id"),
        "published_at": published,
        "image_url": None,
        "original_url": link,
        "rss_guid": guid,
        "slug": slug,
    }


def _extract_image_rss(item) -> str | None:
    """Extract image URL from RSS item using media namespace and enclosures."""
    # 1. media:thumbnail
    thumb = item.find("media:thumbnail", NS)
    if thumb is not None:
        url = thumb.get("url", "")
        if _is_valid_image_url(url):
            return url

    # 2. media:content with image type
    for media in item.findall("media:content", NS):
        url = media.get("url", "")
        mtype = media.get("type", "")
        if "image" in mtype or _is_valid_image_url(url):
            return url

    # 3. Enclosure with image type
    for enc in item.findall("enclosure"):
        if "image" in (enc.get("type", "") or ""):
            url = enc.get("url", "")
            if _is_valid_image_url(url):
                return url

    # 4. Fallback: extract from description/content HTML with bs4
    for field_name in ["description", "{http://purl.org/rss/1.0/modules/content/}encoded"]:
        el = item.find(field_name)
        if el is not None and el.text:
            soup = BeautifulSoup(el.text, "html.parser")
            img_tag = soup.find("img", src=True)
            if img_tag:
                url = str(img_tag["src"])
                if url.startswith("//"):
                    url = f"https:{url}"
                if _is_valid_image_url(url):
                    return url

    return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _local_name(tag: str) -> str:
    """Strip namespace from tag: {ns}name -> name."""
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def _text(parent, path: str, namespaces: dict | None = None) -> str:
    """Get text content of a child element, or empty string."""
    el = parent.find(path, namespaces) if namespaces else parent.find(path)
    if el is not None and el.text:
        return el.text.strip()
    return ""


def _clean_summary(html: str) -> str:
    """Clean HTML summary to plain text using bs4."""
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "iframe"]):
        tag.decompose()
    return soup.get_text(separator=" ", strip=True)


def _clean_text(text: str) -> str:
    """Normalise whitespace and trim."""
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip()


def _generate_slug(title: str) -> str:
    """Generate URL-friendly slug from title."""
    slug = title.lower()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s]+", "-", slug)
    slug = re.sub(r"-{2,}", "-", slug)
    slug = slug.strip("-")
    return slug[:80]


def _is_valid_image_url(url: str) -> bool:
    """Check if URL looks like a valid image."""
    if not url or not isinstance(url, str):
        return False
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        return False
    for domain in AD_DOMAINS:
        if domain in url.lower():
            return False
    return True

"""
Web page content extractor — replaces ArticleService.ts scraping logic.

Uses beautifulsoup4 with real CSS selectors, replacing:
  - 10+ regex patterns pretending to be CSS selectors
  - Loop-based HTML tag removal
  - Manual entity decoding

TS counterpart: ArticleService lines 465-788
"""

import re
from bs4 import BeautifulSoup


# CSS selectors for article content, ordered by specificity (highest first)
# These are REAL CSS selectors, not regex approximations
CONTENT_SELECTORS = [
    "article .entry-content",       # WordPress
    "article .post-content",        # WordPress theme variant
    ".article-body",                # Common news sites
    ".article-content",             # Common news sites
    ".story-body",                  # BBC-style
    ".post-body",                   # Blogger
    '[itemprop="articleBody"]',     # Schema.org
    "article",                      # Generic article tag
    ".entry-content",               # WordPress fallback
    ".post-content",                # WordPress fallback
    "main",                         # HTML5 main content
    ".content",                     # Generic
    "#content",                     # Generic
]

# Selectors for elements to REMOVE before extraction
NOISE_SELECTORS = [
    "script", "style", "iframe", "noscript",
    "nav", "footer", "header", "aside",
    ".ad-container", ".advertisement", ".social-share",
    ".related-posts", ".comments", ".sidebar",
    ".newsletter-signup", ".popup", ".modal",
    '[role="navigation"]', '[role="complementary"]',
]

# Image priority selectors (ordered by reliability)
IMAGE_SELECTORS = [
    ('meta[property="og:image"]', "content"),       # OpenGraph — most reliable
    ('meta[name="twitter:image"]', "content"),      # Twitter Card
    (".featured-image img", "src"),                  # WordPress featured
    ("article img", "src"),                          # First image in article
    (".article-image img", "src"),                   # Common pattern
    (".hero-image img", "src"),                      # Hero images
]


async def scrape_article(url: str, env=None) -> dict:
    """
    Scrape a web page and extract article content.

    Args:
        url: The URL to scrape
        env: Cloudflare env bindings (for fetch)

    Returns:
        {
            "title": str,
            "description": str,
            "content": str,
            "image_url": str | None,
            "author": str | None,
            "word_count": int,
            "reading_time_minutes": int,
        }

    TODO: use env for fetch once Python Workers FFI fetch is confirmed;
          for now this returns a stub if env.fetch is unavailable.
    """
    if not url or not url.startswith(("http://", "https://")):
        return {"error": "Invalid URL"}

    # TODO: fetch the page HTML via env or httpx
    # html = await _fetch_page(url, env)
    # For now, this function works with HTML passed directly for testing
    return {"error": "Direct fetch not yet implemented — pass HTML via /content/clean"}


def extract_from_html(html: str, base_url: str = "") -> dict:
    """
    Extract article data from raw HTML.

    This is the main extraction logic, usable both from the /content/scrape
    endpoint (after fetching) and directly for testing.
    """
    if not html:
        return {"error": "Empty HTML"}

    soup = BeautifulSoup(html, "html.parser")

    # ---------------------------------------------------------------
    # Remove noise elements first
    # ---------------------------------------------------------------
    for selector in NOISE_SELECTORS:
        for tag in soup.select(selector):
            tag.decompose()

    # ---------------------------------------------------------------
    # Extract title
    # ---------------------------------------------------------------
    title = _extract_title(soup)

    # ---------------------------------------------------------------
    # Extract meta description
    # ---------------------------------------------------------------
    description = _extract_meta(soup, "description") or _extract_meta(soup, "og:description") or ""

    # ---------------------------------------------------------------
    # Extract main content using CSS selectors (not regex)
    # ---------------------------------------------------------------
    content = ""
    for selector in CONTENT_SELECTORS:
        element = soup.select_one(selector)
        if element:
            content = element.get_text(separator=" ", strip=True)
            if len(content) > 100:
                break

    # Fallback: concatenate all paragraphs
    if len(content) < 100:
        paragraphs = soup.find_all("p")
        content = " ".join(p.get_text(strip=True) for p in paragraphs[:50])

    # Normalise whitespace
    content = re.sub(r"\s+", " ", content).strip()

    # Cap at 50k chars (matches TS limit)
    content = content[:50_000]

    # ---------------------------------------------------------------
    # Extract featured image
    # ---------------------------------------------------------------
    image_url = _extract_image(soup, base_url)

    # ---------------------------------------------------------------
    # Extract author
    # ---------------------------------------------------------------
    author = (
        _extract_meta(soup, "author")
        or _extract_meta(soup, "article:author")
        or _extract_byline(soup)
    )

    # ---------------------------------------------------------------
    # Reading time
    # ---------------------------------------------------------------
    word_count = len(content.split())
    reading_time = max(1, round(word_count / 200))  # ~200 wpm average

    return {
        "title": title,
        "description": description[:500],
        "content": content,
        "image_url": image_url,
        "author": author,
        "word_count": word_count,
        "reading_time_minutes": reading_time,
    }


def _extract_title(soup: BeautifulSoup) -> str:
    """Extract page title using multiple strategies."""
    # OpenGraph title (usually cleanest)
    og = soup.find("meta", property="og:title")
    if og and og.get("content"):
        return str(og["content"]).strip()

    # <title> tag
    if soup.title and soup.title.string:
        # Often has " | Site Name" suffix — strip it
        title = soup.title.string.strip()
        for sep in [" | ", " - ", " – ", " — ", " :: "]:
            if sep in title:
                title = title.split(sep)[0].strip()
        return title

    # First h1
    h1 = soup.find("h1")
    if h1:
        return h1.get_text(strip=True)

    return ""


def _extract_meta(soup: BeautifulSoup, name: str) -> str | None:
    """Extract content from a meta tag by name or property."""
    # Try property (OpenGraph)
    tag = soup.find("meta", property=name)
    if tag and tag.get("content"):
        return str(tag["content"]).strip()
    # Try name
    tag = soup.find("meta", attrs={"name": name})
    if tag and tag.get("content"):
        return str(tag["content"]).strip()
    return None


def _extract_image(soup: BeautifulSoup, base_url: str) -> str | None:
    """Extract featured image using prioritised CSS selectors."""
    for selector, attr in IMAGE_SELECTORS:
        tag = soup.select_one(selector)
        if tag:
            url = tag.get(attr, "")
            if url:
                url = _resolve_url(str(url), base_url)
                if url and not url.startswith("data:"):
                    return url
    return None


def _extract_byline(soup: BeautifulSoup) -> str | None:
    """Extract author from common byline patterns."""
    # Schema.org author
    author_tag = soup.find(itemprop="author")
    if author_tag:
        name = author_tag.find(itemprop="name")
        if name:
            return name.get_text(strip=True)
        return author_tag.get_text(strip=True)

    # Common class names
    for cls in ["byline", "author", "article-author"]:
        tag = soup.find(class_=re.compile(cls, re.IGNORECASE))
        if tag:
            text = tag.get_text(strip=True)
            # Strip common prefixes
            text = re.sub(r"^(By|Written by|Author:?)\s*", "", text, flags=re.IGNORECASE)
            if text and len(text) < 100:
                return text

    return None


def _resolve_url(url: str, base_url: str) -> str:
    """Resolve relative URLs to absolute."""
    if not url:
        return ""
    url = url.strip()
    if url.startswith("//"):
        return f"https:{url}"
    if url.startswith(("http://", "https://")):
        return url
    if url.startswith("/") and base_url:
        # Absolute path — combine with base URL origin
        # e.g. base="https://example.com/article/1" + "/images/photo.jpg"
        from urllib.parse import urlparse
        parsed = urlparse(base_url)
        return f"{parsed.scheme}://{parsed.netloc}{url}"
    return url

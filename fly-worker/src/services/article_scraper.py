"""Full article scraper — fetches and extracts article body from source URLs.

RSS feeds typically only provide a headline + truncated description (10-20%
of the article). This service fetches the original article page and extracts
the full body using Mozilla's Readability algorithm (same as Firefox Reader View).

The richer content improves:
- Keyword extraction (more text for AI)
- Quality scoring (textstat needs full text)
- BGE-M3 embeddings (more context = better vectors)
- Content pushed to mukoko-platform
"""

import httpx
from readability import Document
from bs4 import BeautifulSoup

# User-agent that identifies us as a news aggregator (not a generic bot)
USER_AGENT = "MukokoNews/2.0 (+https://news.mukoko.com; news aggregator)"

# Max response size to prevent memory issues (5MB)
MAX_CONTENT_SIZE = 5 * 1024 * 1024

# Timeout for fetching article pages
FETCH_TIMEOUT = 15


async def scrape_article(url: str) -> dict | None:
    """Fetch and extract full article content from a URL.

    Returns dict with extracted content, or None if scraping fails.
    Falls back gracefully — RSS content is always the fallback.
    """
    if not url or not url.startswith("http"):
        return None

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=FETCH_TIMEOUT,
            headers={"User-Agent": USER_AGENT},
        ) as client:
            resp = await client.get(url)

            if resp.status_code != 200:
                print(f"[SCRAPER] HTTP {resp.status_code} for {url[:80]}")
                return None

            # Check content size
            content_length = len(resp.content)
            if content_length > MAX_CONTENT_SIZE:
                print(f"[SCRAPER] Too large ({content_length} bytes): {url[:80]}")
                return None

            # Check content type is HTML
            content_type = resp.headers.get("content-type", "")
            if "html" not in content_type.lower():
                return None

            html = resp.text

    except httpx.TimeoutException:
        print(f"[SCRAPER] Timeout: {url[:80]}")
        return None
    except Exception as e:
        print(f"[SCRAPER] Fetch error: {type(e).__name__}: {url[:80]}")
        return None

    return extract_article(html, url)


def extract_article(html: str, url: str = "") -> dict | None:
    """Extract article content from HTML using Mozilla Readability.

    Returns:
        {
            "title": str,
            "body_html": str,       # Cleaned HTML
            "body_text": str,       # Plain text
            "word_count": int,
            "excerpt": str | None,  # Short description if found
        }
    """
    try:
        doc = Document(html, url=url)
        title = doc.short_title()
        body_html = doc.summary()

        if not body_html:
            return None

        # Extract plain text from the readability output
        soup = BeautifulSoup(body_html, "lxml")

        # Remove any remaining unwanted elements
        for tag in soup.find_all(["script", "style", "iframe", "nav", "footer"]):
            tag.decompose()

        body_text = soup.get_text(separator="\n")
        # Normalize whitespace
        body_text = "\n".join(
            line.strip() for line in body_text.split("\n") if line.strip()
        )

        word_count = len(body_text.split())

        # Skip if we got very little content (probably a paywall or error page)
        if word_count < 50:
            return None

        # Try to get meta description as excerpt
        full_soup = BeautifulSoup(html, "lxml")
        meta_desc = full_soup.find("meta", attrs={"name": "description"})
        excerpt = meta_desc.get("content") if meta_desc else None

        return {
            "title": title or "",
            "body_html": body_html,
            "body_text": body_text,
            "word_count": word_count,
            "excerpt": excerpt,
        }

    except Exception as e:
        print(f"[SCRAPER] Extract error: {type(e).__name__}: {url[:80]}")
        return None

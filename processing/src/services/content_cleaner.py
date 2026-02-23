"""
HTML content cleaner — replaces ArticleAIService.cleanContent().

Uses beautifulsoup4 for DOM-aware parsing, replacing:
  - do-while regex loops for nested tag removal
  - 4 regex patterns for image URL extraction
  - Hardcoded HTML entity map (&amp; &lt; &gt; etc.)
  - 8+ regex passes for whitespace normalisation

TS counterpart: ArticleAIService.cleanContent() lines 128-244
"""

import re
from bs4 import BeautifulSoup


# CSS class patterns that indicate ad/promo/navigation content
AD_CLASS_RE = re.compile(r"ad[-_]?|sponsor|promo|sidebar|social[-_]?share|newsletter|popup", re.IGNORECASE)

# Structural tags to remove (not article content)
REMOVE_TAGS = ["script", "style", "iframe", "nav", "footer", "header", "aside", "noscript"]


def clean_html_content(raw_html: str, options: dict | None = None) -> dict:
    """
    Clean HTML content and extract images.

    Args:
        raw_html: Raw HTML/text content
        options: Cleaning options matching ContentCleaningOptions:
            - remove_images: bool (default True)
            - extract_image_urls: bool (default True)
            - min_content_length: int (default 100)
            - remove_ad_elements: bool (default True)

    Returns:
        {
            "cleaned_content": str,
            "extracted_images": list[str],
            "removed_char_count": int,
        }
    """
    opts = options or {}
    remove_images = opts.get("remove_images", opts.get("removeImages", True))
    extract_images = opts.get("extract_image_urls", opts.get("extractImageUrls", True))
    min_length = opts.get("min_content_length", opts.get("minContentLength", 100))
    remove_ads = opts.get("remove_ad_elements", True)

    if not raw_html:
        return {
            "cleaned_content": "",
            "extracted_images": [],
            "removed_char_count": 0,
        }

    # Short plain text (no HTML) — skip bs4 processing
    if "<" not in raw_html and len(raw_html) < min_length:
        return {
            "cleaned_content": raw_html,
            "extracted_images": [],
            "removed_char_count": 0,
        }

    original_length = len(raw_html)
    soup = BeautifulSoup(raw_html, "html.parser")

    # ---------------------------------------------------------------
    # Step 1: Extract image URLs BEFORE cleaning (matches TS order)
    # ---------------------------------------------------------------
    extracted_images: list[str] = []
    if extract_images:
        extracted_images = _extract_images(soup)

    # ---------------------------------------------------------------
    # Step 2: Remove structural/ad elements
    # ---------------------------------------------------------------
    for tag in soup(REMOVE_TAGS):
        tag.decompose()

    if remove_ads:
        for tag in soup.find_all(class_=AD_CLASS_RE):
            tag.decompose()
        # Also remove common ad containers by id
        for tag in soup.find_all(id=AD_CLASS_RE):
            tag.decompose()

    # ---------------------------------------------------------------
    # Step 3: Remove images if requested
    # ---------------------------------------------------------------
    if remove_images:
        for tag in soup(["img", "figure", "picture", "figcaption"]):
            tag.decompose()

    # ---------------------------------------------------------------
    # Step 4: Get clean text — bs4 handles entity decoding automatically
    # ---------------------------------------------------------------
    text = soup.get_text(separator=" ", strip=True)

    # ---------------------------------------------------------------
    # Step 5: Normalise whitespace (single pass, not 8+ like TS)
    # ---------------------------------------------------------------
    text = re.sub(r"\s+", " ", text).strip()

    # ---------------------------------------------------------------
    # Step 6: Remove remaining noise
    # ---------------------------------------------------------------
    # Remove repeated characters (e.g. ====, -----, *****)
    text = re.sub(r"(.)\1{3,}", r"\1\1", text)

    removed_char_count = original_length - len(text)

    return {
        "cleaned_content": text,
        "extracted_images": extracted_images,
        "removed_char_count": removed_char_count,
    }


def _extract_images(soup: BeautifulSoup) -> list[str]:
    """
    Extract valid image URLs from parsed HTML.

    Replaces 4 regex patterns in ArticleAIService with bs4 tag queries.
    """
    seen: set[str] = set()
    images: list[str] = []

    # img tags
    for img in soup.find_all("img", src=True):
        url = _normalise_image_url(str(img["src"]))
        if url and url not in seen:
            seen.add(url)
            images.append(url)

    # picture > source tags
    for source in soup.find_all("source", srcset=True):
        # srcset can have multiple URLs; take the first
        srcset = str(source["srcset"]).split(",")[0].strip().split(" ")[0]
        url = _normalise_image_url(srcset)
        if url and url not in seen:
            seen.add(url)
            images.append(url)

    # Background images in inline styles (common in WordPress)
    for tag in soup.find_all(style=True):
        style = str(tag["style"])
        match = re.search(r"url\(['\"]?(https?://[^'\")\s]+)['\"]?\)", style)
        if match:
            url = match.group(1)
            if url not in seen:
                seen.add(url)
                images.append(url)

    return images


def _normalise_image_url(url: str) -> str | None:
    """Validate and normalise an image URL."""
    if not url or not isinstance(url, str):
        return None
    url = url.strip()
    # Protocol-relative
    if url.startswith("//"):
        url = f"https:{url}"
    # Only allow http(s)
    if not url.startswith(("http://", "https://")):
        return None
    # Block data URIs and javascript
    if url.startswith(("data:", "javascript:", "blob:", "vbscript:")):
        return None
    return url

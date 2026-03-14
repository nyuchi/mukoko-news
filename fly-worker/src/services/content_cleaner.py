"""HTML content cleaner for article bodies.

Strips unsafe HTML, normalizes whitespace, extracts readable text.
"""

import re

from bs4 import BeautifulSoup

# Tags to keep in cleaned content
ALLOWED_TAGS = {
    "p", "br", "b", "strong", "i", "em", "u",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "blockquote", "a",
}

# Tags to remove entirely (including content)
STRIP_TAGS = {
    "script", "style", "iframe", "form", "input",
    "nav", "footer", "header", "aside", "noscript",
    "svg", "canvas", "video", "audio", "object", "embed",
}


def clean_html(html: str) -> str:
    """Clean HTML content, keeping only safe readable elements."""
    if not html:
        return ""

    soup = BeautifulSoup(html, "lxml")

    # Remove unwanted tags entirely
    for tag in soup.find_all(STRIP_TAGS):
        tag.decompose()

    # Remove all attributes except href on <a> tags
    for tag in soup.find_all(True):
        if tag.name == "a":
            href = tag.get("href", "")
            tag.attrs = {"href": href} if href else {}
        else:
            tag.attrs = {}

    # Get cleaned HTML
    cleaned = str(soup)

    # Normalize whitespace
    cleaned = re.sub(r"\n\s*\n", "\n\n", cleaned)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)

    return cleaned.strip()


def extract_text(html: str) -> str:
    """Extract plain text from HTML, preserving paragraph breaks."""
    if not html:
        return ""

    soup = BeautifulSoup(html, "lxml")

    # Remove unwanted tags
    for tag in soup.find_all(STRIP_TAGS):
        tag.decompose()

    text = soup.get_text(separator="\n")
    text = re.sub(r"\n\s*\n", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)

    return text.strip()


def count_words(text: str) -> int:
    """Count words in text."""
    if not text:
        return 0
    return len(text.split())


def estimate_reading_time(word_count: int, wpm: int = 200) -> int:
    """Estimate reading time in minutes."""
    if word_count <= 0:
        return 0
    return max(1, round(word_count / wpm))

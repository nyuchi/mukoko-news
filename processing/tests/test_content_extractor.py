"""
Tests for content extractor service.

Covers: title extraction (og:title, <title>, h1), meta description,
content extraction via CSS selectors, image extraction, author detection,
URL resolution, noise removal.
"""

import pytest
from services.content_extractor import extract_from_html


SAMPLE_HTML = """
<!DOCTYPE html>
<html>
<head>
    <title>Zimbabwe Budget 2026 | Herald</title>
    <meta property="og:title" content="Zimbabwe Budget 2026 Highlights" />
    <meta property="og:description" content="Key highlights from the national budget" />
    <meta property="og:image" content="https://cdn.herald.co.zw/budget.jpg" />
    <meta name="author" content="Tendai Moyo" />
</head>
<body>
    <nav>Home | News | Sports</nav>
    <article>
        <h1>Zimbabwe Budget 2026 Highlights</h1>
        <div class="byline">By Tendai Moyo, Senior Reporter</div>
        <div class="article-body">
            <p>The Minister of Finance presented the 2026 national budget today.</p>
            <p>"We are committed to economic growth," said the Minister.</p>
            <p>Key allocations include education, health, and infrastructure.</p>
        </div>
    </article>
    <footer>Copyright 2026 Herald</footer>
    <script>analytics.track("pageview")</script>
</body>
</html>
"""


class TestExtractFromHtml:
    def test_extracts_og_title(self):
        result = extract_from_html(SAMPLE_HTML)
        assert result["title"] == "Zimbabwe Budget 2026 Highlights"

    def test_extracts_meta_description(self):
        result = extract_from_html(SAMPLE_HTML)
        assert "Key highlights" in result["description"]

    def test_extracts_content(self):
        result = extract_from_html(SAMPLE_HTML)
        assert "Minister of Finance" in result["content"]
        assert "economic growth" in result["content"]

    def test_removes_nav_and_footer(self):
        result = extract_from_html(SAMPLE_HTML)
        assert "Home | News | Sports" not in result["content"]
        assert "Copyright 2026" not in result["content"]

    def test_removes_scripts(self):
        result = extract_from_html(SAMPLE_HTML)
        assert "analytics" not in result["content"]

    def test_extracts_og_image(self):
        result = extract_from_html(SAMPLE_HTML)
        assert result["image_url"] == "https://cdn.herald.co.zw/budget.jpg"

    def test_extracts_author(self):
        result = extract_from_html(SAMPLE_HTML)
        assert result["author"] == "Tendai Moyo"

    def test_calculates_word_count(self):
        result = extract_from_html(SAMPLE_HTML)
        assert result["word_count"] > 0

    def test_calculates_reading_time(self):
        result = extract_from_html(SAMPLE_HTML)
        assert result["reading_time_minutes"] >= 1

    def test_empty_html(self):
        result = extract_from_html("")
        assert result.get("error") == "Empty HTML"

    def test_title_fallback_to_title_tag(self):
        html = "<html><head><title>Page Title | Site</title></head><body><p>Content</p></body></html>"
        result = extract_from_html(html)
        assert result["title"] == "Page Title"

    def test_title_fallback_to_h1(self):
        html = "<html><body><h1>Heading Title</h1><p>Content</p></body></html>"
        result = extract_from_html(html)
        assert result["title"] == "Heading Title"

    def test_content_fallback_to_paragraphs(self):
        html = "<html><body><p>First paragraph.</p><p>Second paragraph.</p></body></html>"
        result = extract_from_html(html)
        assert "First paragraph" in result["content"]
        assert "Second paragraph" in result["content"]

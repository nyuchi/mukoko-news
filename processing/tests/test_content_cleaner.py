"""
Tests for content cleaner service.

Covers: HTML tag removal, image extraction, ad element removal,
entity decoding, whitespace normalisation, edge cases.
"""

import pytest
from services.content_cleaner import clean_html_content


class TestCleanHtmlContent:
    def test_removes_script_tags(self):
        html = '<p>Hello</p><script>alert("xss")</script><p>World</p>'
        result = clean_html_content(html)
        assert "alert" not in result["cleaned_content"]
        assert "Hello" in result["cleaned_content"]
        assert "World" in result["cleaned_content"]

    def test_removes_style_tags(self):
        html = "<style>.foo { color: red; }</style><p>Content</p>"
        result = clean_html_content(html)
        assert "color" not in result["cleaned_content"]
        assert "Content" in result["cleaned_content"]

    def test_extracts_images(self):
        html = '<p>Text</p><img src="https://cdn.example.com/photo.jpg" /><p>More</p>'
        result = clean_html_content(html)
        assert "https://cdn.example.com/photo.jpg" in result["extracted_images"]

    def test_filters_data_uri_images(self):
        html = '<img src="data:image/png;base64,abc" /><img src="https://cdn.example.com/real.jpg" />'
        result = clean_html_content(html)
        assert len(result["extracted_images"]) == 1
        assert "cdn.example.com" in result["extracted_images"][0]

    def test_removes_ad_elements(self):
        html = '<div class="ad-container">Buy now!</div><p>Real content here</p>'
        result = clean_html_content(html)
        assert "Buy now" not in result["cleaned_content"]
        assert "Real content" in result["cleaned_content"]

    def test_normalises_whitespace(self):
        html = "<p>Too    many     spaces</p>"
        result = clean_html_content(html)
        assert "  " not in result["cleaned_content"]

    def test_removes_repeated_characters(self):
        html = "<p>Real text ====== separator</p>"
        result = clean_html_content(html)
        assert "======" not in result["cleaned_content"]
        assert "==" in result["cleaned_content"]

    def test_handles_empty_input(self):
        result = clean_html_content("")
        assert result["cleaned_content"] == ""
        assert result["extracted_images"] == []

    def test_short_content_passes_through(self):
        result = clean_html_content("Short", {"min_content_length": 100})
        assert result["cleaned_content"] == "Short"

    def test_decodes_html_entities(self):
        html = "<p>5 &gt; 3 &amp; 2 &lt; 4</p>"
        result = clean_html_content(html)
        assert ">" in result["cleaned_content"]
        assert "&" in result["cleaned_content"]
        assert "<" in result["cleaned_content"]

    def test_removes_nav_footer_header(self):
        html = "<nav>Menu</nav><article><p>Article body</p></article><footer>Copyright</footer>"
        result = clean_html_content(html)
        assert "Menu" not in result["cleaned_content"]
        assert "Copyright" not in result["cleaned_content"]
        assert "Article body" in result["cleaned_content"]

    def test_handles_nested_tags(self):
        html = "<div><div><p>Deep <span>nested <b>content</b></span></p></div></div>"
        result = clean_html_content(html)
        assert "Deep nested content" in result["cleaned_content"]

    def test_removed_char_count(self):
        html = "<script>long script here</script><p>Short</p>"
        result = clean_html_content(html)
        assert result["removed_char_count"] > 0

    def test_protocol_relative_images(self):
        html = '<img src="//cdn.example.com/photo.jpg" />'
        result = clean_html_content(html)
        assert result["extracted_images"][0].startswith("https://")

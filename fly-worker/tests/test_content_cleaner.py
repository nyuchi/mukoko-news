"""Tests for content cleaner service."""

from src.services.content_cleaner import clean_html, extract_text, count_words, estimate_reading_time


class TestCleanHtml:
    def test_removes_script_tags(self):
        html = '<p>Hello</p><script>alert("xss")</script><p>World</p>'
        result = clean_html(html)
        assert "script" not in result
        assert "alert" not in result
        assert "Hello" in result
        assert "World" in result

    def test_removes_style_tags(self):
        html = '<style>.foo{color:red}</style><p>Content</p>'
        result = clean_html(html)
        assert "style" not in result.lower() or "<style" not in result
        assert "Content" in result

    def test_strips_attributes_except_href(self):
        html = '<p class="fancy" id="p1">Text</p><a href="https://example.com" class="link">Link</a>'
        result = clean_html(html)
        assert 'class=' not in result
        assert 'id=' not in result
        assert 'href="https://example.com"' in result

    def test_empty_input(self):
        assert clean_html("") == ""
        assert clean_html(None) == ""


class TestExtractText:
    def test_extracts_plain_text(self):
        html = "<h1>Title</h1><p>Paragraph one.</p><p>Paragraph two.</p>"
        text = extract_text(html)
        assert "Title" in text
        assert "Paragraph one." in text
        assert "Paragraph two." in text
        assert "<" not in text

    def test_empty_input(self):
        assert extract_text("") == ""


class TestCountWords:
    def test_counts_words(self):
        assert count_words("one two three") == 3

    def test_empty_string(self):
        assert count_words("") == 0

    def test_whitespace_only(self):
        assert count_words("   ") == 0


class TestEstimateReadingTime:
    def test_short_article(self):
        assert estimate_reading_time(100) == 1  # 100 words = 0.5 min, rounds to 1

    def test_medium_article(self):
        assert estimate_reading_time(600) == 3  # 600 / 200 = 3

    def test_zero_words(self):
        assert estimate_reading_time(0) == 0

    def test_negative_words(self):
        assert estimate_reading_time(-10) == 0

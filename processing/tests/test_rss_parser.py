"""
Tests for RSS parser service.

Covers: feed parsing, image extraction, HTML cleaning, slug generation,
malformed feeds, empty feeds, Atom format, media namespaces.
"""

import pytest
from services.rss_parser import parse_rss_feed, _clean_summary, _generate_slug, _extract_image_rss, _is_valid_image_url


# ---------------------------------------------------------------------------
# Sample RSS XML fixtures
# ---------------------------------------------------------------------------

RSS_SAMPLE = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Test News</title>
    <item>
      <title>Zimbabwe economy grows 5%</title>
      <link>https://example.com/article/1</link>
      <description>&lt;p&gt;The economy grew by 5% in Q3.&lt;/p&gt;</description>
      <pubDate>Mon, 10 Feb 2026 12:00:00 GMT</pubDate>
      <author>John Moyo</author>
      <media:thumbnail url="https://cdn.example.com/photo.jpg" />
    </item>
    <item>
      <title>Harare weather update</title>
      <link>https://example.com/article/2</link>
      <description>Sunny skies expected across the capital.</description>
    </item>
  </channel>
</rss>"""

ATOM_SAMPLE = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Atom article title</title>
    <link href="https://example.com/atom/1" />
    <summary>Summary text</summary>
    <updated>2026-02-10T12:00:00Z</updated>
  </entry>
</feed>"""

SOURCE = {"id": 1, "name": "Test Source", "category": "news", "country_id": "ZW"}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestParseRSSFeed:
    @pytest.mark.asyncio
    async def test_parses_rss_feed(self):
        result = await parse_rss_feed(RSS_SAMPLE, SOURCE)
        assert len(result["articles"]) == 2
        assert result["feed_title"] == "Test News"
        assert result["item_count"] == 2

    @pytest.mark.asyncio
    async def test_parses_atom_feed(self):
        result = await parse_rss_feed(ATOM_SAMPLE, SOURCE)
        assert len(result["articles"]) == 1
        assert result["articles"][0]["title"] == "Atom article title"

    @pytest.mark.asyncio
    async def test_empty_feed(self):
        result = await parse_rss_feed("", SOURCE)
        assert result["articles"] == []
        assert "error" in result

    @pytest.mark.asyncio
    async def test_malformed_xml(self):
        result = await parse_rss_feed("<not valid xml", SOURCE)
        assert result["articles"] == []

    @pytest.mark.asyncio
    async def test_extracts_media_thumbnail(self):
        result = await parse_rss_feed(RSS_SAMPLE, SOURCE)
        first = result["articles"][0]
        assert first["image_url"] == "https://cdn.example.com/photo.jpg"

    @pytest.mark.asyncio
    async def test_article_fields(self):
        result = await parse_rss_feed(RSS_SAMPLE, SOURCE)
        article = result["articles"][0]
        assert article["title"] == "Zimbabwe economy grows 5%"
        assert article["original_url"] == "https://example.com/article/1"
        assert article["source"] == "Test Source"
        assert article["source_id"] == 1
        assert article["country_id"] == "ZW"
        assert article["author"] == "John Moyo"

    @pytest.mark.asyncio
    async def test_limits_to_20_items(self):
        # Build a feed with 25 items
        items = "\n".join(
            f'<item><title>Article {i}</title><link>https://example.com/{i}</link></item>'
            for i in range(25)
        )
        xml = f'<?xml version="1.0"?><rss version="2.0"><channel><title>Big Feed</title>{items}</channel></rss>'
        result = await parse_rss_feed(xml, SOURCE)
        assert len(result["articles"]) <= 20


class TestCleanSummary:
    def test_removes_html_tags(self):
        assert _clean_summary("<p>Hello <b>world</b></p>") == "Hello world"

    def test_removes_scripts(self):
        assert _clean_summary('<script>alert("xss")</script>Clean text') == "Clean text"

    def test_handles_empty(self):
        assert _clean_summary("") == ""

    def test_decodes_entities(self):
        # bs4 handles HTML entities automatically
        result = _clean_summary("&amp; &lt; &gt;")
        assert "&" in result
        assert "<" in result


class TestGenerateSlug:
    def test_basic_slug(self):
        assert _generate_slug("Hello World") == "hello-world"

    def test_removes_special_chars(self):
        assert _generate_slug("What's happening?") == "whats-happening"

    def test_limits_length(self):
        long_title = "A " * 50
        assert len(_generate_slug(long_title)) <= 80

    def test_strips_trailing_hyphens(self):
        assert not _generate_slug("Test - ").endswith("-")

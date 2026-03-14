"""Shared test fixtures for Fly.io worker tests."""

import pytest


@pytest.fixture
def sample_source():
    """A sample organization (RSS source) record."""
    return {
        "id": "test-source",
        "name": "Test News",
        "url": "https://test-news.example.com",
        "rss_feed_url": "https://test-news.example.com/feed/",
        "area_served": "ZW",
        "article_section_id": "general",
        "in_language": "en",
        "health_status": "healthy",
        "consecutive_failures": 0,
        "last_fetched_at": None,
    }


@pytest.fixture
def sample_rss_xml():
    """A minimal valid RSS 2.0 feed."""
    return """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test News</title>
    <link>https://test-news.example.com</link>
    <description>Test news feed</description>
    <item>
      <title>Zimbabwe Parliament Opens New Session</title>
      <link>https://test-news.example.com/article/1</link>
      <description>Parliament opened its new session today with key debates on economic reform.</description>
      <pubDate>Mon, 10 Mar 2026 10:00:00 +0200</pubDate>
      <guid>https://test-news.example.com/article/1</guid>
      <author>Jane Reporter</author>
      <category>Politics</category>
      <enclosure url="https://test-news.example.com/images/parliament.jpg" type="image/jpeg" />
    </item>
    <item>
      <title>Gold Prices Surge on Global Demand</title>
      <link>https://test-news.example.com/article/2</link>
      <description>Gold prices hit record highs driven by increased demand from Asian markets.</description>
      <pubDate>Mon, 10 Mar 2026 08:30:00 +0200</pubDate>
      <guid>https://test-news.example.com/article/2</guid>
      <author>John Finance</author>
    </item>
    <item>
      <title></title>
      <link></link>
      <description>This entry has no title or link and should be skipped.</description>
    </item>
  </channel>
</rss>"""


@pytest.fixture
def sample_atom_xml():
    """A minimal valid Atom feed."""
    return """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test Atom Feed</title>
  <link href="https://test-news.example.com"/>
  <entry>
    <title>New Tech Hub Opens in Harare</title>
    <link href="https://test-news.example.com/article/3"/>
    <id>urn:uuid:test-article-3</id>
    <updated>2026-03-10T12:00:00Z</updated>
    <summary>A new technology hub has opened in Harare CBD.</summary>
    <author><name>Tech Reporter</name></author>
  </entry>
</feed>"""


@pytest.fixture
def sample_article():
    """A sample article dict as returned by the RSS parser."""
    return {
        "headline": "Zimbabwe Parliament Opens New Session",
        "description": "Parliament opened its new session today.",
        "article_body": "<p>Parliament opened its new session today with key debates.</p>",
        "slug": "zimbabwe-parliament-opens-new-session",
        "main_entity_of_page": "https://test-news.example.com/article/1",
        "rss_guid": "https://test-news.example.com/article/1",
        "image": "https://test-news.example.com/images/parliament.jpg",
        "author_name": "Jane Reporter",
        "publisher_id": "test-source",
        "publisher_name": "Test News",
        "article_section_id": "politics",
        "about_country_id": "ZW",
        "date_published": "2026-03-10T10:00:00+02:00",
        "content_hash": "abc123def456",
        "in_language": "en",
    }

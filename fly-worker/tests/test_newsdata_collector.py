"""Tests for the newsdata.io collector job."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.jobs.newsdata_collector import (
    _insert_article,
    _is_feed,
    _parse_newsdata_date,
    _resolve_source,
    collect_newsdata,
)
from src.services.newsdata_client import map_country, map_language


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_db(
    articles_coll=None,
    feed_sources_coll=None,
    pipeline_logs_coll=None,
    orgs_coll=None,
    candidates_coll=None,
):
    """Build a minimal Motor-style DB mock with per-collection dispatch."""
    if articles_coll is None:
        articles_coll = MagicMock()
        articles_coll.find_one = AsyncMock(return_value=None)
        articles_coll.insert_one = AsyncMock()

    if feed_sources_coll is None:
        feed_sources_coll = MagicMock()
        feed_sources_coll.find_one = AsyncMock(return_value=None)
        feed_sources_coll.insert_one = AsyncMock()

    if pipeline_logs_coll is None:
        pipeline_logs_coll = MagicMock()
        pipeline_logs_coll.insert_one = AsyncMock()

    if orgs_coll is None:
        orgs_coll = MagicMock()
        orgs_coll.find_one = AsyncMock(return_value=None)

    if candidates_coll is None:
        candidates_coll = MagicMock()
        candidates_coll.find_one = AsyncMock(return_value=None)
        candidates_coll.insert_one = AsyncMock()
        candidates_coll.update_one = AsyncMock()

    colls = {
        "articles": articles_coll,
        "feedSources": feed_sources_coll,
        "pipelineLogs": pipeline_logs_coll,
        "newsMediaOrganizations": orgs_coll,
        "sourceDiscoveryCandidates": candidates_coll,
    }
    db = MagicMock()
    db.__getitem__ = MagicMock(side_effect=colls.__getitem__)
    return db, articles_coll, feed_sources_coll, pipeline_logs_coll, orgs_coll, candidates_coll


def _raw_article(
    source_id="herald_zw",
    source_name="The Herald",
    source_url="https://www.herald.co.zw",
    link="https://www.herald.co.zw/article/1",
    title="Zimbabwe Economy Grows 5%",
    country=None,
    language="english",
    duplicate=False,
):
    return {
        "article_id": "art-001",
        "title": title,
        "link": link,
        "description": "Economy grows at record pace.",
        "content": "<p>Full article content here.</p>",
        "pubDate": "2026-06-14 10:00:00",
        "image_url": "https://www.herald.co.zw/img/economy.jpg",
        "creator": ["Jane Reporter"],
        "category": ["business"],
        "source_id": source_id,
        "source_name": source_name,
        "source_url": source_url,
        "country": country or ["zimbabwe"],
        "language": language,
        "keywords": ["economy", "zimbabwe"],
        "duplicate": duplicate,
    }


# ---------------------------------------------------------------------------
# map_country / map_language
# ---------------------------------------------------------------------------

class TestMapping:
    def test_map_country_known(self):
        assert map_country(["zimbabwe"]) == "ZW"
        assert map_country(["kenya"]) == "KE"
        assert map_country(["ivory coast"]) == "CI"

    def test_map_country_unknown_defaults_to_zw(self):
        assert map_country(["atlantis"]) == "ZW"

    def test_map_country_empty_defaults_to_zw(self):
        assert map_country([]) == "ZW"

    def test_map_language_known(self):
        assert map_language("english") == "en"
        assert map_language("french") == "fr"
        assert map_language("swahili") == "sw"

    def test_map_language_unknown_uses_first_two_chars(self):
        assert map_language("yoruba") == "yo"

    def test_map_language_empty_returns_en(self):
        assert map_language("") == "en"


# ---------------------------------------------------------------------------
# _is_feed
# ---------------------------------------------------------------------------

class TestIsFeed:
    def test_rss_content_type(self):
        assert _is_feed("<rss>...</rss>", "application/rss+xml")

    def test_atom_content_type(self):
        assert _is_feed("<feed>...</feed>", "application/atom+xml")

    def test_xml_body_rss_root(self):
        assert _is_feed('<?xml?><rss version="2.0">', "text/html")

    def test_xml_body_feed_root(self):
        assert _is_feed("  <feed xmlns=", "text/plain")

    def test_html_not_feed(self):
        assert not _is_feed("<html><body>News</body></html>", "text/html")


# ---------------------------------------------------------------------------
# _parse_newsdata_date
# ---------------------------------------------------------------------------

class TestParseNewsdataDate:
    def test_parses_standard_format(self):
        from datetime import timezone
        dt = _parse_newsdata_date("2026-06-14 10:30:00")
        assert dt is not None
        assert dt.year == 2026
        assert dt.month == 6
        assert dt.day == 14
        assert dt.tzinfo == timezone.utc

    def test_returns_none_for_none(self):
        assert _parse_newsdata_date(None) is None

    def test_returns_none_for_invalid(self):
        assert _parse_newsdata_date("not-a-date") is None


# ---------------------------------------------------------------------------
# collect_newsdata — top-level job
# ---------------------------------------------------------------------------

class TestCollectNewsdata:
    async def test_skips_when_no_api_key(self):
        db, _, _, logs, _, _ = _make_db()
        with (
            patch("src.jobs.newsdata_collector.settings") as mock_settings,
            patch("src.jobs.newsdata_collector.get_db", return_value=db),
        ):
            mock_settings.newsdata_api_key = ""
            await collect_newsdata()
        logs.insert_one.assert_not_called()

    async def test_logs_success_on_completion(self):
        db, articles, feed_sources, logs, orgs, candidates = _make_db()

        mock_client = MagicMock()
        mock_client.get_latest_news = AsyncMock(
            return_value={"status": "success", "results": []}
        )

        with (
            patch("src.jobs.newsdata_collector.settings") as mock_settings,
            patch("src.jobs.newsdata_collector.get_db", return_value=db),
            patch("src.jobs.newsdata_collector.NewsdataClient", return_value=mock_client),
            patch("src.jobs.newsdata_collector.process_articles_batch", new_callable=AsyncMock),
        ):
            mock_settings.newsdata_api_key = "test-key"
            await collect_newsdata()

        logs.insert_one.assert_called_once()
        call_doc = logs.insert_one.call_args[0][0]
        assert call_doc["jobType"] == "newsdata_collection"
        assert call_doc["status"] == "success"

    async def test_counts_errors_when_api_raises(self):
        """Per-language errors are caught; the job still finishes and logs success with errors."""
        db, _, _, logs, _, _ = _make_db()

        mock_client = MagicMock()
        mock_client.get_latest_news = AsyncMock(side_effect=RuntimeError("boom"))

        with (
            patch("src.jobs.newsdata_collector.settings") as mock_settings,
            patch("src.jobs.newsdata_collector.get_db", return_value=db),
            patch("src.jobs.newsdata_collector.NewsdataClient", return_value=mock_client),
            patch("src.jobs.newsdata_collector.process_articles_batch", new_callable=AsyncMock),
        ):
            mock_settings.newsdata_api_key = "test-key"
            await collect_newsdata()

        logs.insert_one.assert_called_once()
        call_doc = logs.insert_one.call_args[0][0]
        assert call_doc["status"] == "success"
        assert call_doc["errors"] > 0

    async def test_skips_duplicate_articles(self):
        raw = _raw_article(duplicate=True)
        db, articles, feed_sources, logs, orgs, candidates = _make_db()

        mock_client = MagicMock()
        mock_client.get_latest_news = AsyncMock(
            return_value={"status": "success", "results": [raw]}
        )

        with (
            patch("src.jobs.newsdata_collector.settings") as mock_settings,
            patch("src.jobs.newsdata_collector.get_db", return_value=db),
            patch("src.jobs.newsdata_collector.NewsdataClient", return_value=mock_client),
            patch("src.jobs.newsdata_collector.process_articles_batch", new_callable=AsyncMock),
        ):
            mock_settings.newsdata_api_key = "test-key"
            await collect_newsdata()

        articles.insert_one.assert_not_called()


# ---------------------------------------------------------------------------
# _resolve_source
# ---------------------------------------------------------------------------

class TestResolveSource:
    async def test_uses_cache_on_second_call(self):
        db, _, feed_sources, _, orgs, candidates = _make_db()
        cache: dict = {}

        # Prime the cache manually
        cache["herald_zw"] = ("existing-id", "org-herald-zw")

        result = await _resolve_source(db, _raw_article(), "ZW", "en", cache, {"new_sources": 0})

        assert result == ("existing-id", "org-herald-zw")
        feed_sources.find_one.assert_not_called()

    async def test_returns_existing_feed_source_from_db(self):
        feed_sources_coll = MagicMock()
        feed_sources_coll.find_one = AsyncMock(
            return_value={"_id": "existing-fs", "mediaOrganizationId": "org-abc"}
        )
        db, _, _, _, orgs, candidates = _make_db(feed_sources_coll=feed_sources_coll)
        cache: dict = {}

        result = await _resolve_source(db, _raw_article(), "ZW", "en", cache, {"new_sources": 0})
        assert result == ("existing-fs", "org-abc")
        assert cache["herald_zw"] == ("existing-fs", "org-abc")

    async def test_creates_new_source_with_rss_found(self):
        db, _, feed_sources, _, orgs, candidates = _make_db()
        stats = {"new_sources": 0}
        cache: dict = {}

        with patch(
            "src.jobs.newsdata_collector._probe_rss",
            new_callable=AsyncMock,
            return_value="https://www.herald.co.zw/feed/",
        ):
            result = await _resolve_source(db, _raw_article(), "ZW", "en", cache, stats)

        assert result[0] == "newsdata-herald_zw"
        assert stats["new_sources"] == 1
        # feedSource should have been created with the RSS URL
        inserted = feed_sources.insert_one.call_args[0][0]
        assert inserted["feedUrl"] == "https://www.herald.co.zw/feed/"
        assert inserted["isActive"] is True
        assert inserted["feedType"] == "rss"

    async def test_creates_inactive_source_without_rss(self):
        db, _, feed_sources, _, orgs, candidates = _make_db()
        stats = {"new_sources": 0}
        cache: dict = {}

        with patch(
            "src.jobs.newsdata_collector._probe_rss",
            new_callable=AsyncMock,
            return_value=None,
        ):
            result = await _resolve_source(db, _raw_article(), "ZW", "en", cache, stats)

        assert result[0] == "newsdata-herald_zw"
        inserted = feed_sources.insert_one.call_args[0][0]
        assert inserted["feedUrl"] is None
        assert inserted["isActive"] is False
        assert inserted["feedType"] == "newsdata_api"


# ---------------------------------------------------------------------------
# _insert_article
# ---------------------------------------------------------------------------

class TestInsertArticle:
    async def test_inserts_article_and_returns_id(self):
        db, articles, _, _, _, _ = _make_db()
        raw = _raw_article()

        article_id = await _insert_article(db, raw, raw["link"], "newsdata-herald_zw", "org-herald-zw", "ZW", "en")

        assert article_id is not None
        doc = articles.insert_one.call_args[0][0]
        assert doc["headline"] == "Zimbabwe Economy Grows 5%"
        assert doc["feedSourceId"] == "newsdata-herald_zw"
        assert doc["mediaOrganizationId"] == "org-herald-zw"
        assert doc["ingestionMethod"] == "newsdata_api"
        assert doc["status"] == "approved"
        assert doc["isApproved"] is True

    async def test_returns_none_for_missing_headline(self):
        db, articles, _, _, _, _ = _make_db()
        raw = _raw_article(title="")

        result = await _insert_article(db, raw, raw["link"], "newsdata-herald_zw", None, "ZW", "en")

        assert result is None
        articles.insert_one.assert_not_called()

    async def test_includes_image_object(self):
        db, articles, _, _, _, _ = _make_db()
        raw = _raw_article()
        await _insert_article(db, raw, raw["link"], "newsdata-herald_zw", None, "ZW", "en")

        doc = articles.insert_one.call_args[0][0]
        assert doc["image"] == [{"@type": "ImageObject", "url": "https://www.herald.co.zw/img/economy.jpg"}]

    async def test_date_parsed_correctly(self):
        from datetime import timezone
        db, articles, _, _, _, _ = _make_db()
        raw = _raw_article()
        await _insert_article(db, raw, raw["link"], "newsdata-herald_zw", None, "ZW", "en")

        doc = articles.insert_one.call_args[0][0]
        assert doc["datePublished"].year == 2026
        assert doc["datePublished"].tzinfo == timezone.utc

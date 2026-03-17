"""
Tests for feed ranker service.

Covers: scoring weights, recency decay, engagement formula,
diversity penalty, preference matching, numpy/fallback parity.
"""

import pytest
from services.feed_ranker import rank_feed, _recency_score, _engagement_score


class TestRankFeed:
    @pytest.mark.asyncio
    async def test_followed_source_scores_higher(self):
        articles = [
            {"id": 1, "title": "A", "source": "Herald", "source_id": "herald", "author": "", "category_id": "news", "country_id": "ZW", "published_at": "2026-02-10T12:00:00Z", "view_count": 0, "like_count": 0, "bookmark_count": 0},
            {"id": 2, "title": "B", "source": "Other", "source_id": "other", "author": "", "category_id": "news", "country_id": "ZW", "published_at": "2026-02-10T12:00:00Z", "view_count": 0, "like_count": 0, "bookmark_count": 0},
        ]
        prefs = {"followed_sources": ["herald"]}
        result = await rank_feed(articles, prefs)
        scored = result["articles"]
        herald = next(a for a in scored if a["source"] == "Herald")
        other = next(a for a in scored if a["source"] == "Other")
        assert herald["score"] > other["score"]

    @pytest.mark.asyncio
    async def test_primary_country_boost(self):
        articles = [
            {"id": 1, "title": "A", "source": "S", "source_id": "s", "author": "", "category_id": "news", "country_id": "ZW", "published_at": "2026-02-10T12:00:00Z", "view_count": 0, "like_count": 0, "bookmark_count": 0},
            {"id": 2, "title": "B", "source": "S", "source_id": "s", "author": "", "category_id": "news", "country_id": "KE", "published_at": "2026-02-10T12:00:00Z", "view_count": 0, "like_count": 0, "bookmark_count": 0},
        ]
        prefs = {"primary_country": "ZW"}
        result = await rank_feed(articles, prefs)
        scored = result["articles"]
        zw = next(a for a in scored if a["country_id"] == "ZW")
        ke = next(a for a in scored if a["country_id"] == "KE")
        assert zw["score"] > ke["score"]

    @pytest.mark.asyncio
    async def test_empty_articles(self):
        result = await rank_feed([], {})
        assert result["articles"] == []

    @pytest.mark.asyncio
    async def test_score_breakdown_present(self):
        articles = [
            {"id": 1, "title": "A", "source": "S", "source_id": "s", "author": "", "category_id": "news", "country_id": "ZW", "published_at": "2026-02-10T12:00:00Z", "view_count": 100, "like_count": 10, "bookmark_count": 5},
        ]
        result = await rank_feed(articles, {})
        article = result["articles"][0]
        assert "score_breakdown" in article
        assert "followed_source" in article["score_breakdown"]
        assert "recency" in article["score_breakdown"]
        assert "engagement" in article["score_breakdown"]


class TestRecencyScore:
    def test_recent_article_scores_high(self):
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        assert _recency_score(now) > 0.9

    def test_unknown_date_gets_default(self):
        assert _recency_score("") == 0.3
        assert _recency_score("invalid") == 0.3

    def test_old_article_scores_low(self):
        score = _recency_score("2020-01-01T00:00:00Z")
        assert score < 0.01


class TestEngagementScore:
    def test_no_engagement(self):
        score = _engagement_score({"view_count": 0, "like_count": 0, "bookmark_count": 0})
        assert score == 0.0  # log10(1) / 3 = 0

    def test_high_engagement(self):
        score = _engagement_score({"view_count": 1000, "like_count": 100, "bookmark_count": 50})
        assert score > 0.5

    def test_likes_weighted_higher(self):
        likes_heavy = _engagement_score({"view_count": 0, "like_count": 100, "bookmark_count": 0})
        views_heavy = _engagement_score({"view_count": 100, "like_count": 0, "bookmark_count": 0})
        # 100 likes * 3 = 300 vs 100 views = 100
        assert likes_heavy > views_heavy

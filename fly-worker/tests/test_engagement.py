"""Tests for engagement score computation."""

from datetime import datetime, timezone

from src.jobs.engagement import _compute_score


class TestComputeScore:
    def test_zero_engagement(self):
        article = {
            "view_count": 0,
            "like_count": 0,
            "bookmark_count": 0,
            "share_count": 0,
            "date_published": datetime.now(timezone.utc),
        }
        assert _compute_score(article) == 0.0

    def test_basic_engagement(self):
        article = {
            "view_count": 100,
            "like_count": 10,
            "bookmark_count": 5,
            "share_count": 3,
            "date_published": datetime.now(timezone.utc),
        }
        score = _compute_score(article)
        # raw = 100*1 + 10*3 + 5*5 + 3*2 = 100 + 30 + 25 + 6 = 161
        # decay = 1 / (1 + 0/48) = 1.0
        # score = 161 * 1.0 = 161, but >100 so log scale
        assert score > 100

    def test_time_decay(self):
        from datetime import timedelta

        recent = {
            "view_count": 50,
            "like_count": 5,
            "bookmark_count": 0,
            "share_count": 0,
            "date_published": datetime.now(timezone.utc),
        }
        old = {
            "view_count": 50,
            "like_count": 5,
            "bookmark_count": 0,
            "share_count": 0,
            "date_published": datetime.now(timezone.utc) - timedelta(hours=96),
        }

        recent_score = _compute_score(recent)
        old_score = _compute_score(old)

        assert recent_score > old_score

    def test_none_values_treated_as_zero(self):
        article = {
            "view_count": None,
            "like_count": None,
            "bookmark_count": None,
            "share_count": None,
            "date_published": datetime.now(timezone.utc),
        }
        assert _compute_score(article) == 0.0

    def test_no_date_published(self):
        article = {
            "view_count": 10,
            "like_count": 0,
            "bookmark_count": 0,
            "share_count": 0,
            "date_published": None,
        }
        score = _compute_score(article)
        assert score > 0  # Uses 0.5 decay fallback

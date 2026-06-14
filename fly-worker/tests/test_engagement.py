"""Tests for engagement score aggregation."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.jobs.engagement import recalc_engagement_scores


def _make_db(contributions=None, definitions=None):
    """Return (eng_db, news_db, articles_coll) mocks for the engagement job.

    MagicMock.__getitem__ returns the same object for every key, so we must
    use side_effect to dispatch each collection name to a distinct mock.
    """
    contrib_coll = MagicMock()
    contrib_coll.find.return_value.to_list = AsyncMock(return_value=contributions or [])

    defn_coll = MagicMock()
    defn_coll.find.return_value.to_list = AsyncMock(return_value=definitions or [])

    eng_colls = {"aggregateContributions": contrib_coll, "aggregateDefinitions": defn_coll}
    eng_db = MagicMock()
    eng_db.__getitem__ = MagicMock(side_effect=eng_colls.__getitem__)

    articles_coll = MagicMock()
    articles_coll.update_one = AsyncMock(return_value=MagicMock(modified_count=1))

    news_db = MagicMock()
    news_db.__getitem__ = MagicMock(side_effect={"articles": articles_coll}.__getitem__)

    return eng_db, news_db, articles_coll


class TestEngagement:
    async def test_no_contributions_is_noop(self):
        eng_db, news_db, articles_coll = _make_db(contributions=[])
        with (
            patch("src.jobs.engagement.get_engagement_db", return_value=eng_db),
            patch("src.jobs.engagement.get_news_db", return_value=news_db),
        ):
            await recalc_engagement_scores()
        articles_coll.update_one.assert_not_called()

    async def test_contributions_without_article_scope_are_skipped(self):
        """Contributions whose definition has no articleId in scopeFilters are ignored."""
        contributions = [{"aggregateDefinitionId": "def-1", "contributionPayload": {"reactionCount": 5}}]
        definitions = [{"_id": "def-1", "aggregateType": "engagement_count", "scopeFilters": {}}]
        eng_db, news_db, articles_coll = _make_db(contributions=contributions, definitions=definitions)

        with (
            patch("src.jobs.engagement.get_engagement_db", return_value=eng_db),
            patch("src.jobs.engagement.get_news_db", return_value=news_db),
        ):
            await recalc_engagement_scores()
        articles_coll.update_one.assert_not_called()

    async def test_updates_article_ubuntu_score(self):
        contributions = [{"aggregateDefinitionId": "def-1", "contributionPayload": {"reactionCount": 10}}]
        definitions = [{"_id": "def-1", "aggregateType": "engagement_count", "scopeFilters": {"articleId": "art-abc"}}]
        eng_db, news_db, articles_coll = _make_db(contributions=contributions, definitions=definitions)

        with (
            patch("src.jobs.engagement.get_engagement_db", return_value=eng_db),
            patch("src.jobs.engagement.get_news_db", return_value=news_db),
        ):
            await recalc_engagement_scores()

        articles_coll.update_one.assert_called_once()
        filter_arg, update_arg = articles_coll.update_one.call_args[0]
        assert filter_arg == {"_id": "art-abc"}
        assert "bundu.ubuntuScoreSnapshot" in update_arg["$set"]
        assert update_arg["$set"]["bundu.ubuntuScoreSnapshot"] >= 0.0

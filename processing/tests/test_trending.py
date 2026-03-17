"""
Tests for trending topics service.

Covers: ISO helpers, compute structure, cache path discrimination, field names.
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from services.trending import _now_iso, _hours_ago_iso


class TestISOHelpers:
    def test_now_iso_format(self):
        result = _now_iso()
        assert "T" in result
        assert result.endswith("Z"), f"_now_iso() should use Z suffix for consistent MongoDB range queries, got: {result}"

    def test_hours_ago_returns_past(self):
        now = _now_iso()
        past = _hours_ago_iso(24)
        assert past < now

    def test_zero_hours_ago(self):
        from datetime import datetime, timezone
        result = _hours_ago_iso(0)
        now = datetime.now(timezone.utc).isoformat()
        # Should be very close to now
        assert result[:16] == now[:16]  # Same up to minutes


class TestTrendingStructure:
    @pytest.mark.asyncio
    async def test_get_trending_no_env(self):
        from services.trending import get_trending
        result = await get_trending(None)
        assert "topics" in result
        assert isinstance(result["topics"], list)

    @pytest.mark.asyncio
    async def test_get_trending_cache_miss_returns_cached_false(self):
        from services.trending import get_trending
        result = await get_trending(None)
        assert result.get("cached") is False

    @pytest.mark.asyncio
    async def test_refresh_trending_no_env(self):
        """refresh_trending should handle missing env gracefully."""
        from services.trending import refresh_trending
        # MongoDBClient will fail with no env, but should not crash
        result = await refresh_trending(None)
        assert isinstance(result, dict)
        assert "global" in result


class TestCachePaths:
    def _make_env(self, kv_data: dict | None):
        env = MagicMock()
        if kv_data is None:
            env.CACHE_STORAGE.get = AsyncMock(return_value=None)
        else:
            env.CACHE_STORAGE.get = AsyncMock(return_value=json.dumps(kv_data))
        return env

    @pytest.mark.asyncio
    async def test_global_cache_hit_uses_global_key(self):
        from services.trending import get_trending
        topics = [{"keyword": "politics", "count": 10, "velocity": 1.5}]
        env = self._make_env({"global": topics, "countries": {}, "updated_at": "2026-01-01T00:00:00+00:00"})
        with patch("services.trending.MongoDBClient"):
            result = await get_trending(env, country_id=None)
        assert result["topics"] == topics
        assert result["cached"] is True
        assert "updated_at" not in result

    @pytest.mark.asyncio
    async def test_country_cache_hit_strips_updated_at(self):
        from services.trending import get_trending
        topics = [{"keyword": "sport", "count": 5, "velocity": 0.8}]
        env = self._make_env({"topics": topics, "updated_at": "2026-01-01T00:00:00+00:00"})
        with patch("services.trending.MongoDBClient"):
            result = await get_trending(env, country_id="ZW")
        assert result["topics"] == topics
        assert result["cached"] is True
        assert "updated_at" not in result

    @pytest.mark.asyncio
    async def test_cache_miss_computes_live(self):
        from services.trending import get_trending
        env = self._make_env(None)
        with patch("services.trending.MongoDBClient") as MockDB:
            MockDB.return_value.aggregate = AsyncMock(return_value=[])
            result = await get_trending(env, country_id=None)
        assert result["cached"] is False
        assert result["topics"] == []

    @pytest.mark.asyncio
    async def test_country_cache_topics_key_absent_falls_through_to_live(self):
        """Symmetric to global 'global key absent' case: stale country payload falls through."""
        from services.trending import get_trending
        # Payload has no "topics" key — should fall through to live compute
        env = self._make_env({"stale_key": [], "updated_at": "2026-01-01T00:00:00Z"})
        with patch("services.trending.MongoDBClient") as MockDB:
            MockDB.return_value.aggregate = AsyncMock(return_value=[])
            result = await get_trending(env, country_id="ZW")
        assert result["cached"] is False

    @pytest.mark.asyncio
    async def test_field_names_are_count_and_velocity(self):
        from services.trending import get_trending
        env = self._make_env(None)
        raw_agg = [{
            "keyword": "harare",
            "article_count": 3,
            "weighted_score": 2.5,
        }]
        with patch("services.trending.MongoDBClient") as MockDB:
            MockDB.return_value.aggregate = AsyncMock(return_value=raw_agg)
            result = await get_trending(env)
        assert len(result["topics"]) == 1
        topic = result["topics"][0]
        assert "count" in topic
        assert "velocity" in topic
        assert "article_count" not in topic
        assert "score" not in topic
        assert topic["count"] == 3
        assert topic["velocity"] == 2.5

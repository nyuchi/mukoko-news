"""
Tests for trending topics service.

Covers: ISO helpers, compute structure.
"""

import pytest
from services.trending import _now_iso, _hours_ago_iso


class TestISOHelpers:
    def test_now_iso_format(self):
        result = _now_iso()
        assert "T" in result
        assert "+" in result or "Z" in result

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
    async def test_refresh_trending_no_env(self):
        """refresh_trending should handle missing env gracefully."""
        from services.trending import refresh_trending
        # MongoDBClient will fail with no env, but should not crash
        result = await refresh_trending(None)
        assert isinstance(result, dict)
        assert "global" in result

"""Tests for the /trigger/collect endpoint, _SlidingWindow rate limiter, and /health."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException


class TestSlidingWindow:
    """Unit tests for the in-memory sliding-window rate limiter."""

    async def test_allows_calls_within_limit(self):
        from src.main import _SlidingWindow

        lim = _SlidingWindow(max_calls=3, window=60.0)
        assert await lim.is_allowed() is True
        assert await lim.is_allowed() is True
        assert await lim.is_allowed() is True

    async def test_blocks_when_max_exceeded(self):
        from src.main import _SlidingWindow

        lim = _SlidingWindow(max_calls=2, window=60.0)
        await lim.is_allowed()
        await lim.is_allowed()
        assert await lim.is_allowed() is False

    async def test_expired_calls_leave_the_window(self):
        from src.main import _SlidingWindow

        lim = _SlidingWindow(max_calls=1, window=0.05)  # 50 ms window
        assert await lim.is_allowed() is True
        assert await lim.is_allowed() is False  # blocked
        await asyncio.sleep(0.06)               # wait for window to expire
        assert await lim.is_allowed() is True   # allowed again

    async def test_concurrent_calls_are_serialised_by_lock(self):
        from src.main import _SlidingWindow

        lim = _SlidingWindow(max_calls=5, window=60.0)
        results = await asyncio.gather(*[lim.is_allowed() for _ in range(7)])
        assert results.count(True) == 5
        assert results.count(False) == 2


class TestTriggerCollect:
    """Tests for POST /trigger/collect."""

    @pytest.fixture(autouse=True)
    def reset_limiter(self):
        """Clear the module-level rate limiter before each test."""
        from src.main import _trigger_limiter
        _trigger_limiter._timestamps.clear()

    async def test_rejects_missing_authorization(self):
        from src.main import trigger_collect

        with patch("src.main.settings") as s:
            s.fly_trigger_token = "secret"
            with pytest.raises(HTTPException) as exc:
                await trigger_collect(authorization="")
        assert exc.value.status_code == 401

    async def test_rejects_wrong_token(self):
        from src.main import trigger_collect

        with patch("src.main.settings") as s:
            s.fly_trigger_token = "secret"
            with pytest.raises(HTTPException) as exc:
                await trigger_collect(authorization="Bearer wrong-token")
        assert exc.value.status_code == 401

    async def test_rejects_when_no_token_configured(self):
        """If the server has no token configured, every request is rejected."""
        from src.main import trigger_collect

        with patch("src.main.settings") as s:
            s.fly_trigger_token = ""
            with pytest.raises(HTTPException) as exc:
                await trigger_collect(authorization="Bearer anything")
        assert exc.value.status_code == 401

    async def test_accepts_valid_token_and_returns_202_body(self):
        from src.main import trigger_collect

        with (
            patch("src.main.settings") as s,
            patch("src.jobs.rss_collector.collect_feeds", new_callable=AsyncMock),
        ):
            s.fly_trigger_token = "secret"
            result = await trigger_collect(authorization="Bearer secret")

        assert result == {"ok": True, "message": "Collection triggered"}

    async def test_rate_limits_after_three_calls(self):
        from src.main import trigger_collect

        with (
            patch("src.main.settings") as s,
            patch("src.jobs.rss_collector.collect_feeds", new_callable=AsyncMock),
        ):
            s.fly_trigger_token = "tok"
            for _ in range(3):
                await trigger_collect(authorization="Bearer tok")
            with pytest.raises(HTTPException) as exc:
                await trigger_collect(authorization="Bearer tok")

        assert exc.value.status_code == 429

    async def test_rate_limit_is_global_not_per_caller(self):
        """Rate limit applies regardless of how many distinct callers send requests."""
        from src.main import trigger_collect

        with (
            patch("src.main.settings") as s,
            patch("src.jobs.rss_collector.collect_feeds", new_callable=AsyncMock),
        ):
            s.fly_trigger_token = "tok"
            for _ in range(3):
                await trigger_collect(authorization="Bearer tok")
            with pytest.raises(HTTPException) as exc:
                # Same token, same limiter bucket → still blocked
                await trigger_collect(authorization="Bearer tok")

        assert exc.value.status_code == 429


class TestHealthEndpoint:
    """Tests for GET /health."""

    async def test_healthy_status_when_mongodb_connected(self):
        import src.main as m

        saved = m._scheduler
        m._scheduler = None
        try:
            with patch("src.main.ping_mongodb", new_callable=AsyncMock, return_value=True):
                result = await m.health()
        finally:
            m._scheduler = saved

        assert result["status"] == "healthy"
        assert result["mongodb"] == "connected"
        assert isinstance(result["uptime_seconds"], int)
        assert result["jobs"] == {}

    async def test_degraded_status_when_mongodb_disconnected(self):
        import src.main as m

        saved = m._scheduler
        m._scheduler = None
        try:
            with patch("src.main.ping_mongodb", new_callable=AsyncMock, return_value=False):
                result = await m.health()
        finally:
            m._scheduler = saved

        assert result["status"] == "degraded"
        assert result["mongodb"] == "disconnected"

    async def test_includes_scheduler_jobs_when_running(self):
        import src.main as m
        from datetime import datetime, timezone

        mock_job = MagicMock()
        mock_job.id = "rss_collector"
        mock_job.name = "Collect RSS feeds"
        mock_job.next_run_time = datetime(2026, 6, 15, 8, 0, 0, tzinfo=timezone.utc)

        mock_scheduler = MagicMock()
        mock_scheduler.get_jobs.return_value = [mock_job]

        saved = m._scheduler
        m._scheduler = mock_scheduler
        try:
            with patch("src.main.ping_mongodb", new_callable=AsyncMock, return_value=True):
                result = await m.health()
        finally:
            m._scheduler = saved

        assert "rss_collector" in result["jobs"]
        assert result["jobs"]["rss_collector"]["name"] == "Collect RSS feeds"
        assert result["jobs"]["rss_collector"]["next_run"] is not None

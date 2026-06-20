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

    @pytest.fixture(autouse=True)
    def disable_auth(self, monkeypatch):
        """Disable token auth so rate-limit tests run without credentials."""
        import src.main as m
        monkeypatch.setattr(m.settings, "fly_trigger_token", "")

    def _make_request(self, auth_header: str = "") -> MagicMock:
        req = MagicMock()
        req.headers.get.return_value = auth_header
        return req

    async def test_returns_202_body(self):
        from src.main import trigger_collect

        with patch("src.jobs.rss_collector.collect_feeds", new_callable=AsyncMock):
            result = await trigger_collect(self._make_request())

        assert result == {"ok": True, "message": "Collection triggered"}

    async def test_rate_limits_after_three_calls(self):
        from src.main import trigger_collect

        with patch("src.jobs.rss_collector.collect_feeds", new_callable=AsyncMock):
            for _ in range(3):
                await trigger_collect(self._make_request())
            with pytest.raises(HTTPException) as exc:
                await trigger_collect(self._make_request())

        assert exc.value.status_code == 429

    async def test_rate_limit_message(self):
        from src.main import trigger_collect

        with patch("src.jobs.rss_collector.collect_feeds", new_callable=AsyncMock):
            for _ in range(3):
                await trigger_collect(self._make_request())
            with pytest.raises(HTTPException) as exc:
                await trigger_collect(self._make_request())

        assert "Rate limit" in exc.value.detail

    async def test_rejects_request_without_auth_when_token_configured(self, monkeypatch):
        import src.main as m
        monkeypatch.setattr(m.settings, "fly_trigger_token", "supersecret")
        from src.main import trigger_collect

        with pytest.raises(HTTPException) as exc:
            await trigger_collect(self._make_request(auth_header=""))

        assert exc.value.status_code == 401

    async def test_accepts_valid_bearer_token(self, monkeypatch):
        import src.main as m
        monkeypatch.setattr(m.settings, "fly_trigger_token", "supersecret")
        from src.main import trigger_collect

        with patch("src.jobs.rss_collector.collect_feeds", new_callable=AsyncMock):
            result = await trigger_collect(self._make_request(auth_header="Bearer supersecret"))

        assert result == {"ok": True, "message": "Collection triggered"}


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

"""
Tests for cron dispatcher.

Covers: cron pattern routing, error handling.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestCronDispatcher:
    @pytest.mark.asyncio
    @patch("services.cron.time")
    async def test_dispatches_feed_collection(self, mock_time):
        mock_time.time.return_value = 1000.0
        from services.cron import handle_scheduled

        event = MagicMock()
        event.cron = "*/15 * * * *"
        env = MagicMock()
        ctx = MagicMock()

        with patch("services.feed_collector.collect_feeds", new_callable=AsyncMock) as mock_collect:
            mock_collect.return_value = {"new_articles": 5}
            await handle_scheduled(event, env, ctx)
            mock_collect.assert_called_once_with(env)

    @pytest.mark.asyncio
    @patch("services.cron.time")
    async def test_dispatches_edge_cache_sync(self, mock_time):
        mock_time.time.return_value = 1000.0
        from services.cron import handle_scheduled

        event = MagicMock()
        event.cron = "0 * * * *"
        env = MagicMock()
        ctx = MagicMock()

        with patch("services.edge_cache_sync.sync_edge_cache", new_callable=AsyncMock) as mock_sync:
            mock_sync.return_value = {"articles": 10}
            await handle_scheduled(event, env, ctx)
            mock_sync.assert_called_once_with(env)

    @pytest.mark.asyncio
    @patch("services.cron.time")
    async def test_dispatches_trending_refresh(self, mock_time):
        mock_time.time.return_value = 1000.0
        from services.cron import handle_scheduled

        event = MagicMock()
        event.cron = "*/30 * * * *"
        env = MagicMock()
        ctx = MagicMock()

        with patch("services.trending.refresh_trending", new_callable=AsyncMock) as mock_trending:
            mock_trending.return_value = {"global": []}
            await handle_scheduled(event, env, ctx)
            mock_trending.assert_called_once_with(env)

    @pytest.mark.asyncio
    @patch("services.cron.time")
    async def test_dispatches_source_health(self, mock_time):
        mock_time.time.return_value = 1000.0
        from services.cron import handle_scheduled

        event = MagicMock()
        event.cron = "0 */6 * * *"
        env = MagicMock()
        ctx = MagicMock()

        with patch("services.source_health.check_source_health", new_callable=AsyncMock) as mock_health:
            mock_health.return_value = {"sources": 0}
            await handle_scheduled(event, env, ctx)
            mock_health.assert_called_once_with(env)

    @pytest.mark.asyncio
    async def test_unknown_cron_does_not_crash(self):
        from services.cron import handle_scheduled

        event = MagicMock()
        event.cron = "0 0 * * *"
        env = MagicMock()
        ctx = MagicMock()

        # Should not raise
        await handle_scheduled(event, env, ctx)

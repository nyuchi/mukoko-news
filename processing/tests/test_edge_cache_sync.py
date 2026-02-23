"""
Tests for edge cache sync service.

Covers: sync with no D1 binding, error handling.
"""

import pytest
from unittest.mock import MagicMock


class TestEdgeCacheSync:
    @pytest.mark.asyncio
    async def test_no_d1_binding(self):
        """Should return error when D1 binding missing."""
        from services.edge_cache_sync import sync_edge_cache

        env = MagicMock(spec=[])  # No EDGE_CACHE_DB attribute
        result = await sync_edge_cache(env)
        assert result.get("error") == "D1 binding not available"
        assert result.get("synced", 0) == 0

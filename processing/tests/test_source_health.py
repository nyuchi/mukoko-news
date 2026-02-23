"""
Tests for source health service.

Covers: health classification, adaptive scheduling, should_fetch logic,
and get_source_health_summary response shape.
"""

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch
from services.source_health import classify_health, should_fetch, FETCH_INTERVALS, get_source_health_summary


class TestClassifyHealth:
    def test_healthy(self):
        assert classify_health(0) == "healthy"

    def test_degraded(self):
        assert classify_health(1) == "degraded"
        assert classify_health(2) == "degraded"
        assert classify_health(3) == "degraded"

    def test_failing(self):
        assert classify_health(4) == "failing"
        assert classify_health(7) == "failing"

    def test_critical(self):
        assert classify_health(8) == "critical"
        assert classify_health(100) == "critical"


class TestShouldFetch:
    def test_never_fetched_returns_true(self):
        source = {"consecutive_failures": 0}
        assert should_fetch(source) is True

    def test_critical_returns_false(self):
        source = {"consecutive_failures": 10, "last_successful_fetch": "2026-01-01T00:00:00Z"}
        assert should_fetch(source) is False

    def test_healthy_within_interval(self):
        # Fetched 5 minutes ago — healthy interval is 15min, so don't fetch
        recent = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        source = {"consecutive_failures": 0, "last_successful_fetch": recent}
        assert should_fetch(source) is False

    def test_healthy_past_interval(self):
        # Fetched 20 minutes ago — healthy interval is 15min, so fetch
        old = (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat()
        source = {"consecutive_failures": 0, "last_successful_fetch": old}
        assert should_fetch(source) is True

    def test_degraded_within_interval(self):
        # Degraded interval is 30min — fetched 20 minutes ago
        recent = (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat()
        source = {"consecutive_failures": 2, "last_successful_fetch": recent}
        assert should_fetch(source) is False

    def test_degraded_past_interval(self):
        # Degraded interval is 30min — fetched 35 minutes ago
        old = (datetime.now(timezone.utc) - timedelta(minutes=35)).isoformat()
        source = {"consecutive_failures": 2, "last_successful_fetch": old}
        assert should_fetch(source) is True

    def test_failing_uses_60min_interval(self):
        # Failing interval is 60min — fetched 45 minutes ago
        recent = (datetime.now(timezone.utc) - timedelta(minutes=45)).isoformat()
        source = {"consecutive_failures": 5, "last_successful_fetch": recent}
        assert should_fetch(source) is False

    def test_no_last_fetch_date(self):
        source = {"consecutive_failures": 3, "last_successful_fetch": None}
        assert should_fetch(source) is True

    def test_uses_last_fetch_at_fallback(self):
        old = (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat()
        source = {"consecutive_failures": 0, "last_fetch_at": old}
        assert should_fetch(source) is True


class TestFetchIntervals:
    def test_healthy_interval(self):
        assert FETCH_INTERVALS["healthy"] == 15

    def test_degraded_interval(self):
        assert FETCH_INTERVALS["degraded"] == 30

    def test_failing_interval(self):
        assert FETCH_INTERVALS["failing"] == 60

    def test_critical_no_interval(self):
        assert FETCH_INTERVALS["critical"] is None


class TestGetSourceHealthSummary:
    @pytest.mark.asyncio
    async def test_returns_sources_and_summary_keys(self):
        mock_raw = [
            {"_id": "abc123", "name": "Herald", "consecutive_failures": 0, "source_quality_score": 0.9, "last_successful_fetch": None},
            {"_id": "def456", "name": "Daily News", "consecutive_failures": 5, "source_quality_score": 0.4, "last_successful_fetch": None},
        ]
        with patch("services.source_health.MongoDBClient") as MockDB:
            MockDB.return_value.find = AsyncMock(return_value=mock_raw)
            result = await get_source_health_summary(env=None)

        assert "sources" in result
        assert "summary" in result

    @pytest.mark.asyncio
    async def test_summary_counts_match_classified_status(self):
        mock_raw = [
            {"_id": "a", "name": "A", "consecutive_failures": 0, "source_quality_score": 0.8, "last_successful_fetch": None},
            {"_id": "b", "name": "B", "consecutive_failures": 2, "source_quality_score": 0.6, "last_successful_fetch": None},
            {"_id": "c", "name": "C", "consecutive_failures": 5, "source_quality_score": 0.5, "last_successful_fetch": None},
            {"_id": "d", "name": "D", "consecutive_failures": 10, "source_quality_score": 0.2, "last_successful_fetch": None},
        ]
        with patch("services.source_health.MongoDBClient") as MockDB:
            MockDB.return_value.find = AsyncMock(return_value=mock_raw)
            result = await get_source_health_summary(env=None)

        assert result["summary"]["healthy"] == 1
        assert result["summary"]["degraded"] == 1
        assert result["summary"]["failing"] == 1
        assert result["summary"]["critical"] == 1

    @pytest.mark.asyncio
    async def test_source_id_coerced_from_object_id(self):
        mock_raw = [
            {"_id": "507f1f77bcf86cd799439011", "name": "Herald", "consecutive_failures": 0, "source_quality_score": 0.9, "last_successful_fetch": None},
        ]
        with patch("services.source_health.MongoDBClient") as MockDB:
            MockDB.return_value.find = AsyncMock(return_value=mock_raw)
            result = await get_source_health_summary(env=None)

        assert result["sources"][0]["source_id"] == "507f1f77bcf86cd799439011"
        assert isinstance(result["sources"][0]["source_id"], str)

    @pytest.mark.asyncio
    async def test_status_uses_recomputed_classify_health(self):
        # consecutive_failures=5 → failing, regardless of any stored health_status field
        mock_raw = [
            {"_id": "x", "name": "X", "consecutive_failures": 5, "health_status": "healthy", "source_quality_score": 0.5, "last_successful_fetch": None},
        ]
        with patch("services.source_health.MongoDBClient") as MockDB:
            MockDB.return_value.find = AsyncMock(return_value=mock_raw)
            result = await get_source_health_summary(env=None)

        assert result["sources"][0]["status"] == "failing"

    @pytest.mark.asyncio
    async def test_sources_sorted_worst_first(self):
        mock_raw = [
            {"_id": "a", "name": "A", "consecutive_failures": 0, "source_quality_score": 0.9, "last_successful_fetch": None},
            {"_id": "b", "name": "B", "consecutive_failures": 10, "source_quality_score": 0.2, "last_successful_fetch": None},
            {"_id": "c", "name": "C", "consecutive_failures": 4, "source_quality_score": 0.5, "last_successful_fetch": None},
        ]
        with patch("services.source_health.MongoDBClient") as MockDB:
            MockDB.return_value.find = AsyncMock(return_value=mock_raw)
            result = await get_source_health_summary(env=None)

        statuses = [s["status"] for s in result["sources"]]
        assert statuses == ["healthy", "failing", "critical"]

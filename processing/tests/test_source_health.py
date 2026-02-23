"""
Tests for source health service.

Covers: health classification, adaptive scheduling, should_fetch logic.
"""

import pytest
from datetime import datetime, timezone, timedelta
from services.source_health import classify_health, should_fetch, FETCH_INTERVALS


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

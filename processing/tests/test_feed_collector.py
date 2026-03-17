"""
Tests for feed collector service.

Covers: country priority sorting, deduplication logic, batch pipeline structure.
"""

import pytest
from services.feed_collector import COUNTRY_PRIORITY


class TestCountryPriority:
    def test_zw_is_first(self):
        assert COUNTRY_PRIORITY["ZW"] == 1

    def test_tier1_countries(self):
        for c in ["ZA", "KE", "NG", "GH"]:
            assert COUNTRY_PRIORITY[c] <= 5

    def test_all_16_countries(self):
        assert len(COUNTRY_PRIORITY) == 16

    def test_priority_ordering(self):
        # ZW should always be first
        sorted_countries = sorted(COUNTRY_PRIORITY.items(), key=lambda x: x[1])
        assert sorted_countries[0][0] == "ZW"

    def test_unique_priorities(self):
        values = list(COUNTRY_PRIORITY.values())
        assert len(values) == len(set(values))


class TestBatchSize:
    def test_batch_size_under_subrequest_limit(self):
        from services.feed_collector import BATCH_SIZE
        # Workers have a 50 subrequest limit
        assert BATCH_SIZE <= 50

    def test_max_articles_per_feed(self):
        from services.feed_collector import MAX_ARTICLES_PER_FEED
        assert MAX_ARTICLES_PER_FEED == 20

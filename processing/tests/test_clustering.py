"""
Tests for article clustering service.

Covers: Jaccard similarity, title normalisation, multilingual stopwords,
cluster formation, different-source requirement, config overrides.
"""

import pytest
from services.clustering import (
    cluster_articles,
    _normalise_title,
    _jaccard_similarity,
    _jaccard_cluster,
    STOP_WORDS,
)


class TestNormaliseTitle:
    def test_basic_normalisation(self):
        words = _normalise_title("Zimbabwe Economy Grows by 5%")
        assert "zimbabwe" in words
        assert "economy" in words
        assert "grows" in words

    def test_filters_short_words(self):
        words = _normalise_title("The big red fox ran")
        # "the", "big", "red", "fox", "ran" — all ≤3 chars or stopwords
        assert "the" not in words

    def test_filters_english_stopwords(self):
        words = _normalise_title("This is about the latest news update")
        assert "this" not in words
        assert "latest" not in words
        assert "news" not in words

    def test_multilingual_stopwords(self):
        # Shona stopwords
        assert "kuti" in STOP_WORDS
        assert "ndi" in STOP_WORDS
        # Swahili stopwords
        assert "katika" in STOP_WORDS
        assert "lakini" in STOP_WORDS
        # French stopwords
        assert "dans" in STOP_WORDS
        assert "pour" in STOP_WORDS

    def test_empty_title(self):
        assert _normalise_title("") == []
        assert _normalise_title(None) == []

    def test_limits_title_length(self):
        long_title = "word " * 200
        words = _normalise_title(long_title)
        assert len(words) <= 50

    def test_removes_punctuation(self):
        words = _normalise_title("What's happening? Zimbabwe's future!")
        # Punctuation removed, words joined
        assert all(w.isalnum() for w in words)


class TestJaccardSimilarity:
    def test_identical_lists(self):
        assert _jaccard_similarity(["zimbabwe", "economy"], ["zimbabwe", "economy"]) == 1.0

    def test_completely_different(self):
        assert _jaccard_similarity(["zimbabwe"], ["south", "africa"]) == 0.0

    def test_partial_overlap(self):
        sim = _jaccard_similarity(["zimbabwe", "economy", "grows"], ["zimbabwe", "economy", "shrinks"])
        assert 0.0 < sim < 1.0

    def test_empty_lists(self):
        assert _jaccard_similarity([], ["word"]) == 0.0
        assert _jaccard_similarity(["word"], []) == 0.0
        assert _jaccard_similarity([], []) == 0.0


class TestClusterArticles:
    @pytest.mark.asyncio
    async def test_clusters_similar_titles(self):
        articles = [
            {"id": "1", "title": "Zimbabwe economy grows by 5%", "source": "Herald"},
            {"id": "2", "title": "Zimbabwe economy sees 5% growth", "source": "NewsDay"},
            {"id": "3", "title": "Harare weather forecast sunny", "source": "Herald"},
        ]
        result = await cluster_articles(articles)
        clusters = result["clusters"]
        # First two should cluster together, weather separate
        found_cluster = False
        for c in clusters:
            ids = [c["primary_article"]["id"]] + [r["id"] for r in c["related_articles"]]
            if "1" in ids and "2" in ids:
                found_cluster = True
        assert found_cluster

    @pytest.mark.asyncio
    async def test_different_source_required(self):
        articles = [
            {"id": "1", "title": "Zimbabwe economy grows", "source": "Herald"},
            {"id": "2", "title": "Zimbabwe economy grows", "source": "Herald"},  # Same source!
        ]
        result = await cluster_articles(articles)
        # Should NOT cluster same-source articles
        for c in result["clusters"]:
            assert c["article_count"] == 1

    @pytest.mark.asyncio
    async def test_empty_articles(self):
        result = await cluster_articles([])
        assert result["clusters"] == []

    @pytest.mark.asyncio
    async def test_respects_max_clusters(self):
        articles = [
            {"id": str(i), "title": f"Unique story number {i}", "source": f"Source{i}"}
            for i in range(20)
        ]
        result = await cluster_articles(articles, {"max_clusters": 5})
        assert len(result["clusters"]) <= 5

    @pytest.mark.asyncio
    async def test_fallback_to_jaccard(self):
        """Without env (no AI), should use Jaccard method."""
        articles = [
            {"id": "1", "title": "Test article one", "source": "A"},
            {"id": "2", "title": "Test article two", "source": "B"},
        ]
        result = await cluster_articles(articles, env=None)
        assert result["method"] == "jaccard"

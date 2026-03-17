"""
Tests for quality scorer service.

Covers: scoring ranges, word count impact, title scoring,
structure detection, edge cases, deterministic output.
"""

import pytest
from services.quality_scorer import score_quality


class TestScoreQuality:
    def test_short_content_gets_low_score(self):
        result = score_quality("Short.", "Title")
        assert result["quality_score"] == 0.3

    def test_long_article_scores_higher(self):
        content = "This is a well-written article about Zimbabwe. " * 50
        short_content = "Brief article. " * 5
        long_score = score_quality(content, "Zimbabwe economy grows by 5%")
        short_score = score_quality(short_content, "Brief news")
        assert long_score["quality_score"] > short_score["quality_score"]

    def test_good_title_length_scores_higher(self):
        content = "Article content here with enough words to score. " * 20
        good_title = "Zimbabwe President announces new economic policy"  # ~7 words
        bad_title = "Hi"  # Too short
        good = score_quality(content, good_title)
        bad = score_quality(content, bad_title)
        assert good["breakdown"]["title_score"] > bad["breakdown"]["title_score"]

    def test_score_in_valid_range(self):
        content = "Some article content. " * 30
        result = score_quality(content, "Valid title for testing")
        assert 0.0 <= result["quality_score"] <= 1.0

    def test_deterministic(self):
        """Same input always produces same output (unlike AI scoring)."""
        content = "Zimbabwe news article with quotes and detail. " * 20
        title = "Test determinism"
        score1 = score_quality(content, title)
        score2 = score_quality(content, title)
        assert score1["quality_score"] == score2["quality_score"]

    def test_returns_word_count(self):
        content = "one two three four five. " * 10
        result = score_quality(content, "Title")
        assert result["word_count"] == 50

    def test_content_with_quotes_scores_structure(self):
        content = '"This is a quoted statement," said the official. ' * 20
        result = score_quality(content, "Officials make statement")
        assert result["breakdown"]["structure_score"] >= 0.6

    def test_breakdown_keys_present(self):
        content = "Enough content for testing. " * 20
        result = score_quality(content, "Title")
        assert "length_score" in result["breakdown"]
        assert "readability_score" in result["breakdown"]
        assert "title_score" in result["breakdown"]
        assert "structure_score" in result["breakdown"]

    def test_empty_content(self):
        result = score_quality("", "Title")
        assert result["quality_score"] == 0.3

    def test_empty_title(self):
        content = "Some article content. " * 30
        result = score_quality(content, "")
        assert result["breakdown"]["title_score"] == 0.4

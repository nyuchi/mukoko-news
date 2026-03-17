"""Tests for quality scorer service."""

from src.services.quality_scorer import score_article, _score_content_length, _score_headline


class TestScoreArticle:
    def test_high_quality_article(self):
        article = {
            "headline": "Zimbabwe Economy Shows Strong Recovery Signs in Q1 2026",
            "articlebody": " ".join(["word"] * 500),
            "image": {"url": "https://example.com/img.jpg"},
            "author": {"@type": "Person", "name": "Jane Reporter"},
        }
        result = score_article(article)
        assert result["quality_score"] > 50
        assert "components" in result

    def test_low_quality_article(self):
        article = {
            "headline": "Hi",
            "articlebody": "Short.",
            "image": None,
            "author": None,
        }
        result = score_article(article)
        assert result["quality_score"] < 50

    def test_empty_article(self):
        result = score_article({})
        assert result["quality_score"] >= 0
        assert result["quality_score"] <= 100

    def test_score_bounded(self):
        article = {
            "headline": "A" * 200,
            "articlebody": " ".join(["word"] * 10000),
            "image": {"url": "img.jpg"},
            "author": {"@type": "Person", "name": "Author"},
        }
        result = score_article(article)
        assert 0 <= result["quality_score"] <= 100


class TestScoreContentLength:
    def test_very_short(self):
        assert _score_content_length("one two three") == 10.0

    def test_ideal_length(self):
        text = " ".join(["word"] * 500)
        assert _score_content_length(text) == 100.0

    def test_empty(self):
        assert _score_content_length("") == 0.0


class TestScoreHeadline:
    def test_ideal_headline(self):
        assert _score_headline("Zimbabwe Parliament Opens New Session Today") == 100.0

    def test_too_short(self):
        assert _score_headline("Hi") < 50

    def test_empty(self):
        assert _score_headline("") == 0.0

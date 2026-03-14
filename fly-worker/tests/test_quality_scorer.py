"""Tests for quality scorer service."""

from src.services.quality_scorer import score_article, _score_content_length, _score_headline


class TestScoreArticle:
    def test_high_quality_article(self):
        article = {
            "headline": "Zimbabwe Economy Shows Strong Recovery Signs in Q1 2026",
            "article_body": " ".join(["word"] * 500),
            "image": "https://example.com/img.jpg",
            "author_name": "Jane Reporter",
        }
        result = score_article(article)
        assert result["quality_score"] > 50
        assert "components" in result

    def test_low_quality_article(self):
        article = {
            "headline": "Hi",
            "article_body": "Short.",
            "image": None,
            "author_name": None,
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
            "article_body": " ".join(["word"] * 10000),
            "image": "img.jpg",
            "author_name": "Author",
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

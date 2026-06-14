"""Tests for RSS/Atom feed parser."""

from src.services.rss_parser import parse_feed, _slugify, _strip_html, _extract_img_from_html


class TestParseFeed:
    def test_parses_rss_articles(self, sample_rss_xml, sample_source):
        result = parse_feed(sample_rss_xml, sample_source)

        assert result["feed_title"] == "Test News"
        assert len(result["articles"]) == 2  # Third item has no title/link
        assert result["item_count"] == 3

    def test_first_article_fields(self, sample_rss_xml, sample_source):
        result = parse_feed(sample_rss_xml, sample_source)
        article = result["articles"][0]

        assert article["headline"] == "Zimbabwe Parliament Opens New Session"
        assert article["mainentityofpage"] == "https://test-news.example.com/article/1"
        assert article["source_feed_id"] == "https://test-news.example.com/article/1"
        assert article["publisher_organization_id"] == sample_source.get("organization_id")
        assert article["publisher"]["name"] == "Test News"
        assert article["primary_location_country"] == "ZW"
        assert article["inlanguage"] == "en"
        assert article["source_fingerprint"] is not None
        assert article["slug"] is not None

    def test_extracts_author(self, sample_rss_xml, sample_source):
        result = parse_feed(sample_rss_xml, sample_source)
        assert result["articles"][0]["author"]["name"] == "Jane Reporter"
        assert result["articles"][1]["author"]["name"] == "John Finance"

    def test_extracts_image_from_enclosure(self, sample_rss_xml, sample_source):
        result = parse_feed(sample_rss_xml, sample_source)
        assert result["articles"][0]["image"]["url"] == "https://test-news.example.com/images/parliament.jpg"

    def test_skips_entries_without_title(self, sample_rss_xml, sample_source):
        result = parse_feed(sample_rss_xml, sample_source)
        # Only 2 articles because third has empty title
        assert len(result["articles"]) == 2

    def test_parses_atom_feed(self, sample_atom_xml, sample_source):
        result = parse_feed(sample_atom_xml, sample_source)

        assert len(result["articles"]) == 1
        article = result["articles"][0]
        assert article["headline"] == "New Tech Hub Opens in Harare"
        assert article["author"]["name"] == "Tech Reporter"

    def test_empty_feed(self, sample_source):
        result = parse_feed("", sample_source)
        assert result["articles"] == []

    def test_malformed_xml(self, sample_source):
        result = parse_feed("<not>valid<xml", sample_source)
        assert result["articles"] == []

    def test_limits_to_20_articles(self, sample_source):
        items = "".join(
            f'<item><title>Article {i}</title><link>https://example.com/{i}</link></item>'
            for i in range(30)
        )
        xml = f'<rss version="2.0"><channel><title>Test</title>{items}</channel></rss>'
        result = parse_feed(xml, sample_source)
        assert len(result["articles"]) == 20

    def test_headline_truncated_at_500(self, sample_source):
        long_title = "A" * 600
        xml = f'<rss version="2.0"><channel><title>T</title><item><title>{long_title}</title><link>https://example.com/1</link></item></channel></rss>'
        result = parse_feed(xml, sample_source)
        assert len(result["articles"][0]["headline"]) == 500


class TestSlugify:
    def test_basic(self):
        assert _slugify("Hello World") == "hello-world"

    def test_special_chars(self):
        assert _slugify("What's Up? (2026)") == "whats-up-2026"

    def test_multiple_spaces(self):
        assert _slugify("too   many   spaces") == "too-many-spaces"

    def test_max_length(self):
        long = "a" * 300
        assert len(_slugify(long)) <= 200


class TestStripHtml:
    def test_removes_tags(self):
        assert _strip_html("<p>Hello <b>world</b></p>") == "Hello world"

    def test_empty_string(self):
        assert _strip_html("") == ""

    def test_preserves_text(self):
        assert _strip_html("plain text") == "plain text"


class TestExtractImgFromHtml:
    def test_finds_img(self):
        html = '<p>Text</p><img src="https://example.com/img.jpg" />'
        assert _extract_img_from_html(html) == "https://example.com/img.jpg"

    def test_no_img(self):
        assert _extract_img_from_html("<p>No image here</p>") is None

    def test_relative_img_ignored(self):
        html = '<img src="/relative/path.jpg" />'
        assert _extract_img_from_html(html) is None

"""Newsdata.io API client.

Thin async HTTP wrapper around the newsdata.io /latest and /sources endpoints.
"""

from typing import Any

import httpx

NEWSDATA_BASE_URL = "https://newsdata.io/api/1"

# newsdata.io country codes for the 16 African countries we cover
AFRICAN_COUNTRY_CODES = [
    "zw", "za", "ke", "ng", "gh", "et", "eg", "ma", "tz", "ug", "sn", "ci", "cm", "mz", "zm", "rw",
]

# newsdata.io response country names → ISO 3166-1 alpha-2
_COUNTRY_NAME_TO_ISO: dict[str, str] = {
    "zimbabwe": "ZW",
    "south africa": "ZA",
    "kenya": "KE",
    "nigeria": "NG",
    "ghana": "GH",
    "ethiopia": "ET",
    "egypt": "EG",
    "morocco": "MA",
    "tanzania": "TZ",
    "uganda": "UG",
    "senegal": "SN",
    "ivory coast": "CI",
    "cote d'ivoire": "CI",
    "cameroon": "CM",
    "mozambique": "MZ",
    "zambia": "ZM",
    "rwanda": "RW",
}

# newsdata.io language names → ISO 639-1
_LANGUAGE_NAME_TO_ISO: dict[str, str] = {
    "english": "en",
    "french": "fr",
    "portuguese": "pt",
    "arabic": "ar",
    "swahili": "sw",
    "amharic": "am",
    "hausa": "ha",
    "yoruba": "yo",
    "igbo": "ig",
}


def map_country(country_names: list[str]) -> str:
    """Convert a newsdata.io country name list to an ISO 3166-1 alpha-2 code."""
    for name in country_names:
        iso = _COUNTRY_NAME_TO_ISO.get(name.lower().strip())
        if iso:
            return iso
    return "ZW"


def map_language(lang: str) -> str:
    """Convert a newsdata.io language name to an ISO 639-1 code."""
    return _LANGUAGE_NAME_TO_ISO.get(lang.lower().strip(), lang[:2].lower() if lang else "en")


class NewsdataClient:
    """Async HTTP client for the newsdata.io news API."""

    def __init__(self, api_key: str, timeout: float = 30.0) -> None:
        self.api_key = api_key
        self.timeout = timeout

    async def get_latest_news(
        self,
        countries: list[str] | None = None,
        language: str = "en",
        page_token: str | None = None,
    ) -> dict[str, Any]:
        """Fetch latest news articles.

        Args:
            countries: newsdata.io country codes (e.g. ["zw", "ke"]).
                       Defaults to all African countries we cover.
            language: ISO 639-1 language code.
            page_token: Pagination cursor from a previous response's ``nextPage`` field.

        Returns:
            Raw API response with keys: status, totalResults, results, nextPage.
        """
        params: dict[str, str] = {
            "apikey": self.api_key,
            "language": language,
        }
        if countries:
            params["country"] = ",".join(countries)
        if page_token:
            params["page"] = page_token

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(f"{NEWSDATA_BASE_URL}/latest", params=params)
            resp.raise_for_status()
            return resp.json()  # type: ignore[no-any-return]

    async def get_sources(
        self,
        country: str | None = None,
        language: str = "en",
    ) -> dict[str, Any]:
        """Fetch available news sources.

        Args:
            country: newsdata.io country code to filter by.
            language: ISO 639-1 language code.

        Returns:
            Raw API response with keys: status, totalResults, results.
        """
        params: dict[str, str] = {
            "apikey": self.api_key,
            "language": language,
        }
        if country:
            params["country"] = country

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(f"{NEWSDATA_BASE_URL}/sources", params=params)
            resp.raise_for_status()
            return resp.json()  # type: ignore[no-any-return]

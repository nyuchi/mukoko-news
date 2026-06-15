"""Newsdata.io API client.

Thin async HTTP wrapper around the newsdata.io /latest and /sources endpoints.
"""

from typing import Any

import httpx

NEWSDATA_BASE_URL = "https://newsdata.io/api/1"

# newsdata.io country codes for all supported African countries
AFRICAN_COUNTRY_CODES = [
    # East Africa
    "zw", "ke", "tz", "ug", "rw", "et", "bi", "dj", "er", "so", "ss", "km", "mg", "mu", "sc",
    # Southern Africa
    "za", "bw", "zm", "mw", "na", "mz", "ls", "sz", "ao",
    # West Africa
    "ng", "gh", "sn", "ci", "cm", "bj", "bf", "cv", "gm", "gn", "gw", "lr", "ml", "mr", "ne", "sl", "tg", "gq",
    # Central Africa
    "cd", "cg", "cf", "td", "ga",
    # North Africa
    "eg", "ma", "tn", "dz", "ly", "sd",
]

# newsdata.io response country names → ISO 3166-1 alpha-2
_COUNTRY_NAME_TO_ISO: dict[str, str] = {
    # East Africa
    "zimbabwe": "ZW",
    "kenya": "KE",
    "tanzania": "TZ",
    "uganda": "UG",
    "rwanda": "RW",
    "ethiopia": "ET",
    "burundi": "BI",
    "djibouti": "DJ",
    "eritrea": "ER",
    "somalia": "SO",
    "south sudan": "SS",
    "comoros": "KM",
    "madagascar": "MG",
    "mauritius": "MU",
    "seychelles": "SC",
    # Southern Africa
    "south africa": "ZA",
    "botswana": "BW",
    "zambia": "ZM",
    "malawi": "MW",
    "namibia": "NA",
    "mozambique": "MZ",
    "lesotho": "LS",
    "eswatini": "SZ",
    "swaziland": "SZ",
    "angola": "AO",
    # West Africa
    "nigeria": "NG",
    "ghana": "GH",
    "senegal": "SN",
    "ivory coast": "CI",
    "cote d'ivoire": "CI",
    "côte d'ivoire": "CI",
    "cameroon": "CM",
    "benin": "BJ",
    "burkina faso": "BF",
    "cabo verde": "CV",
    "cape verde": "CV",
    "gambia": "GM",
    "the gambia": "GM",
    "guinea": "GN",
    "guinea-bissau": "GW",
    "liberia": "LR",
    "mali": "ML",
    "mauritania": "MR",
    "niger": "NE",
    "sierra leone": "SL",
    "togo": "TG",
    "equatorial guinea": "GQ",
    "sao tome and principe": "ST",
    "são tomé and príncipe": "ST",
    # Central Africa
    "democratic republic of the congo": "CD",
    "dr congo": "CD",
    "congo, democratic republic": "CD",
    "republic of the congo": "CG",
    "congo": "CG",
    "central african republic": "CF",
    "chad": "TD",
    "gabon": "GA",
    # North Africa
    "egypt": "EG",
    "morocco": "MA",
    "tunisia": "TN",
    "algeria": "DZ",
    "libya": "LY",
    "sudan": "SD",
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

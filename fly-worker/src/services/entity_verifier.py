"""Verify news organizations against OpenStreetMap via Overpass API."""

import re
from dataclasses import dataclass, field

import httpx

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_BACKUP_URL = "https://overpass.kumi.systems/api/interpreter"


@dataclass
class OsmVerificationResult:
    found: bool
    osm_id: str | None  # e.g. "node/12345678" or "way/12345678"
    osm_type: str | None  # "node", "way", "relation"
    confidence: str  # "high", "medium", "low"
    osm_tags: dict = field(default_factory=dict)  # raw OSM tags (name, website, etc.)


def _extract_domain(url: str) -> str:
    """Extract bare domain from URL."""
    return re.sub(r"^https?://(www\.)?", "", url).split("/")[0].lower()


async def _run_overpass_query(query: str) -> dict | None:
    """Execute an Overpass QL query, trying primary then backup URL."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        for url in (OVERPASS_URL, OVERPASS_BACKUP_URL):
            try:
                resp = await client.post(url, data={"data": query})
                if resp.status_code == 200:
                    return resp.json()
            except Exception:
                continue
    return None


def _pick_best_element(elements: list[dict]) -> dict | None:
    """Return the most relevant element from Overpass results."""
    if not elements:
        return None
    # Prefer nodes over ways; take the first match
    for elem in elements:
        if elem.get("type") == "node":
            return elem
    return elements[0]


async def verify_news_org(
    name: str,
    website_url: str | None,
    country_code: str,  # ISO 3166-1 alpha-2, e.g. "ZW"
) -> OsmVerificationResult:
    """Query Overpass API to find if this news org exists on OSM.

    Strategy:
    1. If website_url given: search nodes/ways with website tag containing the domain
    2. Fallback: search by name + office=newspaper/news in country
    Returns OsmVerificationResult.
    """
    _not_found = OsmVerificationResult(
        found=False, osm_id=None, osm_type=None, confidence="low", osm_tags={}
    )

    try:
        # Primary: search by website domain
        if website_url:
            domain = _extract_domain(website_url)
            if domain:
                website_query = f"""[out:json][timeout:25];
(
  node["website"~"{domain}"];
  way["website"~"{domain}"];
  node["contact:website"~"{domain}"];
  way["contact:website"~"{domain}"];
);
out body;"""
                data = await _run_overpass_query(website_query)
                if data:
                    elements = data.get("elements", [])
                    elem = _pick_best_element(elements)
                    if elem:
                        tags = elem.get("tags", {})
                        osm_type = elem.get("type", "node")
                        osm_id = f"{osm_type}/{elem.get('id', '')}"

                        # High confidence if the website tag contains our domain
                        website_tag = tags.get("website", "") or tags.get("contact:website", "")
                        confidence = "high" if domain in website_tag.lower() else "medium"

                        return OsmVerificationResult(
                            found=True,
                            osm_id=osm_id,
                            osm_type=osm_type,
                            confidence=confidence,
                            osm_tags=tags,
                        )

        # Fallback: search by name + office tag in country
        escaped_name = re.escape(name)
        country_upper = country_code.upper()
        name_query = f"""[out:json][timeout:25];
area["ISO3166-1"="{country_upper}"]->.searchArea;
(
  node["name"~"{escaped_name}",i]["office"~"newspaper|news"](area.searchArea);
  way["name"~"{escaped_name}",i]["office"~"newspaper|news"](area.searchArea);
  node["name"~"{escaped_name}",i]["amenity"~"studio|broadcast"](area.searchArea);
);
out body;"""
        data = await _run_overpass_query(name_query)
        if data:
            elements = data.get("elements", [])
            elem = _pick_best_element(elements)
            if elem:
                tags = elem.get("tags", {})
                osm_type = elem.get("type", "node")
                osm_id = f"{osm_type}/{elem.get('id', '')}"
                return OsmVerificationResult(
                    found=True,
                    osm_id=osm_id,
                    osm_type=osm_type,
                    confidence="medium",
                    osm_tags=tags,
                )

        return _not_found

    except Exception as e:
        print(f"[ENTITY_VERIFIER] OSM lookup failed for '{name}': {e}")
        return _not_found

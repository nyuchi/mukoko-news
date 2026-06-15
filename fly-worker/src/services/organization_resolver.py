"""Find or create newsMediaOrganization + entity.entities for a news source."""

import asyncio
import re
import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from src.services.entity_verifier import OsmVerificationResult, verify_news_org


def _extract_domain(url: str) -> str:
    """Extract bare domain from URL."""
    return re.sub(r"^https?://(www\.)?", "", url).split("/")[0].lower()


def _make_slug(name: str) -> str:
    """Generate URL-safe slug from name."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower().strip()).strip("-")
    return slug[:80]


async def _schedule_osm_verification(
    news_db: AsyncIOMotorDatabase,
    entity_db: AsyncIOMotorDatabase,
    org_id: str,
    entity_id: str,
    name: str,
    url: str | None,
    country_code: str,
) -> None:
    """Fire-and-forget OSM verification. Updates entity + org on success."""
    try:
        result: OsmVerificationResult = await verify_news_org(name, url, country_code)
        if result.found:
            tier = 2 if result.confidence == "high" else 1
            entity_update = {
                "bundu.verificationTier": tier,
                "bundu.trustSignals.osmId": result.osm_id,
                "bundu.trustSignals.osmType": result.osm_type,
                "bundu.trustSignals.osmConfidence": result.confidence,
                "verificationMethod": "overpass_osm",
                "updatedAt": datetime.now(timezone.utc),
            }
            await entity_db["entities"].update_one(
                {"_id": entity_id}, {"$set": entity_update}
            )
            await news_db["newsMediaOrganizations"].update_one(
                {"_id": org_id},
                {"$set": {"bundu.verificationTier": tier, "updatedAt": datetime.now(timezone.utc)}},
            )
    except Exception as e:
        print(f"[ORG_RESOLVER] OSM verification failed for {org_id}: {e}")


async def resolve_or_create_org(
    news_db: AsyncIOMotorDatabase,
    entity_db: AsyncIOMotorDatabase,
    name: str,
    url: str | None,
    country_code: str,
    source_id_hint: str,  # used to derive IDs if needed
) -> tuple[str, str]:
    """Return (mediaOrganizationId, entityId) for the given news source.

    Looks up existing org by domain. If not found, creates entity + org records
    and fires off async OSM verification (non-blocking).
    """
    # 1. Search by domain in existing orgs
    if url:
        domain = _extract_domain(url)
        if domain:
            existing_org = await news_db["newsMediaOrganizations"].find_one(
                {"url": {"$regex": re.escape(domain), "$options": "i"}},
                {"_id": 1, "entityId": 1},
            )
            if existing_org:
                org_id: str = str(existing_org["_id"])
                existing_entity_id = existing_org.get("entityId")

                if existing_entity_id:
                    # 2a. Org found with entityId — return both
                    return (org_id, str(existing_entity_id))

                # 2b. Org found but no entityId — create entity and link it
                entity_id = await _create_entity(entity_db, name, url, now=datetime.now(timezone.utc))
                await news_db["newsMediaOrganizations"].update_one(
                    {"_id": existing_org["_id"]},
                    {"$set": {"entityId": entity_id, "updatedAt": datetime.now(timezone.utc)}},
                )
                asyncio.create_task(
                    _schedule_osm_verification(news_db, entity_db, org_id, entity_id, name, url, country_code)
                )
                return (org_id, entity_id)

    # 3. Not found — create entity first, then org
    now = datetime.now(timezone.utc)
    entity_id = await _create_entity(entity_db, name, url, now=now)
    org_id = await _create_org(news_db, name, url, entity_id, now=now)

    asyncio.create_task(
        _schedule_osm_verification(news_db, entity_db, org_id, entity_id, name, url, country_code)
    )
    return (org_id, entity_id)


async def _create_entity(
    entity_db: AsyncIOMotorDatabase,
    name: str,
    url: str | None,
    now: datetime,
) -> str:
    """Insert a new entity doc and return its ID."""
    entity_id = str(uuid.uuid4())
    entity_slug = _make_slug(name) + "-" + entity_id[:8]
    entity_doc = {
        "_id": entity_id,
        "_schemaVersion": "v3.2",
        "entityType": "organization",
        "ecosystemRole": "external",
        "schemaOrgType": "NewsMediaOrganization",
        "slug": entity_slug,
        "name": name,
        "url": url,
        "isActive": True,
        "isPrivateByDefault": False,
        "bundu": {
            "verificationTier": 0,
            "trustSignals": {
                "communityVouches": 0,
                "reviewCount": 0,
                "scamReportCount": 0,
                "scamReportResolved": 0,
                "verificationTier": 0,
            },
        },
        "createdAt": now,
        "updatedAt": now,
    }
    await entity_db["entities"].insert_one(entity_doc)
    return entity_id


async def _create_org(
    news_db: AsyncIOMotorDatabase,
    name: str,
    url: str | None,
    entity_id: str,
    now: datetime,
) -> str:
    """Insert a new newsMediaOrganization doc and return its ID."""
    org_id = f"org-{_make_slug(name)}-{entity_id[:8]}"
    org_slug = _make_slug(name) + "-" + entity_id[:8]
    org_doc = {
        "_id": org_id,
        "_schemaVersion": "v3.1",
        "slug": org_slug,
        "name": name,
        "url": url,
        "entityId": entity_id,
        "isVerified": False,
        "publisherTier": "unverified",
        "followerCount": 0,
        "totalArticlesPublished": 0,
        "apiEnabled": False,
        "sourceType": "online_only",
        "bundu": {"trustSignals": {}, "ubuntuScore": None, "verificationTier": 0},
        "createdAt": now,
        "updatedAt": now,
    }
    await news_db["newsMediaOrganizations"].insert_one(org_doc)
    return org_id

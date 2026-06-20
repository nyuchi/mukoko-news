"""Bootstrap organization + entity records for existing feedSources.

Runs once at startup (or on-demand). For each feedSource whose
mediaOrganizationId has no matching newsMediaOrganizations doc, it creates
the org and entity records.
"""

import asyncio
from datetime import datetime, timezone
from urllib.parse import urlparse

from src.services.mongodb import get_entity_db, get_news_db
from src.services.organization_resolver import resolve_or_create_org


async def bootstrap_organizations() -> dict:
    """Create missing org+entity docs for all feedSources."""
    news_db = get_news_db()
    entity_db = get_entity_db()
    stats: dict[str, int] = {"checked": 0, "created": 0, "already_exist": 0, "errors": 0}

    sources = await news_db["feedSources"].find(
        {}, {"_id": 1, "name": 1, "feedUrl": 1, "mediaOrganizationId": 1, "countryCode": 1}
    ).to_list(None)

    for source in sources:
        stats["checked"] += 1
        org_id = source.get("mediaOrganizationId", "")
        existing_org = await news_db["newsMediaOrganizations"].find_one(
            {"_id": org_id}, {"_id": 1}
        )
        if existing_org:
            stats["already_exist"] += 1
            continue

        try:
            # Derive website URL from feed URL (strip feed path)
            feed_url = source.get("feedUrl") or ""
            if feed_url:
                parsed = urlparse(feed_url)
                website_url: str | None = f"{parsed.scheme}://{parsed.netloc}"
            else:
                website_url = None

            new_org_id, entity_id = await resolve_or_create_org(
                news_db,
                entity_db,
                name=source["name"],
                url=website_url,
                country_code=source.get("countryCode", "ZW"),
                source_id_hint=source["_id"],
            )

            # Update feedSource to use the actual new org_id (if it changed)
            if new_org_id != org_id:
                await news_db["feedSources"].update_one(
                    {"_id": source["_id"]},
                    {"$set": {"mediaOrganizationId": new_org_id, "updatedAt": datetime.now(timezone.utc)}},
                )

            stats["created"] += 1
            print(f"[BOOTSTRAP] Created org {new_org_id} for source {source['_id']}")
        except Exception as e:
            print(f"[BOOTSTRAP] Failed for {source['_id']}: {e}")
            stats["errors"] += 1

    print(f"[BOOTSTRAP] Done: {stats}")
    return stats

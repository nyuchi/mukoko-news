"""Async MongoDB client for the Fly.io pipeline.

Uses motor (async pymongo) with connection pooling.
The cluster hosts multiple databases — one per domain. Use the named
accessors (get_news_db, get_entity_db, etc.) rather than the generic get_db().

Usage:
    db = get_news_db()
    articles = await db["articles"].find({"status": "published"}).to_list(20)

    platform_db = get_platform_db()
    await platform_db["serviceHealth"].update_one(...)
"""

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from src.config import settings

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        if not settings.mongodb_uri:
            raise RuntimeError("MONGODB_URI is not configured")
        _client = AsyncIOMotorClient(
            settings.mongodb_uri,
            serverSelectionTimeoutMS=5000,
            maxPoolSize=10,
        )
    return _client


def get_news_db() -> AsyncIOMotorDatabase:
    return get_client()[settings.mongodb_news_db]


def get_engagement_db() -> AsyncIOMotorDatabase:
    return get_client()[settings.mongodb_engagement_db]


def get_entity_db() -> AsyncIOMotorDatabase:
    return get_client()[settings.mongodb_entity_db]


def get_platform_db() -> AsyncIOMotorDatabase:
    return get_client()[settings.mongodb_platform_db]


def get_db() -> AsyncIOMotorDatabase:
    """Alias for get_news_db(). Prefer the named accessor in new code."""
    return get_news_db()


async def ping_mongodb() -> bool:
    try:
        await get_client().admin.command("ping")
        return True
    except Exception as e:
        print(f"[MONGODB] Ping failed: {e}")
        return False


async def close_mongodb() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None

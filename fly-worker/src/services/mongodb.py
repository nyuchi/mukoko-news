"""Async MongoDB client for the Fly.io FastAPI backend.

Uses motor (async pymongo wrapper) with connection pooling.
Database: mukoko_news (same schema as the Cloudflare processing worker).

Usage:
    db = get_db()
    articles = await db["articles"].find({"status": "published"}).to_list(20)
    await db["articles"].insert_one({...})
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


def get_db() -> AsyncIOMotorDatabase:
    return get_client()[settings.mongodb_database]


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

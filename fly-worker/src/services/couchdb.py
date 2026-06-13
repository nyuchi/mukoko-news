"""CouchDB async client for article document storage.

Article bodies go to CouchDB. Metadata stays in Supabase Postgres.
Uses httpx (already a dependency) — no extra packages needed.
"""

import httpx

from src.config import settings


class CouchDBClient:
    """Lightweight async CouchDB client over HTTP/JSON."""

    def __init__(self) -> None:
        self._base_url = settings.couchdb_url.rstrip("/")
        self._db = settings.couchdb_database
        self._auth = (
            (settings.couchdb_username, settings.couchdb_password)
            if settings.couchdb_username
            else None
        )
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                auth=self._auth,
                timeout=10.0,
                headers={"Content-Type": "application/json"},
            )
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def ping(self) -> bool:
        """Check if CouchDB is reachable."""
        try:
            client = await self._get_client()
            resp = await client.get("/")
            return resp.status_code == 200
        except Exception:
            return False

    async def ensure_db(self) -> None:
        """Create the database if it doesn't exist."""
        client = await self._get_client()
        resp = await client.put(f"/{self._db}")
        if resp.status_code not in (201, 412):  # 412 = already exists
            print(f"[COUCHDB] ensure_db: {resp.status_code} {resp.text[:200]}")

    async def create_indexes(self) -> None:
        """Create useful indexes for querying."""
        client = await self._get_client()
        for field in ["type", "article_id", "source_id"]:
            await client.post(
                f"/{self._db}/_index",
                json={
                    "index": {"fields": [field]},
                    "name": f"idx_{field}",
                    "type": "json",
                },
            )

    async def get_doc(self, doc_id: str) -> dict | None:
        """Get a document by ID. Returns None if not found."""
        try:
            client = await self._get_client()
            resp = await client.get(f"/{self._db}/{doc_id}")
            if resp.status_code == 200:
                return resp.json()
            return None
        except Exception as e:
            print(f"[COUCHDB] get_doc error: {e}")
            return None

    async def put_doc(self, doc_id: str, doc: dict) -> str | None:
        """Create or update a document. Returns the revision ID."""
        try:
            client = await self._get_client()
            resp = await client.put(f"/{self._db}/{doc_id}", json=doc)
            if resp.status_code in (201, 202):
                return resp.json().get("rev")
            print(f"[COUCHDB] put_doc error: {resp.status_code} {resp.text[:200]}")
            return None
        except Exception as e:
            print(f"[COUCHDB] put_doc error: {e}")
            return None

    async def bulk_docs(self, docs: list[dict]) -> list[dict]:
        """Insert/update multiple documents at once."""
        try:
            client = await self._get_client()
            resp = await client.post(
                f"/{self._db}/_bulk_docs",
                json={"docs": docs},
            )
            if resp.status_code in (201, 202):
                return resp.json()
            print(f"[COUCHDB] bulk_docs error: {resp.status_code}")
            return []
        except Exception as e:
            print(f"[COUCHDB] bulk_docs error: {e}")
            return []

    async def find(self, selector: dict, limit: int = 25) -> list[dict]:
        """Query documents using Mango selector."""
        try:
            client = await self._get_client()
            resp = await client.post(
                f"/{self._db}/_find",
                json={"selector": selector, "limit": limit},
            )
            if resp.status_code == 200:
                return resp.json().get("docs", [])
            return []
        except Exception as e:
            print(f"[COUCHDB] find error: {e}")
            return []


# Singleton instance
_couchdb: CouchDBClient | None = None


def get_couchdb() -> CouchDBClient:
    """Get the singleton CouchDB client."""
    global _couchdb
    if _couchdb is None:
        _couchdb = CouchDBClient()
    return _couchdb


async def init_couchdb() -> None:
    """Initialize CouchDB: ensure database and indexes exist."""
    if not settings.couchdb_url:
        print("[COUCHDB] No COUCHDB_URL configured, skipping init")
        return

    client = get_couchdb()
    if await client.ping():
        await client.ensure_db()
        await client.create_indexes()
        print("[COUCHDB] Initialized successfully")
    else:
        print("[COUCHDB] Not reachable, will operate in Postgres-only mode")


async def close_couchdb() -> None:
    """Close the CouchDB client."""
    global _couchdb
    if _couchdb:
        await _couchdb.close()
        _couchdb = None

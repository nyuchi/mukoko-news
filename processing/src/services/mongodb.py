"""
MongoDB client via Service Binding to mongo-proxy Worker.

Primary data store for Mukoko News. D1 is used only as an edge cache.

Python Workers (Pyodide) cannot use the MongoDB driver directly (no TCP sockets
in WebAssembly). Instead, all MongoDB operations are routed through a thin JS
Worker (mukoko-mongo-proxy) via Cloudflare Service Binding (~1ms internal RPC).

Env bindings required:
  - MONGO              : Service Binding to mukoko-mongo-proxy Worker
  - MONGODB_CLUSTER    : Cluster name (e.g. "mukoko-app") — informational
  - MONGODB_DATABASE   : Database name (e.g. "mukoko_news") — informational

Usage:
    db = MongoDBClient(env)
    articles = await db.find("articles", {"category": "news"}, limit=20)
    article = await db.find_one("articles", {"_id": article_id})
    result = await db.insert_one("articles", {"title": "...", ...})
    await db.update_one("articles", {"_id": id}, {"$set": {"score": 0.8}})
"""

import json


class MongoDBClient:
    """MongoDB client via Service Binding to mongo-proxy Worker."""

    def __init__(self, env):
        self.env = env
        self.binding = getattr(env, "MONGO", None)

    # ------------------------------------------------------------------
    # Read operations
    # ------------------------------------------------------------------

    async def find(
        self,
        collection: str,
        filter: dict | None = None,
        projection: dict | None = None,
        sort: dict | None = None,
        limit: int = 20,
        skip: int = 0,
    ) -> list[dict]:
        """Find multiple documents."""
        body = {
            "action": "find",
            "collection": collection,
            "filter": filter or {},
            "limit": limit,
            "skip": skip,
        }
        if projection:
            body["projection"] = projection
        if sort:
            body["sort"] = sort

        result = await self._request(body)
        return result.get("documents", [])

    async def find_one(self, collection: str, filter: dict, projection: dict | None = None) -> dict | None:
        """Find a single document."""
        body = {
            "action": "findOne",
            "collection": collection,
            "filter": filter,
        }
        if projection:
            body["projection"] = projection

        result = await self._request(body)
        return result.get("document")

    async def count(self, collection: str, filter: dict | None = None) -> int:
        """Count documents matching a filter."""
        result = await self._request({
            "action": "count",
            "collection": collection,
            "filter": filter or {},
        })
        return result.get("total", 0)

    async def aggregate(self, collection: str, pipeline: list[dict]) -> list[dict]:
        """Run an aggregation pipeline."""
        result = await self._request({
            "action": "aggregate",
            "collection": collection,
            "pipeline": pipeline,
        })
        return result.get("documents", [])

    # ------------------------------------------------------------------
    # Write operations
    # ------------------------------------------------------------------

    async def insert_one(self, collection: str, document: dict) -> dict:
        """Insert a single document. Returns {"insertedId": ...}."""
        return await self._request({
            "action": "insertOne",
            "collection": collection,
            "document": document,
        })

    async def insert_many(self, collection: str, documents: list[dict]) -> dict:
        """Insert multiple documents. Returns {"insertedIds": [...]}."""
        return await self._request({
            "action": "insertMany",
            "collection": collection,
            "documents": documents,
        })

    async def update_one(self, collection: str, filter: dict, update: dict, upsert: bool = False) -> dict:
        """Update a single document. Returns {"matchedCount": int, "modifiedCount": int}."""
        return await self._request({
            "action": "updateOne",
            "collection": collection,
            "filter": filter,
            "update": update,
            "upsert": upsert,
        })

    async def update_many(self, collection: str, filter: dict, update: dict) -> dict:
        """Update multiple documents."""
        return await self._request({
            "action": "updateMany",
            "collection": collection,
            "filter": filter,
            "update": update,
        })

    async def delete_one(self, collection: str, filter: dict) -> dict:
        """Delete a single document. Returns {"deletedCount": int}."""
        return await self._request({
            "action": "deleteOne",
            "collection": collection,
            "filter": filter,
        })

    async def delete_many(self, collection: str, filter: dict) -> dict:
        """Delete multiple documents."""
        return await self._request({
            "action": "deleteMany",
            "collection": collection,
            "filter": filter,
        })

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _request(self, body: dict) -> dict:
        """
        Send a request to the mongo-proxy Worker via Service Binding.

        In production: uses env.MONGO.fetch() (Service Binding RPC, ~1ms)
        In tests: binding is None, returns empty dict (services mock their own data)
        """
        if not self.binding:
            print(f"[MONGODB] No MONGO binding available for {body.get('action', '?')}")
            return {}

        try:
            from js import Request, Headers  # type: ignore[import-not-found]
            from pyodide.ffi import to_js  # type: ignore[import-not-found]

            js_headers = Headers.new()
            js_headers.set("Content-Type", "application/json")
            # Auth: send PROXY_SECRET to mongo-proxy (mandatory)
            proxy_secret = getattr(self.env, "PROXY_SECRET", None) if self.env else None
            if proxy_secret:
                js_headers.set("Authorization", f"Bearer {proxy_secret}")

            request = Request.new(
                "https://mongo-proxy.internal/",
                to_js({
                    "method": "POST",
                    "headers": js_headers,
                    "body": json.dumps(body, default=str),
                }, dict_converter=lambda x: x),  # type: ignore[arg-type]
            )

            response = await self.binding.fetch(request)

            if not response.ok:
                text = await response.text()
                action = body.get("action", "?")
                print(f"[MONGODB] {action} failed ({response.status}): {text[:200]}")
                return {}

            text = await response.text()
            return json.loads(text) if text else {}

        except ImportError:
            # Not running in Workers — fallback for local testing
            print(f"[MONGODB] JS FFI not available for {body.get('action', '?')}")
            return {}
        except Exception as e:
            print(f"[MONGODB] Request failed: {e}")
            return {}

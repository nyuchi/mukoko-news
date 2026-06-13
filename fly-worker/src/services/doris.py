"""Apache Doris async client for analytics workloads.

Uses HTTP API (Stream Load for writes, MySQL-compatible query for reads).
Doris handles engagement counters, search indexing, and analytics aggregation.
"""

import json
from datetime import datetime, timezone

import httpx

from src.config import settings


class DorisClient:
    """Lightweight async Doris client over HTTP."""

    def __init__(self) -> None:
        self._http_url = settings.doris_http_url.rstrip("/")
        self._db = settings.doris_database
        self._auth = (settings.doris_username, settings.doris_password)
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                auth=self._auth,
                timeout=15.0,
            )
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def ping(self) -> bool:
        """Check if Doris FE is reachable."""
        try:
            client = await self._get_client()
            resp = await client.get(f"{self._http_url}/api/bootstrap")
            return resp.status_code == 200
        except Exception:
            return False

    async def query(self, sql: str) -> list[dict]:
        """Execute a SQL query and return rows as dicts."""
        try:
            client = await self._get_client()
            resp = await client.post(
                f"{self._http_url}/api/query/{self._db}",
                json={"stmt": sql},
                headers={"Content-Type": "application/json"},
            )
            if resp.status_code != 200:
                print(f"[DORIS] Query error: {resp.status_code} {resp.text[:200]}")
                return []

            data = resp.json()
            if data.get("status") != "OK" and data.get("msg"):
                print(f"[DORIS] Query error: {data['msg']}")
                return []

            # Parse Doris HTTP API response format
            columns = data.get("data", {}).get("meta", [])
            rows_data = data.get("data", {}).get("data", [])
            col_names = [c.get("name", f"col_{i}") for i, c in enumerate(columns)]

            return [dict(zip(col_names, row)) for row in rows_data]

        except Exception as e:
            print(f"[DORIS] Query error: {e}")
            return []

    async def stream_load(self, table: str, rows: list[dict]) -> bool:
        """Load data into Doris via Stream Load (HTTP PUT with JSON)."""
        if not rows:
            return True

        try:
            client = await self._get_client()
            # Stream Load expects JSON array
            payload = json.dumps(rows)
            resp = await client.put(
                f"{self._http_url}/api/{self._db}/{table}/_stream_load",
                content=payload,
                headers={
                    "Content-Type": "application/json",
                    "format": "json",
                    "strip_outer_array": "true",
                },
            )

            if resp.status_code == 200:
                result = resp.json()
                status = result.get("Status", "")
                if status in ("Success", "Publish Timeout"):
                    return True
                print(f"[DORIS] Stream Load {table}: {status} - {result.get('Message', '')[:200]}")
            else:
                print(f"[DORIS] Stream Load {table}: HTTP {resp.status_code}")

            return False
        except Exception as e:
            print(f"[DORIS] Stream Load {table} error: {e}")
            return False

    async def initialize_tables(self) -> None:
        """Create analytics tables if they don't exist."""
        tables_sql = [
            # Article engagement metrics — aggregate model (sums by key)
            f"""CREATE TABLE IF NOT EXISTS {self._db}.article_metrics (
                article_id VARCHAR(36),
                event_date DATE,
                event_hour TINYINT,
                country VARCHAR(4),
                views BIGINT SUM DEFAULT "0",
                likes BIGINT SUM DEFAULT "0",
                bookmarks BIGINT SUM DEFAULT "0",
                shares BIGINT SUM DEFAULT "0"
            )
            AGGREGATE KEY(article_id, event_date, event_hour, country)
            DISTRIBUTED BY HASH(article_id) BUCKETS 8
            PROPERTIES ("replication_num" = "1")""",

            # Article search index — duplicate model with inverted indexes
            f"""CREATE TABLE IF NOT EXISTS {self._db}.article_search (
                article_id VARCHAR(36),
                headline VARCHAR(500),
                description TEXT,
                keywords TEXT,
                category VARCHAR(100),
                country VARCHAR(4),
                source_id VARCHAR(36),
                datepublished DATETIME,
                engagement_score DOUBLE DEFAULT "0",
                INDEX idx_headline (headline) USING INVERTED PROPERTIES("parser" = "unicode"),
                INDEX idx_description (description) USING INVERTED PROPERTIES("parser" = "unicode"),
                INDEX idx_keywords (keywords) USING INVERTED PROPERTIES("parser" = "unicode")
            )
            DUPLICATE KEY(article_id)
            DISTRIBUTED BY HASH(article_id) BUCKETS 8
            PROPERTIES ("replication_num" = "1")""",

            # Source health history
            f"""CREATE TABLE IF NOT EXISTS {self._db}.source_health_history (
                source_id VARCHAR(36),
                check_date DATE,
                health_status VARCHAR(20),
                consecutive_failures INT,
                articles_fetched INT,
                quality_score DOUBLE
            )
            DUPLICATE KEY(source_id, check_date)
            DISTRIBUTED BY HASH(source_id) BUCKETS 4
            PROPERTIES ("replication_num" = "1")""",

            # Search analytics — what people search for
            f"""CREATE TABLE IF NOT EXISTS {self._db}.search_analytics (
                query_text VARCHAR(500),
                search_date DATE,
                search_hour TINYINT,
                result_count INT,
                country VARCHAR(4),
                category VARCHAR(100)
            )
            DUPLICATE KEY(query_text, search_date, search_hour)
            DISTRIBUTED BY HASH(query_text) BUCKETS 4
            PROPERTIES ("replication_num" = "1")""",

            # Category trending — aggregated topic scores
            f"""CREATE TABLE IF NOT EXISTS {self._db}.category_trending (
                term_id VARCHAR(100),
                term_name VARCHAR(200),
                category VARCHAR(100),
                country VARCHAR(4),
                trend_date DATE,
                article_count BIGINT SUM DEFAULT "0",
                engagement_sum DOUBLE SUM DEFAULT "0"
            )
            AGGREGATE KEY(term_id, term_name, category, country, trend_date)
            DISTRIBUTED BY HASH(term_id) BUCKETS 4
            PROPERTIES ("replication_num" = "1")""",

            # Publisher analytics — open data
            f"""CREATE TABLE IF NOT EXISTS {self._db}.publisher_analytics (
                source_id VARCHAR(36),
                source_name VARCHAR(200),
                stat_date DATE,
                articles_published BIGINT SUM DEFAULT "0",
                total_views BIGINT SUM DEFAULT "0",
                total_likes BIGINT SUM DEFAULT "0",
                total_shares BIGINT SUM DEFAULT "0",
                avg_quality DOUBLE REPLACE DEFAULT "0"
            )
            AGGREGATE KEY(source_id, source_name, stat_date)
            DISTRIBUTED BY HASH(source_id) BUCKETS 4
            PROPERTIES ("replication_num" = "1")""",

            # Open data access log — who queries the open analytics
            f"""CREATE TABLE IF NOT EXISTS {self._db}.open_data_access_log (
                endpoint VARCHAR(200),
                access_date DATE,
                access_hour TINYINT,
                request_count BIGINT SUM DEFAULT "0",
                country VARCHAR(4)
            )
            AGGREGATE KEY(endpoint, access_date, access_hour, country)
            DISTRIBUTED BY HASH(endpoint) BUCKETS 4
            PROPERTIES ("replication_num" = "1")""",

            # User analytics — anonymized aggregate (PII stays in Postgres)
            f"""CREATE TABLE IF NOT EXISTS {self._db}.user_analytics (
                user_hash VARCHAR(64),
                event_type VARCHAR(50),
                event_date DATE,
                event_hour TINYINT,
                country VARCHAR(4),
                event_count BIGINT SUM DEFAULT "0"
            )
            AGGREGATE KEY(user_hash, event_type, event_date, event_hour, country)
            DISTRIBUTED BY HASH(user_hash) BUCKETS 4
            PROPERTIES ("replication_num" = "1")""",
        ]

        client = await self._get_client()
        for sql in tables_sql:
            try:
                resp = await client.post(
                    f"{self._http_url}/api/query/{self._db}",
                    json={"stmt": sql},
                    headers={"Content-Type": "application/json"},
                )
                if resp.status_code != 200:
                    print(f"[DORIS] Table creation issue: {resp.text[:200]}")
            except Exception as e:
                print(f"[DORIS] Table creation error: {e}")


# Singleton
_doris: DorisClient | None = None


def get_doris() -> DorisClient:
    """Get the singleton Doris client."""
    global _doris
    if _doris is None:
        _doris = DorisClient()
    return _doris


async def init_doris() -> None:
    """Initialize Doris: create tables if they don't exist."""
    if not settings.doris_http_url:
        print("[DORIS] No DORIS_HTTP_URL configured, skipping init")
        return

    client = get_doris()
    if await client.ping():
        await client.initialize_tables()
        print("[DORIS] Initialized successfully")
    else:
        print("[DORIS] Not reachable, will operate in Postgres-only mode")


async def close_doris() -> None:
    """Close the Doris client."""
    global _doris
    if _doris:
        await _doris.close()
        _doris = None

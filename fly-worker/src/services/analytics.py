"""Analytics event buffer for Doris.

Buffers engagement events in memory and periodically flushes to Doris
via Stream Load. If Doris is unavailable, events are silently discarded
(analytics is non-critical — Postgres counters remain the source of truth).
"""

import time
from collections import defaultdict
from datetime import datetime, timezone

from src.services.doris import get_doris


class AnalyticsBuffer:
    """In-memory event buffer that flushes to Doris."""

    MAX_EVENTS = 10_000

    def __init__(self) -> None:
        self._events: dict[str, list[dict]] = defaultdict(list)
        self._total = 0

    def track_view(self, article_id: str, country: str = "") -> None:
        self._add("article_metrics", {
            "article_id": article_id,
            "event_date": _today(),
            "event_hour": _hour(),
            "country": country or "XX",
            "views": 1, "likes": 0, "bookmarks": 0, "shares": 0,
        })

    def track_like(self, article_id: str, country: str = "") -> None:
        self._add("article_metrics", {
            "article_id": article_id,
            "event_date": _today(),
            "event_hour": _hour(),
            "country": country or "XX",
            "views": 0, "likes": 1, "bookmarks": 0, "shares": 0,
        })

    def track_save(self, article_id: str, country: str = "") -> None:
        self._add("article_metrics", {
            "article_id": article_id,
            "event_date": _today(),
            "event_hour": _hour(),
            "country": country or "XX",
            "views": 0, "likes": 0, "bookmarks": 1, "shares": 0,
        })

    def track_share(self, article_id: str, country: str = "") -> None:
        self._add("article_metrics", {
            "article_id": article_id,
            "event_date": _today(),
            "event_hour": _hour(),
            "country": country or "XX",
            "views": 0, "likes": 0, "bookmarks": 0, "shares": 1,
        })

    def track_search(self, query: str, result_count: int, country: str = "", category: str = "") -> None:
        self._add("search_analytics", {
            "query_text": query[:500],
            "search_date": _today(),
            "search_hour": _hour(),
            "result_count": result_count,
            "country": country or "XX",
            "category": category or "",
        })

    def track_open_data_access(self, endpoint: str, country: str = "") -> None:
        self._add("open_data_access_log", {
            "endpoint": endpoint[:200],
            "access_date": _today(),
            "access_hour": _hour(),
            "request_count": 1,
            "country": country or "XX",
        })

    def _add(self, table: str, event: dict) -> None:
        if self._total >= self.MAX_EVENTS:
            return  # Silently drop if buffer full
        self._events[table].append(event)
        self._total += 1

    async def flush(self) -> None:
        """Flush all buffered events to Doris."""
        if self._total == 0:
            return

        doris = get_doris()
        flushed = 0

        for table, events in self._events.items():
            if events:
                ok = await doris.stream_load(table, events)
                if ok:
                    flushed += len(events)
                else:
                    print(f"[ANALYTICS] Failed to flush {len(events)} events to {table}")

        if flushed:
            print(f"[ANALYTICS] Flushed {flushed}/{self._total} events to Doris")

        self._events.clear()
        self._total = 0


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _hour() -> int:
    return datetime.now(timezone.utc).hour


# Singleton
_buffer: AnalyticsBuffer | None = None


def get_analytics() -> AnalyticsBuffer:
    """Get the singleton analytics buffer."""
    global _buffer
    if _buffer is None:
        _buffer = AnalyticsBuffer()
    return _buffer


async def flush_analytics() -> None:
    """Flush the analytics buffer — called by scheduler."""
    buf = get_analytics()
    try:
        await buf.flush()
    except Exception as e:
        print(f"[ANALYTICS] Flush error: {e}")

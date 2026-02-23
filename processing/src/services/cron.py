"""
Cron dispatcher — routes scheduled triggers to the right pipeline.

Cron triggers defined in wrangler.jsonc:
  */15 * * * *  → RSS feed collection (batch)
  0 * * * *     → Edge cache sync (MongoDB → D1)
  */30 * * * *  → Trending topics refresh
  0 */6 * * *   → Source health check
"""

import time


async def handle_scheduled(event, env, ctx):
    """Route a scheduled event to the appropriate pipeline."""
    cron = getattr(event, "cron", None) or ""
    start = time.time()
    print(f"[CRON] Triggered: {cron}")

    try:
        if cron == "*/15 * * * *":
            from services.feed_collector import collect_feeds
            result = await collect_feeds(env)
            _log("feed_collector", start, result)

        elif cron == "0 * * * *":
            from services.edge_cache_sync import sync_edge_cache
            result = await sync_edge_cache(env)
            _log("edge_cache_sync", start, result)

        elif cron == "*/30 * * * *":
            from services.trending import refresh_trending
            result = await refresh_trending(env)
            _log("trending", start, result)

        elif cron == "0 */6 * * *":
            from services.source_health import check_source_health
            result = await check_source_health(env)
            _log("source_health", start, result)

        else:
            print(f"[CRON] Unknown cron pattern: {cron}")

    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        print(f"[CRON] {cron} failed after {elapsed}ms: {e}")


def _log(name: str, start: float, result: dict | None):
    elapsed = int((time.time() - start) * 1000)
    status = "ok" if result and not result.get("error") else "error"
    print(f"[CRON] {name} completed in {elapsed}ms — {status}")

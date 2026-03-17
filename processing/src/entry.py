"""
Mukoko News API — Python Data Processing & API Worker

Production: https://news-api.mukoko.com
Dev:        https://mukoko-news-api.<account>.workers.dev

FastAPI entrypoint called by the main TypeScript Worker via Service Binding.
All heavy data processing lives here: RSS parsing, content cleaning,
AI orchestration, clustering, search, and feed ranking.

Bindings available via self.env / env:
  - EDGE_CACHE_DB    : D1 database (edge cache for low-bandwidth African markets)
  - AI               : Workers AI (embeddings) + AI Gateway (Anthropic Claude)
  - VECTORIZE_INDEX  : Vectorize semantic search
  - CACHE_STORAGE    : KV cache
  - STORAGE          : R2 file storage
  - MONGO            : Service Binding to mongo-proxy Worker (MongoDB access)

  MongoDB (primary data store, via mongo-proxy Service Binding):
  - MONGODB_CLUSTER  : Cluster name (e.g. "mukoko-app")
  - MONGODB_DATABASE : Database name (e.g. "mukoko_news")
"""

from workers import WorkerEntrypoint, Response, handler

# ---------------------------------------------------------------------------
# Global env reference — set per-request by the WorkerEntrypoint
# Services access this to reach Cloudflare bindings (D1, AI, KV, etc.)
# ---------------------------------------------------------------------------
_env = None


def get_env():
    """Return the current request's Cloudflare env bindings."""
    return _env


# ---------------------------------------------------------------------------
# Fetch handler — receives Service Binding calls from the Hono Worker
# Class MUST be named "Default" for Python Workers.
# ---------------------------------------------------------------------------

class Default(WorkerEntrypoint):
    async def fetch(self, request):
        global _env
        _env = self.env

        from services.router import handle_request
        return await handle_request(request, self.env)


# ---------------------------------------------------------------------------
# Scheduled handler — cron triggers (defined in wrangler.jsonc)
# Uses @handler decorator on module-level function.
# ---------------------------------------------------------------------------

@handler
async def on_scheduled(event, env, ctx):
    """Handle cron triggers."""
    global _env
    _env = env
    from services.cron import handle_scheduled
    await handle_scheduled(event, env, ctx)

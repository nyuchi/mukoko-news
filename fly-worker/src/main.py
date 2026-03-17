"""Mukoko News Fly.io Backend — FastAPI application entry point.

Serves the full API for news.mukoko.com frontend.
Also runs background jobs: RSS collection, AI processing, engagement scoring.
"""

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.db import get_pool, close_pool, run_migrations
from src.scheduler import create_scheduler
from src.services.couchdb import init_couchdb, close_couchdb
from src.services.doris import init_doris, close_doris
from src.services.analytics import flush_analytics

_start_time = time.time()
_scheduler = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: run migrations, start scheduler. Shutdown: stop scheduler, close DB."""
    global _scheduler

    # Database
    print("[MAIN] Connecting to Postgres...")
    await get_pool()
    print("[MAIN] Running migrations...")
    await run_migrations()

    # CouchDB (article body storage)
    print("[MAIN] Initializing CouchDB...")
    await init_couchdb()

    # Doris (analytics)
    print("[MAIN] Initializing Doris...")
    await init_doris()

    # Scheduler (background jobs)
    print("[MAIN] Starting scheduler...")
    _scheduler = create_scheduler()
    _scheduler.start()
    print("[MAIN] Backend ready.")

    yield

    # Shutdown
    print("[MAIN] Shutting down...")
    if _scheduler:
        _scheduler.shutdown(wait=False)
    await flush_analytics()
    await close_doris()
    await close_couchdb()
    await close_pool()
    print("[MAIN] Shutdown complete.")


app = FastAPI(
    title="Mukoko News API",
    description="Pan-African news aggregation API — mukoko.com",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS
origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Cookie"],
    expose_headers=["Set-Cookie"],
)

# ── Register API routers ────────────────────────────────────
from src.api.feeds import router as feeds_router
from src.api.articles import router as articles_router
from src.api.categories import router as categories_router
from src.api.sources import router as sources_router
from src.api.search import router as search_router
from src.api.stats import router as stats_router
from src.api.engagement import router as engagement_router
from src.api.stories import router as stories_router
from src.api.authors import router as authors_router
from src.api.admin import router as admin_router
from src.api.analytics import router as analytics_router
from src.api.user import router as user_router

app.include_router(feeds_router)
app.include_router(articles_router)
app.include_router(categories_router)
app.include_router(sources_router)
app.include_router(search_router)
app.include_router(stats_router)
app.include_router(engagement_router)
app.include_router(stories_router)
app.include_router(authors_router)
app.include_router(admin_router)
app.include_router(analytics_router)  # Public — no auth required
app.include_router(user_router)


# ── Root health endpoint (for Fly.io health checks) ─────────
@app.get("/health")
async def health():
    """Health check for Fly.io."""
    pool = await get_pool()
    db_ok = False
    try:
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
            db_ok = True
    except Exception:
        pass

    # CouchDB status
    from src.services.couchdb import get_couchdb
    couch_ok = False
    try:
        couch_ok = await get_couchdb().ping()
    except Exception:
        pass

    # Doris status
    from src.services.doris import get_doris as _get_doris
    doris_ok = False
    try:
        doris_ok = await _get_doris().ping()
    except Exception:
        pass

    jobs = {}
    if _scheduler:
        for job in _scheduler.get_jobs():
            next_run = job.next_run_time
            jobs[job.id] = {
                "name": job.name,
                "next_run": next_run.isoformat() if next_run else None,
            }

    # Degraded if DB is down; CouchDB/Doris being down is acceptable
    return {
        "status": "healthy" if db_ok else "degraded",
        "uptime_seconds": int(time.time() - _start_time),
        "database": "connected" if db_ok else "disconnected",
        "couchdb": "connected" if couch_ok else "disconnected",
        "doris": "connected" if doris_ok else "disconnected",
        "jobs": jobs,
    }

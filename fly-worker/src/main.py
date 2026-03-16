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

    jobs = {}
    if _scheduler:
        for job in _scheduler.get_jobs():
            next_run = job.next_run_time
            jobs[job.id] = {
                "name": job.name,
                "next_run": next_run.isoformat() if next_run else None,
            }

    return {
        "status": "healthy" if db_ok else "degraded",
        "uptime_seconds": int(time.time() - _start_time),
        "database": "connected" if db_ok else "disconnected",
        "jobs": jobs,
    }

"""Mukoko News Fly.io Worker — FastAPI application entry point.

Runs RSS collection, AI processing, and database sync on schedule.
Provides health endpoint for Fly.io health checks.
"""

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI

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

    # Scheduler
    print("[MAIN] Starting scheduler...")
    _scheduler = create_scheduler()
    _scheduler.start()
    print("[MAIN] Worker ready.")

    yield

    # Shutdown
    print("[MAIN] Shutting down...")
    if _scheduler:
        _scheduler.shutdown(wait=False)
    await close_pool()
    print("[MAIN] Shutdown complete.")


app = FastAPI(
    title="Mukoko News Worker",
    description="RSS collection, AI processing, and database sync",
    lifespan=lifespan,
)


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

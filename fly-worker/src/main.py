"""Mukoko News pipeline — FastAPI entry point.

This process is a data pipeline, NOT a user-facing API.
It ingests RSS feeds, enriches articles with AI, and writes to MongoDB.
The Next.js frontend reads directly from MongoDB.

Background jobs run via APScheduler on startup.
FastAPI is used only to expose /health for Fly.io health checks.
"""

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.scheduler import create_scheduler
from src.services.mongodb import ping_mongodb, close_mongodb

_start_time = time.time()
_scheduler = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _scheduler

    print("[PIPELINE] Connecting to MongoDB...")
    mongo_ok = await ping_mongodb()
    if mongo_ok:
        print("[PIPELINE] MongoDB connected.")
    else:
        print("[PIPELINE] WARNING: MongoDB unavailable — pipeline degraded.")

    # Bootstrap missing org+entity records for existing feedSources (idempotent).
    # Runs in the background so it does not delay startup.
    if mongo_ok:
        import asyncio
        from src.jobs.organization_bootstrapper import bootstrap_organizations
        asyncio.create_task(bootstrap_organizations())
        print("[PIPELINE] Organization bootstrap scheduled.")

    print("[PIPELINE] Starting scheduler...")
    _scheduler = create_scheduler()
    _scheduler.start()
    print("[PIPELINE] Pipeline ready.")

    yield

    print("[PIPELINE] Shutting down...")
    if _scheduler:
        _scheduler.shutdown(wait=False)
    await close_mongodb()
    print("[PIPELINE] Shutdown complete.")


app = FastAPI(
    title="Mukoko News Pipeline",
    description="RSS ingest + AI enrichment pipeline — writes to MongoDB",
    version="3.0.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
)

# Restrict to internal/admin origins only — this is not a public API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Health check for Fly.io."""
    mongo_ok = await ping_mongodb()

    jobs = {}
    if _scheduler:
        for job in _scheduler.get_jobs():
            next_run = job.next_run_time
            jobs[job.id] = {
                "name": job.name,
                "next_run": next_run.isoformat() if next_run else None,
            }

    return {
        "status": "healthy" if mongo_ok else "degraded",
        "uptime_seconds": int(time.time() - _start_time),
        "mongodb": "connected" if mongo_ok else "disconnected",
        "jobs": jobs,
    }

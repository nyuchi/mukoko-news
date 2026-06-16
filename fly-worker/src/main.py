"""Mukoko News pipeline — FastAPI entry point.

This process is a data pipeline, NOT a user-facing API.
It ingests RSS feeds, enriches articles with AI, and writes to MongoDB.
The Next.js frontend reads directly from MongoDB.

Background jobs run via APScheduler on startup.
FastAPI is used only to expose /health for Fly.io health checks.
"""

import asyncio
import hmac
import time
from collections import deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.scheduler import create_scheduler
from src.services.mongodb import ping_mongodb, close_mongodb

_start_time = time.time()
_scheduler = None


class _SlidingWindow:
    """Global in-memory sliding window rate limiter (single-instance safe)."""

    def __init__(self, max_calls: int, window: float) -> None:
        self._max = max_calls
        self._window = window
        self._timestamps: deque[float] = deque()
        self._lock = asyncio.Lock()

    async def is_allowed(self) -> bool:
        async with self._lock:
            now = time.monotonic()
            cutoff = now - self._window
            while self._timestamps and self._timestamps[0] < cutoff:
                self._timestamps.popleft()
            if len(self._timestamps) >= self._max:
                return False
            self._timestamps.append(now)
            return True


_trigger_limiter = _SlidingWindow(max_calls=3, window=60.0)


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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.post("/trigger/collect", status_code=202)
async def trigger_collect(request: Request):
    """On-demand RSS collection — called by Next.js pull-to-refresh.

    Requires Bearer token when FLY_TRIGGER_TOKEN is set.
    Global rate limit: 3 triggers per minute regardless of caller count.
    """
    expected = settings.fly_trigger_token
    if expected:
        auth = request.headers.get("Authorization", "")
        if not hmac.compare_digest(auth, f"Bearer {expected}"):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    if not await _trigger_limiter.is_allowed():
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded — 3 triggers/min")

    from src.jobs.rss_collector import collect_feeds
    asyncio.create_task(collect_feeds())
    return {"ok": True, "message": "Collection triggered"}


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

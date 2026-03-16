"""Shared dependencies for API routes."""

import asyncpg

from src.db import get_pool


async def get_conn() -> asyncpg.Connection:
    """Acquire a connection from the pool. Used as a FastAPI dependency."""
    pool = await get_pool()
    return pool

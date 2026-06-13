"""Async Postgres connection pool using asyncpg.

Fly.io managed Postgres provides DATABASE_URL automatically.
Uses asyncpg directly for performance — no ORM overhead.
"""

import asyncpg
from pathlib import Path

from src.config import settings

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    """Get or create the connection pool."""
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            settings.database_url,
            min_size=2,
            max_size=10,
            command_timeout=30,
            server_settings={
                "search_path": "public,news,engagement,identity,system,sync",
            },
        )
    return _pool


async def close_pool() -> None:
    """Close the connection pool."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def run_migrations() -> None:
    """Run SQL migration files from migrations/ directory."""
    pool = await get_pool()
    migrations_dir = Path(__file__).parent.parent / "migrations"

    async with pool.acquire() as conn:
        # Create migrations tracking table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS _migrations (
                filename TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)

        # Get already-applied migrations
        applied = {
            row["filename"]
            for row in await conn.fetch("SELECT filename FROM _migrations")
        }

        # Apply new migrations in order
        for sql_file in sorted(migrations_dir.glob("*.sql")):
            if sql_file.name not in applied:
                print(f"[DB] Applying migration: {sql_file.name}")
                sql = sql_file.read_text()
                await conn.execute(sql)
                await conn.execute(
                    "INSERT INTO _migrations (filename) VALUES ($1)", sql_file.name
                )
                print(f"[DB] Applied: {sql_file.name}")

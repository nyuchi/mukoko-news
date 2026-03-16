"""Database sync job — no longer needed.

D1 sync has been removed since the backend now runs directly on Postgres.
This file is kept as a no-op to avoid import errors from scheduler.
"""


async def sync_to_d1() -> None:
    """No-op: D1 sync is no longer needed."""
    pass

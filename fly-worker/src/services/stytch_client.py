"""Stytch client wrapper for email OTP authentication.

Email OTP is the primary auth method. SMS OTP secondary.
"""

import stytch

from src.config import settings

_client: stytch.Client | None = None


def get_stytch_client() -> stytch.Client:
    """Get the Stytch client singleton."""
    global _client
    if _client is None:
        if not settings.stytch_project_id or not settings.stytch_secret:
            raise RuntimeError("Stytch credentials not configured")
        _client = stytch.Client(
            project_id=settings.stytch_project_id,
            secret=settings.stytch_secret,
        )
    return _client


def is_stytch_configured() -> bool:
    """Check if Stytch credentials are available."""
    return bool(settings.stytch_project_id and settings.stytch_secret)

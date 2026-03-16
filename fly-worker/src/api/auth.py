"""API authentication middleware.

Two auth methods:
1. API_SECRET — bearer token for frontend-to-backend auth
2. OIDC JWT — user tokens from id.mukoko.com (validated elsewhere)
"""

from fastapi import Header, HTTPException

from src.config import settings


async def require_api_key(authorization: str = Header(default="")) -> str | None:
    """Validate bearer token. Returns token if valid, raises 401 otherwise."""
    api_secret = settings.api_secret
    if not api_secret:
        # No secret configured — allow through (dev mode)
        return None

    token = _extract_bearer(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Valid API key or user token required.")

    # Valid if matches API_SECRET or looks like a JWT
    is_api_secret = token == api_secret
    is_jwt = token.count(".") == 2

    if not is_api_secret and not is_jwt:
        raise HTTPException(status_code=401, detail="Valid API key or user token required.")

    return token


async def optional_api_key(authorization: str = Header(default="")) -> str | None:
    """Extract token if present, but don't require it."""
    api_secret = settings.api_secret
    if not api_secret:
        return None

    token = _extract_bearer(authorization)
    if not token:
        return None

    is_api_secret = token == api_secret
    is_jwt = token.count(".") == 2

    if is_api_secret or is_jwt:
        return token
    return None


def _extract_bearer(auth_header: str) -> str | None:
    """Extract bearer token from Authorization header."""
    if not auth_header:
        return None
    parts = auth_header.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1]

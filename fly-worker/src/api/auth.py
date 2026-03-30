"""API authentication — JWT-based auth with Stytch and PLATFORM_JWT support.

Replaces the old API_SECRET static token auth.
Validates JWTs from:
1. Mukoko News (issued after Stytch OTP verification)
2. Mukoko Platform (service-to-service via shared PLATFORM_JWT_SECRET)
"""

from dataclasses import dataclass

from fastapi import Header, HTTPException

from src.config import settings
from src.services.jwt import verify_jwt


@dataclass
class AuthUser:
    """Authenticated user context."""
    user_id: str
    email: str | None = None
    role: str = "authenticated"
    person_id: str | None = None


async def require_auth(authorization: str = Header(default="")) -> AuthUser:
    """Require a valid JWT or API_SECRET. Returns AuthUser or raises 401."""
    # Dev mode — no secrets configured at all
    if not settings.platform_jwt_secret and not settings.api_secret:
        if settings.environment == "production":
            print("[AUTH] WARNING: No auth secrets configured in production — rejecting request")
            raise HTTPException(status_code=500, detail="Auth not configured")
        return AuthUser(user_id="dev", role="admin")

    token = _extract_bearer(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    # Check static API_SECRET first (server-side, MCP clients)
    if settings.api_secret and token == settings.api_secret:
        return AuthUser(user_id="api_client", role="service_role")

    # Then try JWT
    if settings.platform_jwt_secret:
        payload = verify_jwt(token)
        if payload is not None:
            return AuthUser(
                user_id=payload.get("sub", ""),
                email=payload.get("email"),
                role=payload.get("role", "authenticated"),
                person_id=payload.get("person_id"),
            )

    raise HTTPException(status_code=401, detail="Invalid or expired token")


async def require_admin(authorization: str = Header(default="")) -> AuthUser:
    """Require admin role."""
    user = await require_auth(authorization)
    if user.role not in ("admin", "service_role"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def require_service(authorization: str = Header(default="")) -> AuthUser:
    """Require service-to-service JWT (from mukoko-platform)."""
    user = await require_auth(authorization)
    if user.role != "service_role":
        raise HTTPException(status_code=403, detail="Service role required")
    return user


async def optional_auth(authorization: str = Header(default="")) -> AuthUser | None:
    """Extract auth if present, but don't require it."""
    token = _extract_bearer(authorization)
    if not token:
        return None

    # Check static API_SECRET
    if settings.api_secret and token == settings.api_secret:
        return AuthUser(user_id="api_client", role="service_role")

    # Try JWT
    if settings.platform_jwt_secret:
        payload = verify_jwt(token)
        if payload is not None:
            return AuthUser(
                user_id=payload.get("sub", ""),
                email=payload.get("email"),
                role=payload.get("role", "authenticated"),
                person_id=payload.get("person_id"),
            )

    return None


def _extract_bearer(auth_header: str) -> str | None:
    """Extract bearer token from Authorization header."""
    if not auth_header:
        return None
    parts = auth_header.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1]

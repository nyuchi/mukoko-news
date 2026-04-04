"""API authentication — Stytch session tokens + Platform JWT.

User auth: Stytch session tokens (validated via Stytch API)
Service auth: PLATFORM_JWT (HS256, shared secret with mukoko-platform)
Public reads: optional_auth (no token needed)
"""

from dataclasses import dataclass

from fastapi import Header, HTTPException

from src.config import settings
from src.services.jwt import verify_jwt
from src.services.stytch_client import get_stytch_client, is_stytch_configured


@dataclass
class AuthUser:
    """Authenticated user context."""
    user_id: str
    email: str | None = None
    role: str = "authenticated"
    person_id: str | None = None


async def require_auth(authorization: str = Header(default="")) -> AuthUser:
    """Require a valid Stytch session or Platform JWT. Returns AuthUser or raises 401."""
    if not settings.platform_jwt_secret and not is_stytch_configured():
        if settings.environment == "production":
            print("[AUTH] WARNING: No auth configured in production — rejecting request")
            raise HTTPException(status_code=500, detail="Auth not configured")
        return AuthUser(user_id="dev", role="admin")

    token = _extract_bearer(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    user = await _try_authenticate(token)
    if user is not None:
        return user

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
    """Extract auth if present, but don't require it. Used for public reads."""
    token = _extract_bearer(authorization)
    if not token:
        return None

    return await _try_authenticate(token)


async def _try_authenticate(token: str) -> AuthUser | None:
    """Try to authenticate a token as Platform JWT or Stytch session."""
    import asyncio

    # Try Platform JWT first (service-to-service, fast local check)
    if settings.platform_jwt_secret:
        payload = verify_jwt(token)
        if payload is not None:
            return AuthUser(
                user_id=payload.get("sub", ""),
                email=payload.get("email"),
                role=payload.get("role", "authenticated"),
                person_id=payload.get("person_id"),
            )

    # Try Stytch session token (user auth, remote validation)
    # Stytch SDK is synchronous — run in thread to avoid blocking event loop
    if is_stytch_configured():
        try:
            client = get_stytch_client()
            resp = await asyncio.to_thread(
                client.sessions.authenticate, session_token=token
            )
            user = resp.user
            return AuthUser(
                user_id=user.user_id,
                email=user.emails[0].email if user.emails else None,
                role="authenticated",
            )
        except Exception as e:
            print(f"[AUTH] Stytch session validation failed: {type(e).__name__}: {e}")

    return None


def _extract_bearer(auth_header: str) -> str | None:
    """Extract bearer token from Authorization header."""
    if not auth_header:
        return None
    parts = auth_header.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1]

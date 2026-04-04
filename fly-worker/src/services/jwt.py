"""Platform JWT utilities — service-to-service auth only.

Signs and verifies HS256 JWTs for communication between
mukoko-news and mukoko-platform. NOT used for user auth
(Stytch session tokens handle that).
"""

import time
import jwt
from src.config import settings

ALGORITHM = "HS256"
ISSUER = "mukoko-news"


def create_jwt(
    user_id: str,
    *,
    role: str = "service_role",
    person_id: str | None = None,
) -> str:
    """Create a service JWT for platform-to-platform calls."""
    now = int(time.time())
    payload: dict = {
        "sub": user_id,
        "aud": "authenticated",
        "role": role,
        "iss": ISSUER,
        "iat": now,
        "exp": now + 60 * 5,  # 5 minutes — short-lived for service calls
    }
    if person_id:
        payload["person_id"] = person_id
    return jwt.encode(payload, settings.platform_jwt_secret, algorithm=ALGORITHM)


def verify_jwt(token: str) -> dict | None:
    """Verify a service JWT from mukoko-platform."""
    try:
        payload = jwt.decode(
            token,
            settings.platform_jwt_secret,
            algorithms=[ALGORITHM],
            audience="authenticated",
            issuer=["mukoko-news", "mukoko-platform"],
        )
        return payload
    except jwt.PyJWTError:
        return None

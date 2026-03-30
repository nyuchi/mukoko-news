"""Platform JWT utilities.

Signs and verifies HS256 JWTs for Mukoko News authentication.
Compatible with mukoko-platform's PLATFORM_JWT format.
"""

import time
import jwt
from src.config import settings

ALGORITHM = "HS256"
ISSUER = "mukoko-news"


def create_jwt(
    user_id: str,
    *,
    role: str = "authenticated",
    person_id: str | None = None,
) -> str:
    """Create a JWT for an authenticated user."""
    now = int(time.time())
    payload: dict = {
        "sub": user_id,
        "aud": "authenticated",
        "role": role,
        "iss": ISSUER,
        "iat": now,
        "exp": now + 60 * 60 * 24 * 30,  # 30 days
    }
    if person_id:
        payload["person_id"] = person_id
    return jwt.encode(payload, settings.platform_jwt_secret, algorithm=ALGORITHM)


def verify_jwt(token: str) -> dict | None:
    """Verify a JWT signed by this service or mukoko-platform.

    Accepts tokens from both issuers (mukoko-news and mukoko-platform)
    since they share the same PLATFORM_JWT_SECRET.
    """
    try:
        payload = jwt.decode(
            token,
            settings.platform_jwt_secret,
            algorithms=[ALGORITHM],
            audience="authenticated",
            options={"verify_iss": False},  # Accept both issuers
        )
        return payload
    except jwt.PyJWTError:
        return None

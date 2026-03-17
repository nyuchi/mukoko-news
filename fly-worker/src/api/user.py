"""User endpoints — /api/user/*.

These endpoints require user authentication (OIDC JWT from id.mukoko.com).
Until OIDC validation is implemented, they return empty results gracefully.
"""

from fastapi import APIRouter, Depends

from src.api.auth import require_api_key

router = APIRouter(prefix="/api/user", tags=["user"])


@router.get("/bookmarks")
async def get_bookmarks(
    _token: str | None = Depends(require_api_key),
):
    """Get user's saved/bookmarked articles.

    TODO: Implement per-user bookmarks once OIDC JWT validation is added.
    Currently returns empty list since there's no user identity context.
    """
    return {"articles": [], "total": 0}

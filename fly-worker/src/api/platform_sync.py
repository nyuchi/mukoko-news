"""Platform sync — push/pull data with mukoko-platform.

Uses Fly.io internal networking (.internal) when both apps are deployed.
Falls back to public URL via PLATFORM_API_URL config.
"""

import httpx
from fastapi import APIRouter, Depends, HTTPException, Body

from src.api.auth import require_service, AuthUser
from src.config import settings
from src.services.jwt import create_jwt

router = APIRouter(prefix="/api/platform", tags=["platform-sync"])


def _get_platform_headers() -> dict:
    """Build auth headers for mukoko-platform API calls."""
    token = create_jwt("mukoko-news-service", role="service_role")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@router.post("/push/articles")
async def push_articles(
    articles: list[dict] = Body(...),
    _user: AuthUser = Depends(require_service),
):
    """Push processed articles to mukoko-platform."""
    url = f"{settings.platform_api_url}/api/content/articles/bulk"
    headers = _get_platform_headers()

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.post(url, json={"articles": articles}, headers=headers)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Platform sync failed: {e}")


@router.get("/pull/identity/{person_id}")
async def pull_identity(
    person_id: str,
    _user: AuthUser = Depends(require_service),
):
    """Pull identity data from mukoko-platform."""
    url = f"{settings.platform_api_url}/identity/person/{person_id}"
    headers = _get_platform_headers()

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Platform pull failed: {e}")

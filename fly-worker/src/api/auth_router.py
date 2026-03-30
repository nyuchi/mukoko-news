"""Authentication router — Stytch Email OTP with session management.

POST /api/auth/otp/email/send   — send OTP
POST /api/auth/otp/email/verify — verify OTP, returns Stytch session token
GET  /api/auth/me               — current user from session
POST /api/auth/logout           — revoke Stytch session
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from src.api.auth import require_auth, AuthUser
from src.services.stytch_client import get_stytch_client, is_stytch_configured
from src.db import get_pool

router = APIRouter(prefix="/api/auth", tags=["auth"])


class EmailOtpSendRequest(BaseModel):
    email: EmailStr


class EmailOtpVerifyRequest(BaseModel):
    email: EmailStr
    otp: str
    full_name: str | None = None


class AuthResponse(BaseModel):
    session_token: str
    is_new_user: bool
    user: dict
    person_id: str | None = None


@router.post("/otp/email/send")
async def send_email_otp(body: EmailOtpSendRequest):
    """Send an email OTP via Stytch."""
    if not is_stytch_configured():
        raise HTTPException(status_code=503, detail="Auth service not configured")

    client = get_stytch_client()
    try:
        client.otps.email.send(
            email=body.email,
            expiration_minutes=10,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send OTP: {e}")

    return {"message": "Verification code sent", "email": body.email}


@router.post("/otp/email/verify", response_model=AuthResponse)
async def verify_email_otp(body: EmailOtpVerifyRequest):
    """Verify email OTP — Stytch creates a session, we sync user to DB."""
    if not is_stytch_configured():
        raise HTTPException(status_code=503, detail="Auth service not configured")

    client = get_stytch_client()

    # Verify OTP — Stytch creates a session automatically
    try:
        auth_response = client.otps.email.authenticate(
            email=body.email,
            code=body.otp,
            session_duration_minutes=60 * 24 * 30,  # 30 days
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid or expired OTP: {e}")

    stytch_user_id = auth_response.user_id
    session_token = auth_response.session_token

    # Sync user to our database
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id::text, name, email FROM identity.person WHERE stytch_user_id = $1",
            stytch_user_id,
        )

        is_new_user = False
        if not row:
            row = await conn.fetchrow(
                "SELECT id::text, name, email FROM identity.person WHERE email = $1",
                body.email,
            )
            if row:
                await conn.execute(
                    "UPDATE identity.person SET stytch_user_id = $1, last_seen_at = NOW() WHERE id::text = $2",
                    stytch_user_id, row["id"],
                )
            else:
                row = await conn.fetchrow(
                    """INSERT INTO identity.person (stytch_user_id, email, name, auth_method)
                       VALUES ($1, $2, $3, 'email_otp')
                       RETURNING id::text, name, email""",
                    stytch_user_id, body.email, body.full_name,
                )
                is_new_user = True
        else:
            await conn.execute(
                "UPDATE identity.person SET last_seen_at = NOW() WHERE stytch_user_id = $1",
                stytch_user_id,
            )

    person_id = row["id"]

    return AuthResponse(
        session_token=session_token,
        is_new_user=is_new_user,
        user=dict(row),
        person_id=person_id,
    )


@router.get("/me")
async def get_me(user: AuthUser = Depends(require_auth)):
    """Get current user profile from Stytch session."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id::text, name, email, role FROM identity.person WHERE stytch_user_id = $1",
            user.user_id,
        )
    if not row:
        return {"user": {"id": user.user_id, "email": user.email, "role": user.role}}
    return {"user": dict(row)}


@router.post("/logout")
async def logout(user: AuthUser = Depends(require_auth)):
    """Revoke Stytch session."""
    if is_stytch_configured():
        try:
            client = get_stytch_client()
            client.sessions.revoke(session_id=user.user_id)
        except Exception:
            pass  # Best-effort — token will expire anyway
    return {"message": "Logged out"}

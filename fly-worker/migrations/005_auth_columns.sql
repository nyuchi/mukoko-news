-- Add columns needed by Stytch auth flow (auth_router.py)
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS auth_method TEXT DEFAULT 'email_otp';
ALTER TABLE identity.person ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_identity_person_stytch
    ON identity.person (stytch_user_id) WHERE stytch_user_id IS NOT NULL;

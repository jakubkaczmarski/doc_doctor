-- One-time sign-in links, used by the "Scan with phone" QR code so the phone does not
-- need the password typed in. Short-lived and deleted on first use.
CREATE TABLE login_links (
    token_hash bytea PRIMARY KEY,
    user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);

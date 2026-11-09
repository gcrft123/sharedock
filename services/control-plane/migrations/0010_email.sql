-- Email: address verification + a send record.
--
-- The product could not previously reach the person who bought it. Verifying the address
-- is what makes a receipt worth sending, and a receipt is what makes a perpetual license
-- recoverable years later on hardware that does not exist yet.

-- When the address was confirmed. NULL = unconfirmed.
--
-- Deliberately NOT a gate on sign-in. Every existing account predates verification, and
-- locking people out of accounts they already use in order to enforce a new field would
-- be a worse failure than an unconfirmed address. It records trust; it does not withhold
-- access.
ALTER TABLE users ADD COLUMN email_verified_at INTEGER;

-- Single-use, hashed, expiring verification links. Only the hash is stored, so a database
-- read does not yield working links.
CREATE TABLE IF NOT EXISTS email_verify (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_email_verify_user ON email_verify(user_id);

-- What was sent, and when. Two jobs: a rate-limit floor for re-delivery requests (which
-- are otherwise a free way to mail somebody repeatedly), and an answer to "did the receipt
-- actually go out" that does not depend on the mail provider's dashboard.
CREATE TABLE IF NOT EXISTS email_log (
  id        TEXT PRIMARY KEY,
  user_id   TEXT REFERENCES users(id),
  kind      TEXT NOT NULL,              -- 'verify' | 'receipt' | 'license_copy'
  address   TEXT NOT NULL,
  sent_at   INTEGER NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0  -- 0 when the binding is absent or the send failed
);
CREATE INDEX IF NOT EXISTS idx_email_log_user_kind ON email_log(user_id, kind, sent_at);

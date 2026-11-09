-- Control-plane D1 schema. Zero-knowledge for file data: this stores account
-- identity, device PUBLIC keys, one-time license state, and share-token metadata
-- only. It never stores file contents, content keys, or the account root key in
-- the clear.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,          -- account id
  email         TEXT UNIQUE NOT NULL,
  created_at    INTEGER NOT NULL,
  -- ciphertext-only mailbox: the account root key wrapped to passphrase +
  -- recovery code (never plaintext).
  wrapped_ark   BLOB
);

-- WebAuthn / passkey credentials (public key material only).
CREATE TABLE IF NOT EXISTS credentials (
  id            TEXT PRIMARY KEY,          -- credential id
  user_id       TEXT NOT NULL REFERENCES users(id),
  public_key    BLOB NOT NULL,
  sign_count    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

-- Devices (host + clients). `pubkey` doubles as the Iroh NodeId.
CREATE TABLE IF NOT EXISTS devices (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  name          TEXT,
  role          TEXT NOT NULL,             -- 'host' | 'client'
  pubkey        BLOB NOT NULL,
  -- ARK wrapped to this device's X25519 pubkey, so approved devices can unwrap.
  wrapped_ark_for_device BLOB,
  approved      INTEGER NOT NULL DEFAULT 0,
  added_at      INTEGER NOT NULL,
  last_seen     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

-- One-time purchase licenses (NOT subscriptions). A perpetual signed entitlement
-- token is issued to the host; this row is the audit record.
CREATE TABLE IF NOT EXISTS licenses (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id),
  tier               TEXT NOT NULL,        -- e.g. 'personal'
  quota_bytes        INTEGER NOT NULL,
  stripe_payment_intent TEXT UNIQUE,       -- one-time payment reference
  signed_token       TEXT,                 -- perpetual entitlement handed to host
  purchased_at       INTEGER NOT NULL
);

-- Metadata for E2EE share links. The share KEY lives only in the URL fragment
-- and is never sent to us; we hold opaque token + wrapped-key blob + policy.
CREATE TABLE IF NOT EXISTS share_tokens (
  token         TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  wrapped_key   BLOB,
  perms         TEXT NOT NULL,             -- 'view' | 'edit'
  expires_at    INTEGER,
  created_at    INTEGER NOT NULL,
  access_count  INTEGER NOT NULL DEFAULT 0
);

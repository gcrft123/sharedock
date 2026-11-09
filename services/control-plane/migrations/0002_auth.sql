-- Auth + pairing additions.

-- Short-lived WebAuthn challenges (register + login). The `challenge` column is
-- the random value the authenticator echoes back inside clientDataJSON; a row is
-- one-time (deleted on verify) and expires.
CREATE TABLE IF NOT EXISTS challenges (
  challenge   TEXT PRIMARY KEY,      -- base64url random, also the lookup key
  kind        TEXT NOT NULL,         -- 'register' | 'login'
  email       TEXT,                  -- register: the account being created
  user_id     TEXT,                  -- login: the account asserting
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_challenges_expires ON challenges(expires_at);

-- The device's X25519 agreement pubkey (for wrapping the ARK to it). `pubkey`
-- already holds the Ed25519 identity (= relay handshake id); this adds the
-- agreement half so approved devices can be handed the wrapped ARK.
ALTER TABLE devices ADD COLUMN agreement_pub BLOB;

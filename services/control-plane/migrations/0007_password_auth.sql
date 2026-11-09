-- Master-password auth (replaces the WebAuthn/passkey flow). Zero-knowledge: the
-- server stores only a hash of the client's auth key and the ciphertext-wrapped ARK.
-- `users.wrapped_ark` already exists (0001) for exactly this passphrase-wrapped mailbox;
-- add the KDF parameters + the auth verifier.
ALTER TABLE users ADD COLUMN kdf_salt      TEXT;  -- base64 per-account Argon2id salt (public)
ALTER TABLE users ADD COLUMN kdf_params    TEXT;  -- json {algo, m, t, p}
ALTER TABLE users ADD COLUMN auth_verifier TEXT;  -- base64 sha256(client authKey)

-- The passkey tables (credentials, challenges) are left in place but unused; drop in a
-- later migration if optional modern-device passkeys aren't reintroduced.

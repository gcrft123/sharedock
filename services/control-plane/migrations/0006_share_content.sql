-- E2EE share links: full inline payload + a host quota field.
--
-- `share_tokens` (from 0001) already holds the opaque token, owner, wrapped key,
-- policy, expiry, and access count. To serve a public share we also need the
-- ciphertext and its metadata stored inline (the control plane never sees the
-- decryption secret — that lives only in the URL fragment). Additive + zero-
-- knowledge: we store ciphertext + wrapped key VERBATIM and never decrypt.
--
-- SQLite/D1 `ALTER TABLE ADD COLUMN` is a cheap metadata-only change, so add the
-- new columns one at a time. Existing rows backfill to NULL.
ALTER TABLE share_tokens ADD COLUMN name TEXT;
ALTER TABLE share_tokens ADD COLUMN object_id TEXT;
ALTER TABLE share_tokens ADD COLUMN ciphertext TEXT;      -- base64 AEAD ciphertext (verbatim)
ALTER TABLE share_tokens ADD COLUMN plaintext_len INTEGER;
ALTER TABLE share_tokens ADD COLUMN size_bytes INTEGER;   -- = plaintext_len, surfaced in the list view

-- Host advertised storage quota (bytes), published alongside its Iroh endpoint.
-- Public addressing only; 0 / NULL when the daemon hasn't reported one yet.
ALTER TABLE host_endpoints ADD COLUMN quota_bytes INTEGER;

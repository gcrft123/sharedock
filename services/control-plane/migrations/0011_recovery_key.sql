-- Recovery key: a second, independent wrapping of the account root key.
--
-- Onboarding has always told people the recovery key is the only way back in after a
-- forgotten password. Nothing implemented that. There was no recovery endpoint, no
-- re-wrap, and no screen that accepted the key back, so the promise could not be kept.
--
-- Worse, the key being shown WAS the raw account root key. Anyone reading that downloaded
-- file could decrypt every file on every host, forever, and it could not be rotated. The
-- key stored against these columns is a different thing: a random 256-bit secret that
-- unwraps `recovery_wrapped_ark` and nothing else.

-- The ARK wrapped under the recovery key's encryption half (base64 ciphertext). The server
-- cannot open it: it holds neither the recovery key nor the ARK.
ALTER TABLE users ADD COLUMN recovery_wrapped_ark TEXT;

-- base64 sha256 of the recovery key's AUTH half. Proof-of-possession only, so the blob is
-- not handed out to anyone who merely knows an email address. The auth half cannot derive
-- the encryption half, so this column is useless for opening the blob above.
ALTER TABLE users ADD COLUMN recovery_verifier TEXT;

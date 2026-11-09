-- Host onboarding: single-use pairing codes. The owner (session) mints a code; a new
-- host machine redeems it (unauthenticated — the code is the bearer proof) to self-enroll
-- as a PENDING host device. Only a hash of the code is stored, and it is single-use +
-- short-lived, so a DB leak reveals no live codes and a redeemed code can't be replayed.
CREATE TABLE IF NOT EXISTS host_claim (
  code_hash   TEXT PRIMARY KEY,   -- sha256(normalized code), hex
  account     TEXT NOT NULL,
  name        TEXT,               -- optional label the owner set
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER             -- NULL until redeemed (single-use)
);

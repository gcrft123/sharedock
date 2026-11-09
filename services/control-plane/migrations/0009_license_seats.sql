-- Host seats + revocation.
--
-- Sharedock is priced by how many machines you may enrol as hosts, but the licenses
-- table only recorded a tier string and a byte quota, so nothing recorded (or enforced)
-- the thing being sold. `host_seats` is that number, and it is also signed into the
-- license token so a host can read its own entitlement offline.
--
-- NULL host_seats means a license minted before seats existed. Those were sold as one
-- undifferentiated product with no host limit and are deliberately left unenforced
-- rather than retroactively capped.
ALTER TABLE licenses ADD COLUMN host_seats INTEGER;

-- A perpetual token cannot be un-issued, so a refund or a lost dispute is recorded here
-- and enforced at the control plane: the license stops being served, and the account's
-- client allowlist goes empty, which every host re-reads within 30 seconds.
ALTER TABLE licenses ADD COLUMN revoked_at INTEGER;
ALTER TABLE licenses ADD COLUMN revoked_reason TEXT;

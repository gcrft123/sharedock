-- Releases, for the desktop auto-updater.
--
-- Perpetual licensing makes an update channel sharper, not softer: the install is expected
-- to run for years without anyone signing in, and until now a security fix had no route to
-- a customer at all. Nothing could be pushed, and (before receipts existed) nobody could
-- even be told a fix was available.
--
-- Rows are served to Tauri's updater, which checks the signature against a public key
-- compiled into the app. The private key never touches this table or this server: a
-- compromise of the control plane cannot ship anyone a malicious update.
CREATE TABLE IF NOT EXISTS releases (
  version    TEXT NOT NULL,           -- semver, e.g. "0.2.0"
  target     TEXT NOT NULL,           -- tauri target key, e.g. "darwin-aarch64"
  url        TEXT NOT NULL,           -- where the .app.tar.gz lives
  signature  TEXT NOT NULL,           -- tauri minisign signature over that artifact
  notes      TEXT,                    -- shown in the update prompt
  pub_date   TEXT NOT NULL,           -- RFC 3339
  created_at INTEGER NOT NULL,
  -- Publishing the same version for the same target twice is a correction, not a new
  -- release, so it replaces rather than accumulating.
  PRIMARY KEY (version, target)
);
CREATE INDEX IF NOT EXISTS idx_releases_target ON releases(target, created_at);
